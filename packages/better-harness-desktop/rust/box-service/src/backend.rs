//! A JSONL client for the box host, used by the shim.
//!
//! # Why the shim is a client and not a runtime
//!
//! `harness-box-exec` used to embed BoxLite directly. That made every run its
//! own runtime, and BoxLite locks `BOXLITE_HOME` to one — so a second boxed run
//! could not start. Speaking the host's own protocol instead means every run
//! shares whatever the backend shares.
//!
//! The two backends are the same protocol over a different pipe, which is the
//! point:
//!
//! - `harness-box-client` — the NSXPC bridge, reaching the one driver the
//!   service holds for this login session. Concurrent runs work.
//! - `harness-box-host` — the driver itself, over plain stdio. One at a time,
//!   and the honest choice off macOS or in a test.

use std::collections::HashMap;
use std::process::Stdio;
use std::sync::Arc;
use std::sync::atomic::{AtomicU32, Ordering};

use serde::Deserialize;
use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::{Mutex, mpsc, oneshot};

/// One unsolicited frame from the host.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Event {
    #[serde(rename_all = "camelCase")]
    Output {
        exec_id: String,
        stream: String,
        data: String,
    },
    #[serde(rename_all = "camelCase")]
    Exit {
        exec_id: String,
        exit_code: i32,
        #[serde(default)]
        error_message: Option<String>,
    },
    #[serde(other)]
    Other,
}

type Pending = Arc<Mutex<HashMap<u32, oneshot::Sender<Result<Value, String>>>>>;

pub struct Backend {
    child: Child,
    stdin: Mutex<ChildStdin>,
    pending: Pending,
    events: Mutex<mpsc::UnboundedReceiver<Event>>,
    next_id: AtomicU32,
}

impl Backend {
    /// Spawn a backend and start reading its frames.
    pub async fn connect(executable: &std::path::Path) -> Result<Self, String> {
        let mut child = Command::new(executable)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .kill_on_drop(true)
            .spawn()
            .map_err(|error| format!("starting {}: {error}", executable.display()))?;
        let stdin = child.stdin.take().expect("stdin was piped");
        let stdout = child.stdout.take().expect("stdout was piped");
        let pending: Pending = Arc::new(Mutex::new(HashMap::new()));
        let (sender, receiver) = mpsc::unbounded_channel();

        let reader_pending = pending.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let Ok(frame) = serde_json::from_str::<Value>(&line) else {
                    continue;
                };
                if let Some(event) = frame.get("event") {
                    if let Ok(event) = serde_json::from_value::<Event>(event.clone()) {
                        let _ = sender.send(event);
                    }
                    continue;
                }
                let Some(id) = frame.get("id").and_then(Value::as_u64) else {
                    continue;
                };
                let Some(reply) = reader_pending.lock().await.remove(&(id as u32)) else {
                    continue;
                };
                let outcome = match frame.get("error") {
                    Some(error) => Err(error
                        .get("message")
                        .and_then(Value::as_str)
                        .unwrap_or("the box host refused the request")
                        .to_string()),
                    None => Ok(frame.get("result").cloned().unwrap_or(Value::Null)),
                };
                let _ = reply.send(outcome);
            }
            // The backend is gone; fail everything still waiting rather than
            // leaving the caller on a future that can never complete.
            for (_, reply) in reader_pending.lock().await.drain() {
                let _ = reply.send(Err("the box host exited".into()));
            }
        });

        Ok(Self {
            child,
            stdin: Mutex::new(stdin),
            pending,
            events: Mutex::new(receiver),
            next_id: AtomicU32::new(1),
        })
    }

    /// Send one request and wait for its reply.
    pub async fn call(&self, method: &str, params: Value) -> Result<Value, String> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let (sender, receiver) = oneshot::channel();
        self.pending.lock().await.insert(id, sender);
        let frame = format!(
            "{}\n",
            json!({ "version": 1, "id": id, "method": method, "params": params })
        );
        {
            let mut stdin = self.stdin.lock().await;
            stdin
                .write_all(frame.as_bytes())
                .await
                .map_err(|error| format!("writing to the box host failed: {error}"))?;
            stdin
                .flush()
                .await
                .map_err(|error| format!("writing to the box host failed: {error}"))?;
        }
        receiver
            .await
            .map_err(|_| "the box host dropped the request".to_string())?
    }

    /// Await the next event, or `None` once the backend is gone.
    pub async fn next_event(&self) -> Option<Event> {
        self.events.lock().await.recv().await
    }

    /// Run one command to completion, returning its exit code.
    ///
    /// Output goes to *stderr*, never stdout: stdout is the ACP channel, and a
    /// stray npm line there would be read as a malformed JSON-RPC frame.
    pub async fn run(&self, name: &str, shell: &str) -> Result<i32, String> {
        let started = self
            .call(
                "box.exec",
                json!({ "name": name, "command": "sh", "args": ["-c", shell] }),
            )
            .await?;
        let exec_id = started
            .get("execId")
            .and_then(Value::as_str)
            .ok_or("the box host did not name the command")?
            .to_string();
        loop {
            match self.next_event().await {
                Some(Event::Output {
                    exec_id: id, data, ..
                }) if id == exec_id => eprintln!("[box] {}", data.trim_end()),
                Some(Event::Exit {
                    exec_id: id,
                    exit_code,
                    error_message,
                }) if id == exec_id => {
                    if let Some(message) = error_message {
                        eprintln!("[box] {message}");
                    }
                    return Ok(exit_code);
                }
                Some(_) => continue,
                None => return Err("the box host exited before the command finished".into()),
            }
        }
    }

    pub async fn shutdown(mut self) {
        let _ = self.call("shutdown", json!({})).await;
        let _ = self.child.kill().await;
    }
}
