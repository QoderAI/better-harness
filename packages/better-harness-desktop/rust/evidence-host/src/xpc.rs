//! Foundation NSXPC transport for the desktop evidence host.
//!
//! ```text
//!  Studio (Node)                 launchd service
//!  ────────────                  ──────────────
//!  harness-evidence-client <NSXPC> harness-evidence-xpc <stdio> harness-evidence-host
//! ```
//!
//! No discovery logic lives here. The driver is unmodified.

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

use crate::wire::{MAX_FRAME_BYTES, MAX_REQUEST_BYTES, transport_proof};

const SERVICE: &str = "com.qoder.harness-studio.evidence";
const DRIVER_BIN: &str = "harness-evidence-host";
const REAP_GRACE: Duration = Duration::from_secs(5);

unsafe extern "C" {
    fn harness_evidence_host_protocol() -> *const AnyProtocol;
    fn harness_evidence_client_protocol() -> *const AnyProtocol;
}

fn host_interface() -> Retained<NSXPCInterface> {
    unsafe { NSXPCInterface::interfaceWithProtocol(&*harness_evidence_host_protocol()) }
}

fn client_interface() -> Retained<NSXPCInterface> {
    unsafe { NSXPCInterface::interfaceWithProtocol(&*harness_evidence_client_protocol()) }
}

struct SendConn(Retained<NSXPCConnection>);
unsafe impl Send for SendConn {}

struct SendProxy(Retained<AnyObject>);
unsafe impl Send for SendProxy {}

struct DriverProcess {
    child: Child,
    stdin: ChildStdin,
}

type SharedDriver = Arc<Mutex<Option<DriverProcess>>>;

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

define_class!(
    #[unsafe(super = NSObject)]
    #[name = "HarnessEvidenceSession"]
    #[ivars = SharedDriver]
    struct EvidenceSession;

    unsafe impl NSObjectProtocol for EvidenceSession {}

    impl EvidenceSession {
        #[unsafe(method(sendFrame:))]
        fn send_frame(&self, frame: &NSData) {
            if frame.len() > MAX_REQUEST_BYTES {
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
                reap_driver(self.ivars());
            }
        }
    }
);

impl Drop for EvidenceSession {
    fn drop(&mut self) {
        reap_driver(self.ivars());
    }
}

impl EvidenceSession {
    fn new(shared: SharedDriver) -> Retained<Self> {
        let this = Self::alloc().set_ivars(shared);
        unsafe { msg_send![super(this), init] }
    }
}

define_class!(
    #[unsafe(super = NSObject)]
    #[name = "HarnessEvidenceListenerDelegate"]
    struct ListenerDelegate;

    unsafe impl NSObjectProtocol for ListenerDelegate {}

    unsafe impl NSXPCListenerDelegate for ListenerDelegate {
        #[unsafe(method(listener:shouldAcceptNewConnection:))]
        fn accept(&self, _listener: &NSXPCListener, connection: &NSXPCConnection) -> bool {
            match accept_connection(connection) {
                Ok(()) => true,
                Err(error) => {
                    eprintln!("[evidence-host] refused a connection: {error}");
                    false
                }
            }
        }
    }
);

fn accept_connection(connection: &NSXPCConnection) -> io::Result<()> {
    let driver_path = std::env::current_exe()?
        .parent()
        .map(|dir| dir.join(DRIVER_BIN))
        .ok_or_else(|| io::Error::other("cannot locate the harness-evidence-host driver"))?;
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
    let session = EvidenceSession::new(shared.clone());
    unsafe { connection.setExportedObject(Some(&session)) };
    connection.setRemoteObjectInterface(Some(&client_interface()));

    let handler_shared = shared.clone();
    let invalidation = RcBlock::new(move || reap_driver(&handler_shared));
    connection.setInvalidationHandler(Some(&invalidation));
    connection.resume();

    let proxy: Retained<AnyObject> = connection.remoteObjectProxy();
    deliver_frame(
        &proxy,
        transport_proof(std::process::id(), connection.processIdentifier()).as_bytes(),
    );

    let pump_conn = SendConn(connection.retain());
    let pump_proxy = SendProxy(proxy);
    std::thread::spawn(move || pump_driver_stdout(pump_conn, pump_proxy, stdout, shared));
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
            Ok(0) => break "the evidence driver exited",
            Ok(_) if line.len() > MAX_FRAME_BYTES => {
                break "the evidence driver emitted an oversized frame";
            }
            Ok(_) => deliver_frame(&proxy, &line),
            Err(_) => break "reading the evidence driver's output failed",
        }
    };
    fail_bridge(&proxy, reason);
    connection.0.invalidate();
    reap_driver(&shared);
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
    #[name = "HarnessEvidenceBridge"]
    struct EvidenceBridge;

    unsafe impl NSObjectProtocol for EvidenceBridge {}

    impl EvidenceBridge {
        #[unsafe(method(deliverFrame:))]
        fn deliver_frame(&self, frame: &NSData) {
            if frame.len() > MAX_FRAME_BYTES {
                bridge_die("the evidence service delivered an oversized frame");
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

impl EvidenceBridge {
    fn new() -> Retained<Self> {
        unsafe { msg_send![Self::alloc(), init] }
    }
}

fn bridge_die(reason: &str) -> ! {
    eprintln!("[evidence-host] {reason}");
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
        let exported = EvidenceBridge::new();
        unsafe { connection.setExportedObject(Some(&exported)) };

        let interrupted = RcBlock::new(|| bridge_die("the evidence service was interrupted"));
        connection.setInterruptionHandler(Some(&interrupted));
        let invalidated = RcBlock::new(|| bridge_die("the evidence service connection was invalidated"));
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
