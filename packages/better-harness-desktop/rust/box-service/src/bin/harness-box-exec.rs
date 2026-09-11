//! Run an ACP agent inside a microVM, speaking its protocol over this process's
//! own stdio.
//!
//! # Why this is the whole trick
//!
//! `harness-acp-host` spawns an agent as `command + args` and talks JSON-RPC to
//! its stdin/stdout. It does not care what that process *is*. So putting the
//! Debugger's agent inside a box needs no change to the ACP host at all — only
//! a command that looks like an agent from the outside and is a VM on the
//! inside. That is this binary.
//!
//! ```text
//!  Studio ── acp-host ── harness-box-exec ── harness-box-client ─┐
//!            (unchanged)  (stdio proxy)       (NSXPC bridge)     │
//!                                        one shared driver ── microVM: pi-acp
//! ```
//!
//! The guest command must be a real ACP server. `pi --mode rpc` is *not* one —
//! that flag selects an output format — which is why the recipe installs the
//! separate `pi-acp` adapter.
//!
//! # This process owns no runtime
//!
//! It used to embed BoxLite, which made every run its own runtime; BoxLite locks
//! `BOXLITE_HOME` to one, so a second boxed run could not start. Now it is a
//! client of the box host, and concurrency is whatever the backend allows —
//! `harness-box-client` reaches the one driver shared by the whole login
//! session, so runs no longer collide.
//!
//! # Provisioning is cached, not repeated
//!
//! The agent is installed on first use and the box is kept afterwards, so the
//! second session skips the ~96 s npm install that the first one paid.
//!
//! ```bash
//! harness-box-exec --box debugger --image node:20-slim \
//!   --mount /path/to/project:/path/to/project --workdir /path/to/project \
//!   --allow-net registry.npmjs.org --allow-net api.anthropic.com \
//!   --provision 'npm install -g --ignore-scripts @earendil-works/pi-coding-agent pi-acp' \
//!   --probe 'command -v pi-acp' \
//!   -- pi-acp
//! ```

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::process::ExitCode;
use std::sync::Arc;
use std::time::{Duration, Instant};

use harness_box_host::backend::{Backend, Event};
use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

struct Options {
    name: String,
    image: String,
    backend: Option<PathBuf>,
    mounts: Vec<Value>,
    env: BTreeMap<String, String>,
    allow_net: Vec<String>,
    working_dir: Option<String>,
    memory_mib: Option<u32>,
    disk_size_gb: Option<u64>,
    provision: Vec<String>,
    probe: Option<String>,
    keep: bool,
    /// Upper bound on boot plus provisioning. Deliberately **under** the
    /// caller's own bound: `AcpRustExecutor` fails any ACP host request after
    /// 10 minutes, and `connection.open` is the request waiting for this
    /// process to answer `initialize`. Overrunning it would hand the reader a
    /// generic "request timed out" from two layers up while this process kept
    /// going. Losing the race on purpose keeps the explanation here.
    start_deadline: Duration,
    agent: Vec<String>,
}

/// Default guest PATH, matching what a login shell in a Debian-family image
/// gets. Notably includes `/usr/local/bin`, where `npm install -g` puts things.
const GUEST_PATH: &str = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";

fn usage() -> ! {
    eprintln!(
        "usage: harness-box-exec [--box NAME] [--image IMAGE] [--backend PATH] \
         [--mount HOST:GUEST[:ro]] [--env K=V] [--allow-net HOST] [--workdir DIR] \
         [--memory-mib N] [--disk-gb N] [--provision CMD] [--probe CMD] \
         [--start-timeout SECONDS] [--keep] -- AGENT ARGS..."
    );
    std::process::exit(2);
}

fn parse() -> Options {
    let mut options = Options {
        name: "harness-debugger".into(),
        image: "node:20-slim".into(),
        backend: None,
        mounts: Vec::new(),
        env: BTreeMap::new(),
        allow_net: Vec::new(),
        working_dir: None,
        memory_mib: Some(2048),
        disk_size_gb: Some(8),
        provision: Vec::new(),
        probe: None,
        keep: true,
        start_deadline: Duration::from_secs(480),
        agent: Vec::new(),
    };
    let mut args = std::env::args().skip(1);
    while let Some(flag) = args.next() {
        // Everything after `--` is the agent's own command line, untouched.
        if flag == "--" {
            options.agent = args.collect();
            break;
        }
        let mut value = || args.next().unwrap_or_else(|| usage());
        match flag.as_str() {
            "--box" => options.name = value(),
            "--image" => options.image = value(),
            "--backend" => options.backend = Some(PathBuf::from(value())),
            "--mount" => options.mounts.push(mount(&value())),
            "--env" => {
                let pair = value();
                let (key, val) = pair.split_once('=').unwrap_or_else(|| usage());
                options.env.insert(key.into(), val.into());
            }
            "--allow-net" => options.allow_net.push(value()),
            "--workdir" => options.working_dir = Some(value()),
            "--memory-mib" => options.memory_mib = value().parse().ok(),
            "--disk-gb" => options.disk_size_gb = value().parse().ok(),
            "--provision" => options.provision.push(value()),
            "--probe" => options.probe = Some(value()),
            "--start-timeout" => {
                options.start_deadline = value()
                    .parse()
                    .map(Duration::from_secs)
                    .unwrap_or_else(|_| usage())
            }
            "--keep" => options.keep = true,
            "--no-keep" => options.keep = false,
            _ => usage(),
        }
    }
    if options.agent.is_empty() {
        usage();
    }
    options
}

/// `HOST:GUEST` or `HOST:GUEST:ro`.
fn mount(spec: &str) -> Value {
    let parts: Vec<&str> = spec.split(':').collect();
    match parts.as_slice() {
        [host, guest] => json!({ "hostPath": host, "guestPath": guest }),
        [host, guest, mode] => {
            json!({ "hostPath": host, "guestPath": guest, "readOnly": *mode == "ro" })
        }
        _ => usage(),
    }
}

/// Where to find the box host.
///
/// Prefers the NSXPC bridge beside this executable, because that is the one
/// backed by a shared driver and therefore the one that lets two runs coexist.
/// Falls back to the driver itself, which is correct off macOS and in tests but
/// allows only one run at a time.
fn backend_path(options: &Options) -> Result<PathBuf, String> {
    if let Some(explicit) = &options.backend {
        return Ok(explicit.clone());
    }
    let directory = std::env::current_exe()
        .map_err(|error| format!("locating this executable: {error}"))?
        .parent()
        .ok_or("this executable has no directory")?
        .to_path_buf();
    if cfg!(target_os = "macos") {
        // The bridge only reaches the shared service from inside the bundle —
        // `initWithServiceName:` resolves against the caller's bundle — so the
        // staged copy in `.app/Contents/MacOS` is the one that buys concurrency.
        // A bare copy beside us would connect to nothing.
        let bundled = directory
            .join("Harness Box.app/Contents/MacOS")
            .join("harness-box-client");
        if bundled.is_file() {
            return Ok(bundled);
        }
    }
    // The driver itself: correct, and the only option off macOS, but it owns a
    // runtime — so one run at a time.
    let driver = directory.join("harness-box-host");
    if driver.is_file() {
        return Ok(driver);
    }
    Err(format!(
        "no box host beside {}; pass --backend",
        directory.display()
    ))
}

/// Bring a box to the point where the agent can launch.
///
/// Failures come back as a reader-facing sentence rather than a raw error. The
/// ACP host retains this process's stderr as connection diagnostics, so this
/// text is what someone sees in Studio when a run refuses to start — it should
/// name the likely cause, not just the layer that failed.
async fn prepare(backend: &Backend, options: &Options, started: Instant) -> Result<(), String> {
    let created = backend
        .call(
            "box.create",
            json!({
                "name": options.name,
                "image": options.image,
                "cpus": Value::Null,
                "memoryMib": options.memory_mib,
                "diskSizeGb": options.disk_size_gb,
                "workingDir": options.working_dir,
                "env": options.env,
                "mounts": options.mounts,
                "allowNet": options.allow_net,
            }),
        )
        .await
        .map_err(|error| format!("The microVM could not be created: {error}"))?;
    let fresh = created
        .get("created")
        .and_then(Value::as_bool)
        .unwrap_or(true);
    backend
        .call("box.start", json!({ "name": options.name }))
        .await
        .map_err(|error| {
            format!(
                "The microVM could not start: {error}. This needs hardware virtualization, \
                 and a first run must be able to pull '{}'.",
                options.image,
            )
        })?;
    eprintln!(
        "[box-exec] box {} ({}) ready in {:?}",
        options.name,
        if fresh { "new" } else { "reused" },
        started.elapsed()
    );

    // Provision only when the probe says the tool is missing. On a reused box
    // this is one cheap command instead of a re-install.
    let needs_provision = match &options.probe {
        Some(probe) => {
            backend
                .run(&options.name, probe)
                .await
                .map_err(|error| format!("The microVM did not answer a command: {error}"))?
                != 0
        }
        None => fresh,
    };
    if needs_provision {
        for step in &options.provision {
            eprintln!("[box-exec] provisioning: {step}");
            let code = backend
                .run(&options.name, step)
                .await
                .map_err(|error| format!("Installing the Agent failed to run: {error}"))?;
            if code != 0 {
                return Err(format!(
                    "Installing the Agent in the microVM failed (exit {code}). The box needs \
                     network access to the package registry; check the run's egress allow-list.",
                ));
            }
        }
        eprintln!("[box-exec] provisioned in {:?}", started.elapsed());
    }
    Ok(())
}

#[tokio::main]
async fn main() -> ExitCode {
    let options = parse();
    let started = Instant::now();
    let path = match backend_path(&options) {
        Ok(path) => path,
        Err(reason) => {
            eprintln!("[box-exec] {reason}");
            return ExitCode::from(1);
        }
    };
    let backend = match Backend::connect(&path).await {
        Ok(backend) => Arc::new(backend),
        Err(reason) => {
            eprintln!("[box-exec] {reason}");
            return ExitCode::from(1);
        }
    };
    eprintln!("[box-exec] box host: {}", path.display());

    // One deadline over the slow half — pulling an image, building a rootfs,
    // installing packages. The ACP host has no timeout of its own; it waits for
    // the agent's first frame. Without this a stalled pull would leave Studio
    // waiting with nothing to show.
    match tokio::time::timeout(options.start_deadline, prepare(&backend, &options, started)).await {
        Ok(Ok(())) => {}
        Ok(Err(reason)) => {
            eprintln!("[box-exec] {reason}");
            return ExitCode::from(1);
        }
        Err(_) => {
            eprintln!(
                "[box-exec] The microVM was not ready within {:?}. A first run pulls the '{}' \
                 image and installs the Agent, which needs network access; raise --start-timeout \
                 if this machine is simply slow.",
                options.start_deadline, options.image,
            );
            return ExitCode::from(1);
        }
    }

    // The Agent is exec'd directly, not through a shell, so it inherits no
    // PATH unless one is set. A provisioning probe run via `sh -c` still works
    // — the shell has a built-in default — which is why this is invisible until
    // the Agent itself tries to spawn something. `pi-acp` starting `pi` failed
    // with ENOENT on exactly this. Only filled in when the caller said nothing.
    let mut env = options.env.clone();
    env.entry("PATH".into())
        .or_insert_with(|| GUEST_PATH.to_string());
    let launched = backend
        .call(
            "box.exec",
            json!({
                "name": options.name,
                "command": options.agent[0],
                "args": options.agent[1..],
                "env": env,
                "workingDir": options.working_dir,
                "interactive": true,
            }),
        )
        .await;
    let exec_id = match launched
        .as_ref()
        .map(|value| value.get("execId").and_then(Value::as_str))
    {
        Ok(Some(id)) => id.to_string(),
        Ok(None) => {
            eprintln!("[box-exec] The box host did not name the Agent command.");
            return ExitCode::from(1);
        }
        Err(reason) => {
            eprintln!("[box-exec] The Agent could not start in the microVM: {reason}");
            return ExitCode::from(1);
        }
    };
    eprintln!("[box-exec] agent live at {:?}", started.elapsed());

    // Our stdin -> the agent's, one whole line at a time. Framing stays with the
    // host so a caller cannot half-write a JSON-RPC message.
    let writer = {
        let backend = backend.clone();
        let exec_id = exec_id.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(tokio::io::stdin()).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                if backend
                    .call("exec.stdin", json!({ "execId": exec_id, "data": line }))
                    .await
                    .is_err()
                {
                    return;
                }
            }
            let _ = backend
                .call(
                    "exec.stdin",
                    json!({ "execId": exec_id, "data": "", "close": true }),
                )
                .await;
        })
    };

    // The agent's stdout -> ours, which is the ACP channel. Its stderr is
    // diagnostics and must never land there.
    let mut out = tokio::io::stdout();
    let code = loop {
        match backend.next_event().await {
            Some(Event::Output {
                exec_id: id,
                stream,
                data,
            }) if id == exec_id => {
                if stream == "stderr" {
                    eprintln!("[agent] {}", data.trim_end());
                    continue;
                }
                if out.write_all(data.as_bytes()).await.is_err() || out.flush().await.is_err() {
                    break 0;
                }
            }
            Some(Event::Exit {
                exec_id: id,
                exit_code,
                error_message,
            }) if id == exec_id => {
                if let Some(message) = error_message {
                    eprintln!("[box-exec] {message}");
                }
                break exit_code;
            }
            Some(_) => continue,
            None => {
                eprintln!("[box-exec] The box host exited while the Agent was running.");
                break 1;
            }
        }
    };
    writer.abort();
    eprintln!(
        "[box-exec] agent exited {code} after {:?}",
        started.elapsed()
    );
    if !options.keep {
        let _ = backend
            .call("box.stop", json!({ "name": options.name }))
            .await;
    }
    ExitCode::from(code.clamp(0, 255) as u8)
}
