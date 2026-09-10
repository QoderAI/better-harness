//! L2 probe: reproduce the BoxLite `run-pi` guide from Rust instead of Python.
//!
//! The published guide is a Python script. This host is Rust, so the probe
//! checks the same three facts through the crate we would actually embed:
//! a Node image boots, the Pi CLI installs into the box, and the installed CLI
//! answers. Timings are printed against the guide's quoted 19 s / 72 s / 77 s.
//!
//! ```text
//! cargo +1.96.0 run --release --example pi_probe
//! ```
//!
//! No provider key is used or needed: `--version` and `--help` exercise the
//! install without making a model call. Supplying a key is the caller's step,
//! and `Secret` is the way to do it without the key entering the VM at all.

use std::time::Instant;

use boxlite::{BoxCommand, BoxOptions, BoxliteRuntime, NetworkSpec, RootfsSpec};
use futures::StreamExt;

const BOX: &str = "harness-pi-probe";
const PI_PACKAGE: &str = "@earendil-works/pi-coding-agent";

async fn run(
    litebox: &boxlite::LiteBox,
    label: &str,
    shell: &str,
) -> Result<i32, Box<dyn std::error::Error>> {
    let started = Instant::now();
    let mut execution = litebox
        .exec(BoxCommand::new("sh").args(["-c", shell]))
        .await?;
    let stdout = execution.stdout();
    let stderr = execution.stderr();
    let out = tokio::spawn(async move {
        if let Some(mut stream) = stdout {
            while let Some(line) = stream.next().await {
                println!("[out] {line}");
            }
        }
    });
    let err = tokio::spawn(async move {
        if let Some(mut stream) = stderr {
            while let Some(line) = stream.next().await {
                eprintln!("[err] {line}");
            }
        }
    });
    let result = execution.wait().await?;
    let _ = out.await;
    let _ = err.await;
    println!(
        "[probe] {label}: exit {} in {:?}",
        result.exit_code,
        started.elapsed()
    );
    Ok(result.exit_code)
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let started = Instant::now();
    println!("[probe] boxlite {}", boxlite::VERSION);
    let runtime = BoxliteRuntime::with_defaults()?;

    let options = BoxOptions {
        memory_mib: Some(2048),
        // The guide's headroom for a global npm install.
        disk_size_gb: Some(8),
        rootfs: RootfsSpec::Image("node:20-slim".into()),
        // npm and, later, the provider endpoint. An empty list would be
        // unrestricted; naming hosts is the point of the exercise.
        network: NetworkSpec::Enabled {
            allow_net: vec!["registry.npmjs.org".into(), "api.anthropic.com".into()],
        },
        auto_delete: Some(0),
        ..Default::default()
    };
    let (litebox, created) = runtime.get_or_create(options, Some(BOX.into())).await?;
    litebox.start().await?;
    println!(
        "[probe] box {} ({}) booted at {:?}  [guide: ~19 s cold]",
        litebox.id(),
        if created { "new" } else { "reused" },
        started.elapsed()
    );

    // Install only when absent, which is what makes the second run cheap.
    if run(&litebox, "probe pi", "command -v pi").await? != 0 {
        let code = run(
            &litebox,
            "npm install",
            &format!("npm install -g --ignore-scripts {PI_PACKAGE}"),
        )
        .await?;
        if code != 0 {
            return Err("npm install failed".into());
        }
        println!(
            "[probe] installed at {:?}  [guide: ~72 s]",
            started.elapsed()
        );
    }

    run(&litebox, "pi --version", "pi --version").await?;
    // `--list-models` is the guide's readiness check. Without a key it should
    // fail *for that reason*, which still proves the CLI runs in the box.
    run(&litebox, "pi --help", "pi --help 2>&1 | head -20").await?;

    println!(
        "[probe] total {:?}  [guide: ~77 s to first answer]",
        started.elapsed()
    );
    println!("[probe] box {BOX} kept; remove it with runtime.remove(\"{BOX}\", true)");
    Ok(())
}
