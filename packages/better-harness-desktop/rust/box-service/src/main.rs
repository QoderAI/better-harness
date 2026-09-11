//! Newline-delimited JSON driver for the box host.
//!
//! Unlike `evidence-host`, which answers each line in place, this driver is
//! duplex: box output arrives on its own schedule, so replies and events share
//! one outbound queue. Sharing it is what keeps a command's output ahead of the
//! reply that describes its exit — the same ordering rule `acp-host` documents.
//!
//! Requests are dispatched concurrently. A `box.create` that spends six seconds
//! booting must not stall a `exec.stdin` meant for a box that is already up.

use std::process::ExitCode;
use std::sync::Arc;

use harness_box_host::runtime::BoxHost;
use harness_box_host::wire::{encode_error, parse_request_frame};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::sync::mpsc;

/// Bound on queued outbound lines. Finite so a guest that prints faster than
/// Studio reads throttles the guest instead of growing this process.
const OUTBOUND_CAPACITY: usize = 4096;

/// How long the writer gets to flush after the last request.
const FLUSH_GRACE: std::time::Duration = std::time::Duration::from_secs(3);

#[tokio::main]
async fn main() -> ExitCode {
    // Before the runtime is built: it shells out to mke2fs on first rootfs
    // build, and an XPC service inherits launchd's PATH rather than a shell's.
    harness_box_host::ensure_tooling_path();
    let (outbound, mut queue) = mpsc::channel::<String>(OUTBOUND_CAPACITY);
    let writer = tokio::spawn(async move {
        let mut out = tokio::io::stdout();
        while let Some(line) = queue.recv().await {
            if out.write_all(line.as_bytes()).await.is_err() || out.flush().await.is_err() {
                return;
            }
        }
    });

    let host = match BoxHost::new(outbound.clone()) {
        Ok(host) => Arc::new(host),
        Err(error) => {
            eprintln!("[box-host] the BoxLite runtime is unavailable: {error}");
            return ExitCode::FAILURE;
        }
    };

    let mut lines = BufReader::new(tokio::io::stdin()).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        let trimmed = line.trim().to_string();
        if trimmed.is_empty() {
            continue;
        }
        let frame = match parse_request_frame(&trimmed) {
            Ok(frame) => frame,
            Err(error) => {
                eprintln!("[box-host] {error}");
                return ExitCode::FAILURE;
            }
        };
        let shutting_down = frame.method == "shutdown";
        let host = host.clone();
        let outbound = outbound.clone();
        let task = tokio::spawn(async move {
            let reply = harness_box_host::dispatch(&host, frame.clone())
                .await
                .unwrap_or_else(|error| {
                    encode_error(frame.id, "encode-failed", error)
                        .unwrap_or_else(|_| String::from("{\"version\":1,\"id\":0}\n"))
                });
            let _ = outbound.send(reply).await;
        });
        // Shutdown is the one request whose reply must be flushed before the
        // process leaves, so it is awaited rather than detached.
        if shutting_down {
            let _ = task.await;
            break;
        }
    }

    // The queue cannot simply be closed: `BoxHost` holds a sender too, and so
    // does every output pump still draining a guest. Waiting for all of them to
    // drop is waiting on the guests themselves. Give the writer a bounded window
    // to flush the shutdown reply instead, then leave.
    drop(outbound);
    let _ = tokio::time::timeout(FLUSH_GRACE, writer).await;
    ExitCode::SUCCESS
}
