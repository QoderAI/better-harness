//! Persistent ACP client host.
//!
//! One long-lived process holds ACP connections to agent subprocesses so a
//! session can serve many prompt turns, and so `fs/*` and `terminal/*` client
//! capabilities have somewhere to live. The Node runtime drives it over the
//! newline-delimited contract in [`wire`].
//!
//! # Why a separate process
//!
//! `docs/specs/2026-09-07-acp-rust-host-and-streaming-ui.md` records the intent.
//! In short: the previous Node executor was one-shot, so a session could not take
//! a second prompt and agents could not produce file or terminal evidence.
//! Granting those capabilities widens the trust boundary, which is easier to
//! bound in a process that owns nothing else.
//!
//! # Borrowed design, and what was not borrowed
//!
//! Session merging, permission state, and the reveal cadence follow Zed's
//! `acp_thread`. Two things are deliberately *not* copied:
//!
//! - Zed's worktree prefix check. It answers "which worktree owns this file",
//!   not "may the agent touch this file": no canonicalization, no `..`
//!   normalization, no symlink resolution. [`fence`] replaces it.
//! - Zed's unbounded foreground dispatch queue. Its own comments note the
//!   missing backpressure; this host bounds the event channel instead.

pub mod connection;
pub mod fence;
pub mod redact;
pub mod services;
pub mod thread;
pub mod wire;
