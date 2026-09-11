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
//!  Studio ── acp-host ── harness-box-exec ─┬─ boxlite runtime
//!            (unchanged)   (stdio proxy)   └─ microVM: pi-acp
//! ```
//!
//! The guest command must be a real ACP server. `pi --mode rpc` is *not* one —
//! that flag selects an output format — which is why the recipe installs the
//! separate `pi-acp` adapter.
//!
//! # Provisioning is cached, not repeated
//!
//! The agent is installed on first use and the box is kept afterwards, so the
//! second session skips the ~96 s npm install that the first one paid.
//!
//! ```bash
//! harness-box-exec --box debugger --image node:20-slim \
//!   --mount /path/to/project:/workspace --workdir /workspace \
//!   --allow-net registry.npmjs.org --allow-net api.anthropic.com \
//!   --provision 'npm install -g --ignore-scripts @earendil-works/pi-coding-agent pi-acp' \
//!   --probe 'command -v pi-acp' \
//!   -- pi-acp
//! ```

use std::collections::BTreeMap;
use std::process::ExitCode;
use std::time::{Duration, Instant};

use boxlite::runtime::options::VolumeSpec;
use boxlite::{BoxCommand, BoxOptions, BoxliteRuntime, NetworkSpec, RootfsSpec};
use futures::StreamExt;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

struct Options {
    name: String,
    image: String,
    mounts: Vec<VolumeSpec>,
    env: BTreeMap<String, String>,
    allow_net: Vec<String>,
    working_dir: Option<String>,
    memory_mib: Option<u32>,
    disk_size_gb: Option<u64>,
    provision: Vec<String>,
    probe: Option<String>,
    keep: bool,
    /// Upper bound on boot plus provisioning. Nothing upstream has a timeout,
    /// so this is the only thing standing between a stalled pull and a Studio
    /// that waits forever.
    start_deadline: Duration,
    agent: Vec<String>,
}

fn usage() -> ! {
    eprintln!(
        "usage: harness-box-exec [--box NAME] [--image IMAGE] [--mount HOST:GUEST[:ro]] \
         [--env K=V] [--allow-net HOST] [--workdir DIR] [--memory-mib N] [--disk-gb N] \
         [--provision CMD] [--probe CMD] [--start-timeout SECONDS] [--keep] -- AGENT ARGS..."
    );
    std::process::exit(2);
}

fn parse() -> Options {
    let mut options = Options {
        name: "harness-debugger".into(),
        image: "node:20-slim".into(),
        mounts: Vec::new(),
        env: BTreeMap::new(),
        allow_net: Vec::new(),
        working_dir: None,
        memory_mib: Some(2048),
        disk_size_gb: Some(8),
        provision: Vec::new(),
        probe: None,
        keep: true,
        // Generous: a cold run pulls a Node image and installs the Agent, which
        // was measured at ~96 s on a fast connection and is mostly network.
        start_deadline: Duration::from_secs(900),
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
fn mount(spec: &str) -> VolumeSpec {
    let parts: Vec<&str> = spec.split(':').collect();
    match parts.as_slice() {
        [host, guest] => VolumeSpec {
            managed_volume: None,
            host_path: (*host).into(),
            guest_path: (*guest).into(),
            read_only: false,
        },
        [host, guest, mode] => VolumeSpec {
            managed_volume: None,
            host_path: (*host).into(),
            guest_path: (*guest).into(),
            read_only: *mode == "ro",
        },
        _ => usage(),
    }
}

/// Run one command to completion, returning its exit code and captured stdout.
///
/// Provisioning output goes to *stderr*, never stdout: stdout is the ACP
/// channel, and an npm log line landing there would be read as a malformed
/// JSON-RPC frame.
async fn run(
    litebox: &boxlite::LiteBox,
    shell: &str,
) -> Result<(i32, String), Box<dyn std::error::Error>> {
    let mut execution = litebox
        .exec(BoxCommand::new("sh").args(["-c", shell]))
        .await?;
    let stdout = execution.stdout();
    let stderr = execution.stderr();
    let collected = tokio::spawn(async move {
        let mut lines = Vec::new();
        if let Some(mut stream) = stdout {
            while let Some(line) = stream.next().await {
                eprintln!("[box] {line}");
                lines.push(line);
            }
        }
        lines.join("\n")
    });
    let drain = tokio::spawn(async move {
        if let Some(mut stream) = stderr {
            while let Some(line) = stream.next().await {
                eprintln!("[box!] {line}");
            }
        }
    });
    let result = execution.wait().await?;
    let output = collected.await.unwrap_or_default();
    let _ = drain.await;
    Ok((result.exit_code, output))
}

/// Bring a box to the point where the Agent can launch: created, booted, and
/// provisioned.
///
/// Failures come back as a reader-facing sentence rather than a raw error. The
/// ACP host retains this process's stderr as connection diagnostics, so this
/// text is what someone sees in Studio when a run refuses to start — it should
/// name the likely cause, not just the layer that failed.
async fn prepare(
    runtime: &BoxliteRuntime,
    box_options: BoxOptions,
    options: &Options,
    started: Instant,
) -> Result<boxlite::LiteBox, String> {
    let (litebox, created) = runtime
        .get_or_create(box_options, Some(options.name.clone()))
        .await
        .map_err(|error| format!("The microVM could not be created: {error}"))?;
    litebox.start().await.map_err(|error| {
        format!(
            "The microVM could not start: {error}. This needs hardware virtualization, \
             and a first run must be able to pull '{}'.",
            options.image,
        )
    })?;
    eprintln!(
        "[box-exec] box {} ({}) ready in {:?}",
        options.name,
        if created { "new" } else { "reused" },
        started.elapsed()
    );

    // Provision only when the probe says the tool is missing. On a reused box
    // this is one cheap command instead of a re-install.
    let needs_provision = match &options.probe {
        Some(probe) => {
            run(&litebox, probe)
                .await
                .map_err(|error| format!("The microVM did not answer a command: {error}"))?
                .0
                != 0
        }
        None => created,
    };
    if needs_provision {
        for step in &options.provision {
            eprintln!("[box-exec] provisioning: {step}");
            let (code, _) = run(&litebox, step)
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
    Ok(litebox)
}

#[tokio::main]
async fn main() -> Result<ExitCode, Box<dyn std::error::Error>> {
    let options = parse();
    let started = Instant::now();
    // Spawned by Studio, so the inherited PATH is launchd's, not a shell's.
    harness_box_host::ensure_tooling_path();
    eprintln!("[box-exec] boxlite {}", boxlite::VERSION);

    // BoxLite locks its home directory to one runtime, and each run owns its
    // own, so a second concurrent box run cannot start. The raw error names a
    // directory and a lock; the reader needs the rule instead.
    let runtime = match BoxliteRuntime::with_defaults() {
        Ok(runtime) => runtime,
        Err(error) => {
            eprintln!(
                "[box-exec] Only one microVM run can be active at a time. \
                 Finish or cancel the other run, then start this one again."
            );
            eprintln!("[box-exec] {error}");
            return Ok(ExitCode::from(1));
        }
    };
    let box_options = BoxOptions {
        memory_mib: options.memory_mib,
        disk_size_gb: options.disk_size_gb,
        working_dir: options.working_dir.clone(),
        env: options.env.clone().into_iter().collect(),
        rootfs: RootfsSpec::Image(options.image.clone()),
        volumes: options.mounts.clone(),
        network: NetworkSpec::Enabled {
            allow_net: options.allow_net.clone(),
        },
        auto_delete: if options.keep { Some(0) } else { None },
        ..Default::default()
    };
    // One deadline over the whole slow half — pulling an image, building a
    // rootfs, installing packages over the network. The ACP host has no timeout
    // of its own; it waits for the Agent's first frame. Without this, a stalled
    // pull would leave Studio waiting with nothing to show.
    let litebox = match tokio::time::timeout(
        options.start_deadline,
        prepare(&runtime, box_options, &options, started),
    )
    .await
    {
        Ok(Ok(litebox)) => litebox,
        Ok(Err(reason)) => {
            eprintln!("[box-exec] {reason}");
            return Ok(ExitCode::from(1));
        }
        Err(_) => {
            eprintln!(
                "[box-exec] The microVM was not ready within {:?}. A first run pulls the '{}' image \
                 and installs the Agent, which needs network access; raise --start-timeout if this \
                 machine is simply slow.",
                options.start_deadline, options.image,
            );
            return Ok(ExitCode::from(1));
        }
    };

    let mut command = BoxCommand::new(options.agent[0].clone()).args(&options.agent[1..]);
    for (key, value) in &options.env {
        command = command.env(key, value);
    }
    if let Some(dir) = &options.working_dir {
        command = command.working_dir(dir);
    }
    let mut execution = litebox.exec(command).await?;
    let mut agent_stdin = execution
        .stdin()
        .ok_or("the agent execution exposed no stdin")?;
    let agent_stdout = execution.stdout();
    let agent_stderr = execution.stderr();
    eprintln!("[box-exec] agent live at {:?}", started.elapsed());

    // Guest stdout -> our stdout. The box yields whole lines and ACP frames are
    // newline-delimited, so the terminator is re-added rather than guessed at.
    let pump = tokio::spawn(async move {
        let mut out = tokio::io::stdout();
        if let Some(mut stream) = agent_stdout {
            while let Some(line) = stream.next().await {
                if out.write_all(line.as_bytes()).await.is_err()
                    || out.write_all(b"\n").await.is_err()
                    || out.flush().await.is_err()
                {
                    return;
                }
            }
        }
    });
    let diagnostics = tokio::spawn(async move {
        if let Some(mut stream) = agent_stderr {
            while let Some(line) = stream.next().await {
                eprintln!("[agent] {line}");
            }
        }
    });

    // Our stdin -> guest stdin, until the ACP host closes it.
    let mut lines = BufReader::new(tokio::io::stdin()).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        let mut frame = line.into_bytes();
        frame.push(b'\n');
        if agent_stdin.write_all(&frame).await.is_err() {
            break;
        }
    }
    agent_stdin.close();

    let result = execution.wait().await?;
    let _ = pump.await;
    let _ = diagnostics.await;
    eprintln!(
        "[box-exec] agent exited {} after {:?}",
        result.exit_code,
        started.elapsed()
    );
    if !options.keep {
        let _ = litebox.stop().await;
    }
    Ok(ExitCode::from(result.exit_code.clamp(0, 255) as u8))
}
