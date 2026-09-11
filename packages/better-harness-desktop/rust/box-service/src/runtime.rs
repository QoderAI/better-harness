//! The BoxLite runtime, owned by one driver process.
//!
//! # Why the runtime lives here and not in the XPC service
//!
//! BoxLite is daemonless: the microVMs are children of whatever process holds
//! the runtime. Putting that in the driver — the same place `acp-host` puts its
//! agent — means a crashed connection reaps its own VMs, and the XPC service
//! stays a transport with nothing to leak.
//!
//! # One runtime per BOXLITE_HOME — the constraint that shapes everything
//!
//! BoxLite takes an exclusive lock on its home directory:
//!
//! ```text
//! Another BoxliteRuntime is already using directory: ~/.boxlite
//! Only one runtime instance can use a BOXLITE_HOME directory at a time.
//! ```
//!
//! So this driver must be a **singleton**, which is the one place this service
//! cannot copy `acp-host`: that service spawns one driver per XPC connection,
//! and a second driver here would fail to start rather than share. Either the
//! XPC service holds a single driver for every connection, or each driver gets
//! its own `BOXLITE_HOME` — and the second option throws away the image cache
//! and the warm boxes, which is most of the value. See the README.
//!
//! # Named, not anonymous
//!
//! Every box is addressed by a caller-chosen name. `get_or_create` then makes a
//! reconnect idempotent: Studio reopening a Debugger session lands back in the
//! box that already has the agent's npm install in it, which is the difference
//! between a 96 s cold start and a warm one.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use anyhow::{Result, anyhow};
use boxlite::runtime::options::VolumeSpec;
use boxlite::{BoxCommand, BoxOptions, BoxliteRuntime, LiteBox, NetworkSpec, RootfsSpec};
use futures::StreamExt;
use serde_json::{Value, json};
use tokio::sync::{Mutex, mpsc};

use crate::wire::{
    BoxCreateParams, ExecParams, ExecStdinParams, HostEvent, OutputStream, encode_event,
};

/// One running command. `stdin` is held open for `interactive` execs so a
/// long-lived agent inside the box can be prompted turn after turn.
struct ExecHandle {
    execution: Arc<boxlite::Execution>,
    stdin: Mutex<Option<boxlite::ExecStdin>>,
    /// Which connection started it, so a dropped connection takes its own
    /// commands with it and nobody else's. Boxes are deliberately *not* scoped
    /// this way: they are shared by name so a second session reuses the first's
    /// install.
    connection: Option<u64>,
}

pub struct BoxHost {
    runtime: BoxliteRuntime,
    boxes: Mutex<HashMap<String, Arc<LiteBox>>>,
    execs: Mutex<HashMap<String, Arc<ExecHandle>>>,
    events: mpsc::Sender<String>,
    next_exec: std::sync::atomic::AtomicU64,
}

impl BoxHost {
    /// Fails when another runtime already holds `BOXLITE_HOME`. That is a
    /// deployment error — a second driver was started — not a transient one, so
    /// it is surfaced rather than retried.
    pub fn new(events: mpsc::Sender<String>) -> Result<Self> {
        Ok(Self {
            runtime: BoxliteRuntime::with_defaults()?,
            boxes: Mutex::new(HashMap::new()),
            execs: Mutex::new(HashMap::new()),
            events,
            next_exec: std::sync::atomic::AtomicU64::new(1),
        })
    }

    pub fn describe(&self) -> Value {
        json!({
            "protocol": crate::wire::HOST_PROTOCOL_VERSION,
            "pid": std::process::id(),
            "boxlite": boxlite::VERSION,
            "capabilities": [
                "box.create", "box.start", "box.stop", "box.remove", "box.list",
                "box.exec", "exec.stdin", "exec.kill", "exec.wait",
            ],
        })
    }

    async fn emit(&self, connection: Option<u64>, event: HostEvent) {
        if let Ok(line) = encode_event(connection, &event) {
            let _ = self.events.send(line).await;
        }
    }

    async fn lookup(&self, name: &str) -> Result<Arc<LiteBox>> {
        self.boxes
            .lock()
            .await
            .get(name)
            .cloned()
            .ok_or_else(|| anyhow!("no box named {name}; call box.create first"))
    }

    pub async fn create(&self, params: BoxCreateParams) -> Result<Value> {
        let started = Instant::now();
        let options = BoxOptions {
            cpus: params.cpus,
            memory_mib: params.memory_mib,
            disk_size_gb: params.disk_size_gb,
            working_dir: params.working_dir.clone(),
            env: params.env.into_iter().collect(),
            rootfs: RootfsSpec::Image(params.image.clone()),
            volumes: params
                .mounts
                .into_iter()
                .map(|mount| VolumeSpec {
                    // Managed volumes need a REST runtime; this host is local.
                    managed_volume: None,
                    host_path: mount.host_path.to_string_lossy().into_owned(),
                    guest_path: mount.guest_path,
                    read_only: mount.read_only,
                })
                .collect(),
            network: if params.network_disabled {
                NetworkSpec::Disabled
            } else {
                NetworkSpec::Enabled {
                    allow_net: params.allow_net,
                }
            },
            // Keep the box on stop. A Debugger session that ends should still be
            // resumable, and an explicit `box.remove` is the only deletion path.
            auto_delete: Some(0),
            ..Default::default()
        };
        let (litebox, created) = self
            .runtime
            .get_or_create(options, Some(params.name.clone()))
            .await?;
        let id = litebox.id().to_string();
        self.boxes
            .lock()
            .await
            .insert(params.name.clone(), Arc::new(litebox));
        Ok(json!({
            "boxId": id,
            "name": params.name,
            "created": created,
            "elapsedMs": started.elapsed().as_millis() as u64,
        }))
    }

    pub async fn start(&self, name: &str, connection: Option<u64>) -> Result<Value> {
        let litebox = self.lookup(name).await?;
        let started = Instant::now();
        litebox.start().await?;
        let elapsed = started.elapsed().as_millis() as u64;
        self.emit(
            connection,
            HostEvent::BoxState {
                box_id: litebox.id().to_string(),
                state: "running".into(),
                elapsed_ms: Some(elapsed),
            },
        )
        .await;
        Ok(json!({ "boxId": litebox.id().to_string(), "bootMs": elapsed }))
    }

    /// Run one command. Returns as soon as the command is *launched*; output and
    /// the exit code arrive as events, so a long-lived agent is the normal case
    /// rather than a special one.
    pub async fn exec(
        self: &Arc<Self>,
        params: ExecParams,
        connection: Option<u64>,
    ) -> Result<Value> {
        let litebox = self.lookup(&params.name).await?;
        let mut command = BoxCommand::new(params.command.clone()).args(params.args.clone());
        for (key, value) in &params.env {
            command = command.env(key, value);
        }
        if let Some(dir) = &params.working_dir {
            command = command.working_dir(dir);
        }
        if let Some(user) = &params.user {
            command = command.user(user);
        }
        if let Some(ms) = params.timeout_ms {
            command = command.timeout(Duration::from_millis(ms));
        }

        let started = Instant::now();
        let mut execution = litebox.exec(command).await?;
        let exec_id = format!(
            "exec-{}",
            self.next_exec
                .fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        );
        let stdin = params.interactive.then(|| execution.stdin()).flatten();
        let stdout = execution.stdout();
        let stderr = execution.stderr();
        let execution = Arc::new(execution);

        self.execs.lock().await.insert(
            exec_id.clone(),
            Arc::new(ExecHandle {
                execution: execution.clone(),
                stdin: Mutex::new(stdin),
                connection,
            }),
        );

        if let Some(mut stream) = stdout {
            let host = self.clone();
            let id = exec_id.clone();
            tokio::spawn(async move {
                while let Some(line) = stream.next().await {
                    host.emit(
                        connection,
                        HostEvent::Output {
                            exec_id: id.clone(),
                            stream: OutputStream::Stdout,
                            data: line,
                        },
                    )
                    .await;
                }
            });
        }
        if let Some(mut stream) = stderr {
            let host = self.clone();
            let id = exec_id.clone();
            tokio::spawn(async move {
                while let Some(line) = stream.next().await {
                    host.emit(
                        connection,
                        HostEvent::Output {
                            exec_id: id.clone(),
                            stream: OutputStream::Stderr,
                            data: line,
                        },
                    )
                    .await;
                }
            });
        }

        let host = self.clone();
        let id = exec_id.clone();
        tokio::spawn(async move {
            let (exit_code, error_message) = match execution.wait().await {
                Ok(result) => (result.exit_code, result.error_message),
                Err(error) => (-1, Some(error.to_string())),
            };
            host.emit(
                connection,
                HostEvent::Exit {
                    exec_id: id.clone(),
                    exit_code,
                    error_message,
                },
            )
            .await;
            host.execs.lock().await.remove(&id);
        });

        Ok(json!({ "execId": exec_id, "launchMs": started.elapsed().as_millis() as u64 }))
    }

    /// Write one line to a running command's stdin.
    ///
    /// The newline is appended here rather than by the caller: this stdin is how
    /// JSON-RPC reaches an agent in the box, and a half-written frame would
    /// desynchronise the protocol rather than merely lose a line.
    pub async fn stdin(&self, params: ExecStdinParams) -> Result<Value> {
        let handle = self
            .execs
            .lock()
            .await
            .get(&params.exec_id)
            .cloned()
            .ok_or_else(|| anyhow!("no running exec {}", params.exec_id))?;
        let mut guard = handle.stdin.lock().await;
        let stdin = guard.as_mut().ok_or_else(|| {
            anyhow!(
                "exec {} was not started with interactive stdin",
                params.exec_id
            )
        })?;
        if !params.data.is_empty() {
            let mut line = params.data.into_bytes();
            line.push(b'\n');
            stdin.write_all(&line).await?;
        }
        if params.close
            && let Some(mut stdin) = guard.take()
        {
            stdin.close();
        }
        Ok(json!({ "ok": true }))
    }

    pub async fn kill(&self, exec_id: &str, signal: Option<i32>) -> Result<Value> {
        let handle = self
            .execs
            .lock()
            .await
            .get(exec_id)
            .cloned()
            .ok_or_else(|| anyhow!("no running exec {exec_id}"))?;
        match signal {
            Some(number) => handle.execution.signal(number).await?,
            None => handle.execution.kill().await?,
        }
        Ok(json!({ "ok": true }))
    }

    pub async fn stop(&self, name: &str, connection: Option<u64>) -> Result<Value> {
        let litebox = self.lookup(name).await?;
        litebox.stop().await?;
        self.emit(
            connection,
            HostEvent::BoxState {
                box_id: litebox.id().to_string(),
                state: "stopped".into(),
                elapsed_ms: None,
            },
        )
        .await;
        Ok(json!({ "ok": true }))
    }

    pub async fn remove(&self, name: &str, force: bool) -> Result<Value> {
        self.boxes.lock().await.remove(name);
        self.runtime.remove(name, force).await?;
        Ok(json!({ "ok": true }))
    }

    pub async fn list(&self) -> Result<Value> {
        let boxes = self.runtime.list_info().await?;
        Ok(json!(
            boxes
                .into_iter()
                .map(|info| json!({
                    "boxId": info.id.to_string(),
                    "name": info.name,
                    "state": format!("{:?}", info.status),
                }))
                .collect::<Vec<_>>()
        ))
    }

    /// Kill what one connection left running, without touching anyone else's.
    ///
    /// Boxes deliberately survive: they are named per Project and shared, so the
    /// next session reuses the install this one paid for. Commands do not — a
    /// dropped connection has nobody left to read their output, and an agent
    /// waiting on a stdin that will never be written is just a stuck VM.
    pub async fn close_connection(&self, connection: u64) -> Result<Value> {
        let doomed: Vec<(String, Arc<ExecHandle>)> = self
            .execs
            .lock()
            .await
            .iter()
            .filter(|(_, handle)| handle.connection == Some(connection))
            .map(|(id, handle)| (id.clone(), handle.clone()))
            .collect();
        let closed = doomed.len();
        for (id, handle) in doomed {
            let _ = handle.execution.kill().await;
            self.execs.lock().await.remove(&id);
        }
        Ok(json!({ "ok": true, "closed": closed }))
    }

    /// Drop every box this driver started. Called on `shutdown` so a Studio quit
    /// does not leave microVMs behind.
    pub async fn shutdown(&self) {
        let names: Vec<String> = self.boxes.lock().await.keys().cloned().collect();
        for name in names {
            if let Ok(litebox) = self.lookup(&name).await {
                let _ = litebox.stop().await;
            }
        }
        let _ = self.runtime.shutdown(None).await;
    }
}
