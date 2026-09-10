//! Does the Pi CLI in the box speak ACP, and under what name?
//!
//! Two sources disagree and the Debugger integration depends on which is right:
//! Studio's `acp-agent-catalog.ts` expects a separate `pi-acp` entrypoint and
//! says "the pi CLI alone is not an ACP server", while BoxLite's run-pi guide
//! documents `pi --mode rpc`. `--mode rpc` may well be a machine-readable output
//! mode rather than an agent server, which is a different thing entirely.
//!
//! This reuses the box `pi_probe` already provisioned, so it costs a warm boot.

use boxlite::{BoxCommand, BoxOptions, BoxliteRuntime, NetworkSpec, RootfsSpec};
use futures::StreamExt;

const BOX: &str = "harness-pi-probe";

async fn run(litebox: &boxlite::LiteBox, shell: &str) -> Result<(), Box<dyn std::error::Error>> {
    println!("\n$ {shell}");
    let mut execution = litebox
        .exec(BoxCommand::new("sh").args(["-c", shell]))
        .await?;
    let stdout = execution.stdout();
    let stderr = execution.stderr();
    let out = tokio::spawn(async move {
        if let Some(mut stream) = stdout {
            while let Some(line) = stream.next().await {
                println!("  {line}");
            }
        }
    });
    let err = tokio::spawn(async move {
        if let Some(mut stream) = stderr {
            while let Some(line) = stream.next().await {
                println!("  ! {line}");
            }
        }
    });
    let result = execution.wait().await?;
    let _ = out.await;
    let _ = err.await;
    println!("  [exit {}]", result.exit_code);
    Ok(())
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let runtime = BoxliteRuntime::with_defaults()?;
    let options = BoxOptions {
        memory_mib: Some(2048),
        disk_size_gb: Some(8),
        rootfs: RootfsSpec::Image("node:20-slim".into()),
        network: NetworkSpec::Enabled {
            allow_net: vec!["registry.npmjs.org".into()],
        },
        auto_delete: Some(0),
        ..Default::default()
    };
    let (litebox, _) = runtime.get_or_create(options, Some(BOX.into())).await?;
    litebox.start().await?;

    // Is there an `acp` word anywhere in the CLI surface?
    run(
        &litebox,
        "pi --help 2>&1 | grep -i -A2 'mode\\|acp\\|rpc' || echo 'no mode/acp/rpc in --help'",
    )
    .await?;
    // Does the package ship a second binary?
    run(&litebox, "ls -1 $(npm root -g)/@earendil-works/pi-coding-agent/ 2>/dev/null; echo '--- bins ---'; ls -1 $(npm bin -g 2>/dev/null || echo /usr/local/bin) | head -20").await?;
    run(
        &litebox,
        "cat $(npm root -g)/@earendil-works/pi-coding-agent/package.json 2>/dev/null | head -40",
    )
    .await?;
    // Is `pi-acp` a separate, installable package at all?
    run(&litebox, "npm view pi-acp version 2>&1 | head -5").await?;
    // What does `--mode rpc` actually do when given nothing to work with?
    run(
        &litebox,
        "timeout 10 pi -p 'hi' --mode rpc --no-session < /dev/null 2>&1 | head -20",
    )
    .await?;
    Ok(())
}
