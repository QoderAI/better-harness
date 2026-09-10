//! L0 risk probe: can this machine boot a BoxLite microVM at all?
//!
//! Everything else in this POC — the NSXPC service, the Debugger bridge, Pi —
//! is downstream of this answer. Run it before building any of that:
//!
//! ```text
//! cargo +1.96.0 run --release --example boot_probe
//! ```
//!
//! It reports the timings the run-pi guide quotes (boot, first exec) so the
//! numbers can be compared against the documented 19 s cold boot.

use std::time::Instant;

use boxlite::{BoxCommand, BoxOptions, BoxliteRuntime, RootfsSpec};
use futures::StreamExt;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let image = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "alpine:latest".to_string());
    println!("[probe] boxlite {}", boxlite::VERSION);
    println!("[probe] image {image}");

    let started = Instant::now();
    let runtime = BoxliteRuntime::with_defaults()?;
    println!("[probe] runtime ready at {:?}", started.elapsed());

    // A probe that failed mid-boot leaves its name registered. Clear only that
    // one name — never the runtime's whole state — so a rerun measures a clean
    // create instead of erroring on the leftover.
    if let Err(error) = runtime.remove("harness-probe", true).await {
        println!("[probe] no prior box to clear ({error})");
    }

    let options = BoxOptions {
        rootfs: RootfsSpec::Image(image),
        // Keep the box after stop so a second probe run measures a warm boot.
        auto_delete: Some(0),
        ..Default::default()
    };
    let litebox = runtime
        .create(options, Some("harness-probe".to_string()))
        .await?;
    println!(
        "[probe] created {} at {:?}",
        litebox.id(),
        started.elapsed()
    );

    litebox.start().await?;
    let booted = started.elapsed();
    println!("[probe] booted at {booted:?}");

    let mut execution = litebox
        .exec(BoxCommand::new("sh").args(["-c", "uname -a; id; cat /proc/cpuinfo | head -3"]))
        .await?;
    if let Some(mut stdout) = execution.stdout() {
        while let Some(line) = stdout.next().await {
            println!("[guest] {line}");
        }
    }
    let result = execution.wait().await?;
    println!(
        "[probe] exit {} at {:?} (boot was {booted:?})",
        result.exit_code,
        started.elapsed()
    );

    litebox.stop().await?;
    runtime.remove("harness-probe", true).await?;
    println!("[probe] removed; total {:?}", started.elapsed());
    Ok(())
}
