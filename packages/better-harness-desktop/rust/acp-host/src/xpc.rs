//! Foundation NSXPC transport for the desktop ACP host.
//!
//! # Shape
//!
//! ```text
//!  Studio (Node)              launchd service                 agent
//!  ────────────               ──────────────                 ─────
//!  harness-acp-client  <NSXPC>  harness-acp-xpc  <stdio>  harness-acp-host ── agent proc
//!   (bridge, this file)          (listen, this file)       (driver, main.rs — unchanged)
//! ```
//!
//! The bridge speaks the exact newline-delimited [`crate::wire`] contract on its
//! own stdin/stdout, so `AcpRustExecutor` spawns it the same way it spawns the
//! plain driver. Every stdin line is forwarded to the service with `sendFrame:`;
//! every reply and unsolicited event the service produces comes back with
//! `deliverFrame:` and is written to stdout verbatim.
//!
//! # Why a child driver per connection
//!
//! The service runs one unmodified `harness-acp-host` process per accepted NSXPC
//! connection. Studio already opens one connection per run, so this keeps the
//! current blast radius — one crashed agent fails one run — while adding launchd
//! supervision of the service and a process boundary between Studio's Node worker
//! and the agent subprocesses. No ACP logic lives here; the driver is untouched.
//!
//! # No silent fallback
//!
//! Before forwarding a single driver frame, the service delivers one synthetic
//! `transport` line carrying its own pid and the bridge's. The Node client
//! refuses to continue unless it sees that line first and the two pids differ,
//! so a bridge that never reached the service cannot be mistaken for a working
//! stdio host.

use std::io::{self, BufRead, Read, Write};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use block2::RcBlock;
use objc2::rc::{Retained, autoreleasepool};
use objc2::runtime::{AnyObject, AnyProtocol, ProtocolObject};
use objc2::{AnyThread, DefinedClass, Message, define_class, msg_send};
use objc2_foundation::{
    NSData, NSObject, NSObjectProtocol, NSString, NSXPCConnection, NSXPCInterface, NSXPCListener,
    NSXPCListenerDelegate,
};

use crate::wire::{MAX_FRAME_BYTES, MAX_REQUEST_BYTES};

/// Mach service name. Matches the `.xpc` bundle id `installAcpXpc` writes.
const SERVICE: &str = "com.qoder.harness-studio.acp";
/// Driver binary the service spawns, resolved next to `harness-acp-xpc`.
const DRIVER_BIN: &str = "harness-acp-host";
/// Bound on how long a teardown waits for the driver to drain before `SIGKILL`.
const REAP_GRACE: Duration = Duration::from_secs(5);

unsafe extern "C" {
    fn harness_acp_host_protocol() -> *const AnyProtocol;
    fn harness_acp_client_protocol() -> *const AnyProtocol;
}

/// `sendFrame:` — bridge → service.
fn host_interface() -> Retained<NSXPCInterface> {
    // SAFETY: Clang provides a process-lifetime protocol whose one selector takes
    // an `NSData`, implemented by `AcpSession` below.
    unsafe { NSXPCInterface::interfaceWithProtocol(&*harness_acp_host_protocol()) }
}

/// `deliverFrame:` / `hostFailed:` — service → bridge.
fn client_interface() -> Retained<NSXPCInterface> {
    // SAFETY: as above; the selectors take `NSData` / `NSString`, implemented by
    // `AcpBridge` below.
    unsafe { NSXPCInterface::interfaceWithProtocol(&*harness_acp_client_protocol()) }
}

/// `NSXPCConnection` is documented thread-safe; the pump thread holds one to call
/// `invalidate()` when the driver goes away. Foundation serialises that call.
struct SendConn(Retained<NSXPCConnection>);
// SAFETY: see the doc comment — Apple guarantees `NSXPCConnection` is safe to use
// from multiple threads.
unsafe impl Send for SendConn {}

/// The connection's remote-object proxy. Messaging a proxy is thread-safe, and
/// oneway messages on one proxy of one connection keep their order — which is how
/// the `transport` proof stays ahead of every driver frame.
struct SendProxy(Retained<AnyObject>);
// SAFETY: NSXPC proxies forward to a thread-safe connection.
unsafe impl Send for SendProxy {}

/// The driver process backing one connection, plus its stdin for `sendFrame:`.
struct DriverProcess {
    child: Child,
    stdin: ChildStdin,
}

/// Shared so the exported object's `Drop`, the invalidation handler, and the
/// pump thread can all trigger teardown; whichever runs first wins.
type SharedDriver = Arc<Mutex<Option<DriverProcess>>>;

/// Close the driver's stdin so it drains and reaps its own agent process group,
/// then `SIGKILL` it if it overstays the grace window. Idempotent.
fn reap_driver(shared: &SharedDriver) {
    let Some(mut owned) = shared
        .lock()
        .unwrap_or_else(|poison| poison.into_inner())
        .take()
    else {
        return;
    };
    std::thread::spawn(move || {
        drop(owned.stdin);
        let deadline = std::time::Instant::now() + REAP_GRACE;
        loop {
            match owned.child.try_wait() {
                Ok(Some(_)) => return,
                Ok(None) if std::time::Instant::now() < deadline => {
                    std::thread::sleep(Duration::from_millis(100));
                }
                _ => break,
            }
        }
        let _ = owned.child.kill();
        let _ = owned.child.wait();
    });
}

// ---------------------------------------------------------------------------
// Service side: `harness-acp-xpc`, started by launchd.
// ---------------------------------------------------------------------------

define_class!(
    #[unsafe(super = NSObject)]
    #[name = "HarnessAcpSession"]
    #[ivars = SharedDriver]
    struct AcpSession;

    unsafe impl NSObjectProtocol for AcpSession {}

    impl AcpSession {
        #[unsafe(method(sendFrame:))]
        fn send_frame(&self, frame: &NSData) {
            if frame.len() > MAX_REQUEST_BYTES {
                // The bridge already bounds frames; a larger one is a protocol
                // fault. Drop the connection rather than feed the driver garbage.
                reap_driver(self.ivars());
                return;
            }
            let bytes = frame.to_vec();
            let mut guard = self
                .ivars()
                .lock()
                .unwrap_or_else(|poison| poison.into_inner());
            let broken = match guard.as_mut() {
                Some(driver) => {
                    driver.stdin.write_all(&bytes).is_err() || driver.stdin.flush().is_err()
                }
                None => false,
            };
            drop(guard);
            if broken {
                // The driver's stdin is gone; the pump thread will have already
                // reported the failure. Reap so nothing lingers.
                reap_driver(self.ivars());
            }
        }
    }
);

impl Drop for AcpSession {
    fn drop(&mut self) {
        reap_driver(self.ivars());
    }
}

impl AcpSession {
    fn new(shared: SharedDriver) -> Retained<Self> {
        let this = Self::alloc().set_ivars(shared);
        unsafe { msg_send![super(this), init] }
    }
}

define_class!(
    #[unsafe(super = NSObject)]
    #[name = "HarnessAcpListenerDelegate"]
    struct ListenerDelegate;

    unsafe impl NSObjectProtocol for ListenerDelegate {}

    unsafe impl NSXPCListenerDelegate for ListenerDelegate {
        #[unsafe(method(listener:shouldAcceptNewConnection:))]
        fn accept(&self, _listener: &NSXPCListener, connection: &NSXPCConnection) -> bool {
            match accept_connection(connection) {
                Ok(()) => true,
                Err(error) => {
                    eprintln!("[acp-host] refused a connection: {error}");
                    false
                }
            }
        }
    }
);

/// Spawn a driver for one connection and wire the two directions together.
fn accept_connection(connection: &NSXPCConnection) -> io::Result<()> {
    let driver_path = std::env::current_exe()?
        .parent()
        .map(|dir| dir.join(DRIVER_BIN))
        .ok_or_else(|| io::Error::other("cannot locate the harness-acp-host driver"))?;
    let mut child = Command::new(&driver_path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .map_err(|error| {
            io::Error::new(error.kind(), format!("spawning {}: {error}", driver_path.display()))
        })?;
    let stdin = child.stdin.take().expect("stdin was piped");
    let stdout = child.stdout.take().expect("stdout was piped");
    let shared: SharedDriver = Arc::new(Mutex::new(Some(DriverProcess { child, stdin })));

    connection.setExportedInterface(Some(&host_interface()));
    let session = AcpSession::new(shared.clone());
    // SAFETY: the exported object implements every selector on the host interface.
    unsafe { connection.setExportedObject(Some(&session)) };
    connection.setRemoteObjectInterface(Some(&client_interface()));

    let handler_shared = shared.clone();
    let invalidation = RcBlock::new(move || reap_driver(&handler_shared));
    connection.setInvalidationHandler(Some(&invalidation));

    connection.resume();

    // Prove the hop before the pump thread can forward a single driver frame:
    // send the `transport` frame synchronously here, then hand the same proxy to
    // the pump so ordering is the framework's per-proxy oneway guarantee.
    let proxy: Retained<AnyObject> = connection.remoteObjectProxy();
    let proof = format!(
        "{{\"version\":1,\"event\":{{\"type\":\"transport\",\"transport\":\"nsxpc\",\"servicePid\":{},\"bridgePid\":{}}}}}\n",
        std::process::id(),
        connection.processIdentifier(),
    );
    deliver_frame(&proxy, proof.as_bytes());

    let pump_conn = SendConn(connection.retain());
    let pump_proxy = SendProxy(proxy);
    std::thread::spawn(move || pump_driver_stdout(pump_conn, pump_proxy, stdout, shared));
    Ok(())
}

/// Push one already-framed line to the bridge's `deliverFrame:`.
fn deliver_frame(proxy: &AnyObject, line: &[u8]) {
    autoreleasepool(|_| {
        let data = NSData::with_bytes(line);
        // SAFETY: `deliverFrame:` is on the client interface set as this
        // connection's remote interface, and takes one `NSData`.
        unsafe {
            let _: () = msg_send![proxy, deliverFrame: &*data];
        }
    });
}

/// Forward every driver stdout line to the bridge until EOF or fault, then tell
/// the bridge the connection is over. A clean driver exit is still a failure from
/// the bridge's point of view: the run cannot continue and it must not stall.
fn pump_driver_stdout(
    connection: SendConn,
    proxy: SendProxy,
    stdout: ChildStdout,
    shared: SharedDriver,
) {
    let proxy = proxy.0;
    let mut reader = io::BufReader::new(stdout);
    let reason = loop {
        let mut line = Vec::new();
        let read = reader
            .by_ref()
            .take((MAX_FRAME_BYTES + 1) as u64)
            .read_until(b'\n', &mut line);
        match read {
            Ok(0) => break "the ACP driver exited",
            Ok(_) if line.len() > MAX_FRAME_BYTES => {
                break "the ACP driver emitted an oversized frame";
            }
            Ok(_) => deliver_frame(&proxy, &line),
            Err(_) => break "reading the ACP driver's output failed",
        }
    };
    fail_bridge(&proxy, reason);
    connection.0.invalidate();
    reap_driver(&shared);
}

fn fail_bridge(proxy: &AnyObject, reason: &str) {
    autoreleasepool(|_| {
        let message = NSString::from_str(reason);
        // SAFETY: `hostFailed:` is declared on the remote interface and takes one
        // `NSString`.
        unsafe {
            let _: () = msg_send![proxy, hostFailed: &*message];
        }
    });
}

/// launchd entry point. `serviceListener` hands control to Foundation and never
/// returns.
pub fn listen() {
    autoreleasepool(|_| {
        let delegate: Retained<ListenerDelegate> = unsafe { msg_send![ListenerDelegate::alloc(), init] };
        let listener = NSXPCListener::serviceListener();
        listener.setDelegate(Some(ProtocolObject::from_ref(&*delegate)));
        listener.resume();
    });
}

// ---------------------------------------------------------------------------
// Bridge side: `harness-acp-client`, spawned by Studio in place of the driver.
// ---------------------------------------------------------------------------

/// One writer owns real stdout, exactly as the driver's own writer task does.
static STDOUT: Mutex<()> = Mutex::new(());

define_class!(
    #[unsafe(super = NSObject)]
    #[name = "HarnessAcpBridge"]
    struct AcpBridge;

    unsafe impl NSObjectProtocol for AcpBridge {}

    impl AcpBridge {
        #[unsafe(method(deliverFrame:))]
        fn deliver_frame(&self, frame: &NSData) {
            if frame.len() > MAX_FRAME_BYTES {
                bridge_die("the ACP service delivered an oversized frame");
            }
            let bytes = frame.to_vec();
            let _guard = STDOUT.lock().unwrap_or_else(|poison| poison.into_inner());
            let mut out = io::stdout().lock();
            if out.write_all(&bytes).is_err() || out.flush().is_err() {
                // Studio stopped reading; nothing this process can still do.
                std::process::exit(0);
            }
        }

        #[unsafe(method(hostFailed:))]
        fn host_failed(&self, reason: &NSString) {
            bridge_die(&reason.to_string());
        }
    }
);

impl AcpBridge {
    fn new() -> Retained<Self> {
        unsafe { msg_send![Self::alloc(), init] }
    }
}

/// Report a transport failure on stderr and exit non-zero. `AcpRustExecutor`
/// observes the exit and fails the run; there is no recovery inside one bridge.
fn bridge_die(reason: &str) -> ! {
    eprintln!("[acp-host] {reason}");
    let _ = io::stderr().flush();
    std::process::exit(1);
}

/// Connect to the launchd service and forward stdin. The service delivers the
/// leading `transport` proof and every reply/event through `deliverFrame:`.
pub fn bridge() -> std::process::ExitCode {
    // Foundation delivers `deliverFrame:` on the connection's own dispatch queue,
    // so the main thread is free to block on stdin without a run loop.
    autoreleasepool(|_| {
        let connection = NSXPCConnection::initWithServiceName(
            NSXPCConnection::alloc(),
            &NSString::from_str(SERVICE),
        );
        connection.setRemoteObjectInterface(Some(&host_interface()));
        connection.setExportedInterface(Some(&client_interface()));
        let exported = AcpBridge::new();
        // SAFETY: `AcpBridge` implements every selector on the client interface.
        unsafe { connection.setExportedObject(Some(&exported)) };

        let interrupted = RcBlock::new(|| bridge_die("the ACP service was interrupted"));
        connection.setInterruptionHandler(Some(&interrupted));
        let invalidated = RcBlock::new(|| bridge_die("the ACP service connection was invalidated"));
        connection.setInvalidationHandler(Some(&invalidated));

        connection.resume();

        // An `initWithServiceName:` connection is lazy: launchd starts the service
        // on the first message. Send a blank line now so the service accepts the
        // connection and delivers its `transport` proof ahead of Studio's first
        // real frame. The driver skips empty lines.
        let proxy: Retained<AnyObject> = connection.remoteObjectProxy();
        send_frame(&proxy, b"\n");

        forward_stdin(&proxy);
        std::process::ExitCode::SUCCESS
    })
}

/// Push one already-framed line to the service's `sendFrame:`.
fn send_frame(proxy: &AnyObject, line: &[u8]) {
    autoreleasepool(|_| {
        let data = NSData::with_bytes(line);
        // SAFETY: `sendFrame:` is on the remote interface and takes one `NSData`.
        unsafe {
            let _: () = msg_send![proxy, sendFrame: &*data];
        }
    });
}

/// Send each stdin line to the service until EOF. EOF is a normal end of run:
/// `AcpRustExecutor` closes the bridge's stdin after `shutdown`, and this
/// process then exits, tearing the connection down for the service to observe.
fn forward_stdin(proxy: &AnyObject) {
    let mut stdin = io::stdin().lock();
    loop {
        let mut line = Vec::new();
        let read = stdin
            .by_ref()
            .take((MAX_REQUEST_BYTES + 1) as u64)
            .read_until(b'\n', &mut line);
        match read {
            Ok(0) => return,
            Ok(_) if line.len() > MAX_REQUEST_BYTES => {
                bridge_die("a request frame exceeded its size limit")
            }
            Ok(_) => send_frame(proxy, &line),
            Err(_) => bridge_die("reading Studio's request stream failed"),
        }
    }
}

