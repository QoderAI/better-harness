//! Foundation NSXPC transport for the desktop box host.
//!
//! ```text
//!  Studio (Node)                 launchd service
//!  ────────────                  ──────────────
//!  harness-box-client <NSXPC> harness-box-xpc <stdio> harness-box-host
//! ```
//!
//! No virtualization logic lives here. The driver is unmodified — this file is
//! the same transport shell as `evidence-host`'s, deliberately.
//!
//! # One driver, many connections
//!
//! The other three services run a driver per connection. This one cannot:
//! BoxLite locks `BOXLITE_HOME` to a single runtime, so a second driver would
//! fail to start and every caller after the first would get nothing. Instead
//! there is one shared driver, requests are stamped with a `connectionId` on
//! the way in, and replies and events are routed back by that id.
//!
//! Two consequences shape this file:
//!
//! - The bundle must be `ServiceType: User`. `Application` gives each calling
//!   *process* its own service instance, which puts us back to one runtime per
//!   caller however carefully this file is written.
//! - A dropped connection must not reap the driver, the way the sibling
//!   services do — that would kill another session's agent. It sends
//!   `connection.close` instead, and only a dead driver reaches `reap_driver`.
//!
//! # Entitlements are not our problem
//!
//! Hypervisor.framework needs `com.apple.security.hypervisor`, but the process
//! that calls it is `boxlite-shim`, which BoxLite drops into each box's `bin/`
//! and ad-hoc signs itself with that entitlement plus
//! `com.apple.security.cs.disable-library-validation`. Neither this service nor
//! the driver needs an entitlement of its own — verified by booting a VM through
//! this transport under a plain `codesign --sign -` bundle.

use std::collections::HashMap;
use std::io::{self, BufRead, Read, Write};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{LazyLock, Mutex};
use std::time::Duration;

use block2::RcBlock;
use objc2::rc::{Retained, autoreleasepool};
use objc2::runtime::{AnyObject, AnyProtocol, ProtocolObject};
use objc2::{AnyThread, DefinedClass, define_class, msg_send};
use objc2_foundation::{
    NSData, NSObject, NSObjectProtocol, NSString, NSXPCConnection, NSXPCInterface, NSXPCListener,
    NSXPCListenerDelegate,
};

use crate::wire::{MAX_FRAME_BYTES, MAX_REQUEST_BYTES, transport_proof};

const SERVICE: &str = "com.qoder.harness-studio.box";
const DRIVER_BIN: &str = "harness-box-host";
const REAP_GRACE: Duration = Duration::from_secs(5);

unsafe extern "C" {
    fn harness_box_host_protocol() -> *const AnyProtocol;
    fn harness_box_client_protocol() -> *const AnyProtocol;
}

fn host_interface() -> Retained<NSXPCInterface> {
    unsafe { NSXPCInterface::interfaceWithProtocol(&*harness_box_host_protocol()) }
}

fn client_interface() -> Retained<NSXPCInterface> {
    unsafe { NSXPCInterface::interfaceWithProtocol(&*harness_box_client_protocol()) }
}

struct SendProxy(Retained<AnyObject>);
unsafe impl Send for SendProxy {}

struct DriverProcess {
    child: Child,
    stdin: ChildStdin,
}

/// The one driver every connection shares.
///
/// This is the single place this service cannot copy `acp-host`, which spawns a
/// driver per connection. BoxLite locks its home directory — *"Only one
/// BoxliteRuntime can use a BOXLITE_HOME directory at a time"* — so a second
/// driver would fail to start rather than share, and every connection after the
/// first would get nothing. One driver, many connections, replies routed by id.
///
/// The service bundle is `ServiceType: User` for the same reason: `Application`
/// gives each calling process its own service instance, which would put us back
/// to one runtime per caller no matter what this file does.
static DRIVER: LazyLock<Mutex<Option<DriverProcess>>> = LazyLock::new(|| Mutex::new(None));

/// Where each connection's replies and events go.
static CLIENTS: LazyLock<Mutex<HashMap<u64, SendProxy>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

static NEXT_CONNECTION: AtomicU64 = AtomicU64::new(1);

/// Tear the shared driver down and tell every connection why.
///
/// Only reached when the driver itself is gone or unusable. A single connection
/// dropping never gets here — that sends `connection.close` instead, so one
/// caller leaving cannot take another's agent with it.
fn reap_driver(reason: &str) {
    let clients: Vec<SendProxy> = {
        let mut guard = CLIENTS.lock().unwrap_or_else(|poison| poison.into_inner());
        guard.drain().map(|(_, proxy)| proxy).collect()
    };
    for proxy in &clients {
        fail_bridge(&proxy.0, reason);
    }
    let Some(mut owned) = DRIVER
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

/// Write one already-framed line to the shared driver.
fn write_to_driver(line: &[u8]) -> bool {
    let mut guard = DRIVER.lock().unwrap_or_else(|poison| poison.into_inner());
    match guard.as_mut() {
        Some(driver) => driver.stdin.write_all(line).is_ok() && driver.stdin.flush().is_ok(),
        None => false,
    }
}

/// Stamp the caller's identity onto a request.
///
/// The caller cannot do this itself — it does not know which connection it is —
/// and the driver needs it to address replies and to know whose commands to
/// reap. A frame that is not a JSON object is rejected rather than forwarded,
/// because an unaddressed reply would be delivered to the wrong reader.
fn address_frame(frame: &[u8], connection: u64) -> Option<Vec<u8>> {
    let mut value: serde_json::Value = serde_json::from_slice(frame).ok()?;
    value
        .as_object_mut()?
        .insert("connectionId".into(), serde_json::Value::from(connection));
    let mut line = serde_json::to_vec(&value).ok()?;
    line.push(b'\n');
    Some(line)
}

/// Request id used for the service's own `connection.close`.
///
/// Out at the top of the range so it cannot collide with a caller's ids, which
/// start at 1. The reply is discarded — by the time it arrives the connection
/// is already unregistered.
const CLOSE_REQUEST_ID: u32 = u32::MAX;

/// Stop reading for one connection and reap only what it started.
fn close_connection(connection: u64) {
    CLIENTS
        .lock()
        .unwrap_or_else(|poison| poison.into_inner())
        .remove(&connection);
    let frame = format!(
        "{{\"version\":1,\"id\":{CLOSE_REQUEST_ID},\"method\":\"connection.close\",\"connectionId\":{connection}}}\n"
    );
    write_to_driver(frame.as_bytes());
}

define_class!(
    #[unsafe(super = NSObject)]
    #[name = "HarnessBoxSession"]
    #[ivars = u64]
    struct BoxSession;

    unsafe impl NSObjectProtocol for BoxSession {}

    impl BoxSession {
        #[unsafe(method(sendFrame:))]
        fn send_frame(&self, frame: &NSData) {
            let connection = *self.ivars();
            if frame.len() > MAX_REQUEST_BYTES {
                // One caller's oversized frame is that caller's problem; the
                // shared driver and every other connection keep going.
                close_connection(connection);
                return;
            }
            let bytes = frame.to_vec();
            // The bridge opens with a bare newline to prove the channel works.
            // There is nothing to address and nothing for the driver to answer,
            // so it is dropped rather than treated as a malformed request.
            if bytes.iter().all(u8::is_ascii_whitespace) {
                return;
            }
            let Some(addressed) = address_frame(&bytes, connection) else {
                close_connection(connection);
                return;
            };
            if !write_to_driver(&addressed) {
                reap_driver("the box driver is not accepting requests");
            }
        }
    }
);

impl Drop for BoxSession {
    fn drop(&mut self) {
        close_connection(*self.ivars());
    }
}

impl BoxSession {
    fn new(connection: u64) -> Retained<Self> {
        let this = Self::alloc().set_ivars(connection);
        unsafe { msg_send![super(this), init] }
    }
}

define_class!(
    #[unsafe(super = NSObject)]
    #[name = "HarnessBoxListenerDelegate"]
    struct ListenerDelegate;

    unsafe impl NSObjectProtocol for ListenerDelegate {}

    unsafe impl NSXPCListenerDelegate for ListenerDelegate {
        #[unsafe(method(listener:shouldAcceptNewConnection:))]
        fn accept(&self, _listener: &NSXPCListener, connection: &NSXPCConnection) -> bool {
            match accept_connection(connection) {
                Ok(()) => true,
                Err(error) => {
                    eprintln!("[box-host] refused a connection: {error}");
                    false
                }
            }
        }
    }
);

/// Start the shared driver if it is not already running.
///
/// Idempotent and serialised by the `DRIVER` lock, so several connections
/// arriving at once still produce exactly one driver — which is the whole point.
fn ensure_driver() -> io::Result<()> {
    let mut guard = DRIVER.lock().unwrap_or_else(|poison| poison.into_inner());
    if guard.is_some() {
        return Ok(());
    }
    let driver_path = std::env::current_exe()?
        .parent()
        .map(|dir| dir.join(DRIVER_BIN))
        .ok_or_else(|| io::Error::other("cannot locate the harness-box-host driver"))?;
    let mut child = Command::new(&driver_path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .map_err(|error| {
            io::Error::new(
                error.kind(),
                format!("spawning {}: {error}", driver_path.display()),
            )
        })?;
    let stdin = child.stdin.take().expect("stdin was piped");
    let stdout = child.stdout.take().expect("stdout was piped");
    *guard = Some(DriverProcess { child, stdin });
    drop(guard);
    std::thread::spawn(move || pump_driver_stdout(stdout));
    Ok(())
}

fn accept_connection(connection: &NSXPCConnection) -> io::Result<()> {
    ensure_driver()?;
    let id = NEXT_CONNECTION.fetch_add(1, Ordering::Relaxed);

    connection.setExportedInterface(Some(&host_interface()));
    let session = BoxSession::new(id);
    unsafe { connection.setExportedObject(Some(&session)) };
    connection.setRemoteObjectInterface(Some(&client_interface()));

    // Invalidation reaps this connection's commands, never the shared driver.
    let invalidation = RcBlock::new(move || close_connection(id));
    connection.setInvalidationHandler(Some(&invalidation));
    connection.resume();

    let proxy: Retained<AnyObject> = connection.remoteObjectProxy();
    CLIENTS
        .lock()
        .unwrap_or_else(|poison| poison.into_inner())
        .insert(id, SendProxy(proxy.clone()));
    // Delivered directly rather than routed: the caller has to learn it is on
    // NSXPC before it has sent anything for the driver to answer.
    deliver_frame(
        &proxy,
        transport_proof(std::process::id(), connection.processIdentifier()).as_bytes(),
    );
    Ok(())
}

fn deliver_frame(proxy: &AnyObject, line: &[u8]) {
    autoreleasepool(|_| {
        let data = NSData::with_bytes(line);
        unsafe {
            let _: () = msg_send![proxy, deliverFrame: &*data];
        }
    });
}

/// Read the shared driver's output and hand each frame to the connection it
/// belongs to.
///
/// One reader for one driver: the frames of many callers are interleaved here,
/// and `connectionId` is what separates them again. A frame naming no live
/// connection is dropped rather than broadcast — delivering one caller's box
/// output to another is worse than losing it.
fn pump_driver_stdout(stdout: ChildStdout) {
    let mut reader = io::BufReader::new(stdout);
    let reason = loop {
        let mut line = Vec::new();
        let read = reader
            .by_ref()
            .take((MAX_FRAME_BYTES + 1) as u64)
            .read_until(b'\n', &mut line);
        match read {
            Ok(0) => break "the box driver exited",
            Ok(_) if line.len() > MAX_FRAME_BYTES => {
                break "the box driver emitted an oversized frame";
            }
            Ok(_) => route_frame(&line),
            Err(_) => break "reading the box driver's output failed",
        }
    };
    reap_driver(reason);
}

fn route_frame(line: &[u8]) {
    let Some(connection) = frame_connection(line) else {
        return;
    };
    // Cloned out from under the lock: delivery is a cross-process call and has
    // no business holding the routing table while it runs.
    let proxy = CLIENTS
        .lock()
        .unwrap_or_else(|poison| poison.into_inner())
        .get(&connection)
        .map(|client| client.0.clone());
    if let Some(proxy) = proxy {
        deliver_frame(&proxy, line);
    }
}

fn frame_connection(line: &[u8]) -> Option<u64> {
    let value: serde_json::Value = serde_json::from_slice(line).ok()?;
    value.get("connectionId")?.as_u64()
}

fn fail_bridge(proxy: &AnyObject, reason: &str) {
    autoreleasepool(|_| {
        let message = NSString::from_str(reason);
        unsafe {
            let _: () = msg_send![proxy, hostFailed: &*message];
        }
    });
}

pub fn listen() {
    autoreleasepool(|_| {
        let delegate: Retained<ListenerDelegate> =
            unsafe { msg_send![ListenerDelegate::alloc(), init] };
        let listener = NSXPCListener::serviceListener();
        listener.setDelegate(Some(ProtocolObject::from_ref(&*delegate)));
        listener.resume();
    });
}

static STDOUT: Mutex<()> = Mutex::new(());

define_class!(
    #[unsafe(super = NSObject)]
    #[name = "HarnessBoxBridge"]
    struct BoxBridge;

    unsafe impl NSObjectProtocol for BoxBridge {}

    impl BoxBridge {
        #[unsafe(method(deliverFrame:))]
        fn deliver_frame(&self, frame: &NSData) {
            if frame.len() > MAX_FRAME_BYTES {
                bridge_die("the box service delivered an oversized frame");
            }
            let bytes = frame.to_vec();
            let _guard = STDOUT.lock().unwrap_or_else(|poison| poison.into_inner());
            let mut out = io::stdout().lock();
            if out.write_all(&bytes).is_err() || out.flush().is_err() {
                std::process::exit(0);
            }
        }

        #[unsafe(method(hostFailed:))]
        fn host_failed(&self, reason: &NSString) {
            bridge_die(&reason.to_string());
        }
    }
);

impl BoxBridge {
    fn new() -> Retained<Self> {
        unsafe { msg_send![Self::alloc(), init] }
    }
}

fn bridge_die(reason: &str) -> ! {
    eprintln!("[box-host] {reason}");
    let _ = io::stderr().flush();
    std::process::exit(1);
}

pub fn bridge() -> std::process::ExitCode {
    autoreleasepool(|_| {
        let connection = NSXPCConnection::initWithServiceName(
            NSXPCConnection::alloc(),
            &NSString::from_str(SERVICE),
        );
        connection.setRemoteObjectInterface(Some(&host_interface()));
        connection.setExportedInterface(Some(&client_interface()));
        let exported = BoxBridge::new();
        unsafe { connection.setExportedObject(Some(&exported)) };

        let interrupted = RcBlock::new(|| bridge_die("the box service was interrupted"));
        connection.setInterruptionHandler(Some(&interrupted));
        let invalidated = RcBlock::new(|| bridge_die("the box service connection was invalidated"));
        connection.setInvalidationHandler(Some(&invalidated));
        connection.resume();

        let proxy: Retained<AnyObject> = connection.remoteObjectProxy();
        send_frame(&proxy, b"\n");
        forward_stdin(&proxy);
        std::process::ExitCode::SUCCESS
    })
}

fn send_frame(proxy: &AnyObject, line: &[u8]) {
    autoreleasepool(|_| {
        let data = NSData::with_bytes(line);
        unsafe {
            let _: () = msg_send![proxy, sendFrame: &*data];
        }
    });
}

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
