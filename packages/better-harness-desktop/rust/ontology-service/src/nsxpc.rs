//! Foundation NSXPC transport. The JSONL bridge contains no extraction calls.
//! Structurally identical to `harness-oxc-service::nsxpc` and
//! `harness-evidence-host::nsxpc` — only the service name and the inner
//! `crate::wire::handle` call differ. Kept that way deliberately so the three
//! hosts stay reviewable together.
use crate::wire::{MAX_REQUEST, MAX_RESPONSE, handle};
use block2::{DynBlock, ManualBlockEncoding, RcBlock};
use objc2::rc::{Retained, autoreleasepool};
use objc2::runtime::{AnyProtocol, ProtocolObject};
use objc2::{AnyThread, define_class, msg_send};
use objc2_foundation::{
    NSData, NSError, NSObject, NSObjectProtocol, NSString, NSXPCConnection, NSXPCInterface,
    NSXPCListener, NSXPCListenerDelegate,
};
use std::io::{self, BufRead, Read, Write};
use std::ptr::NonNull;
use std::sync::{Mutex, mpsc};
use std::time::Duration;

// NSXPC inspects the runtime block signature, not just the protocol metadata.
struct DataReplyEncoding;
// SAFETY: Supported macOS targets are 64-bit; void, hidden block, NSData*.
unsafe impl ManualBlockEncoding for DataReplyEncoding {
    type Arguments = (NonNull<NSData>,);
    type Return = ();
    const ENCODING_CSTR: &'static std::ffi::CStr = cr#"v16@?0@"NSData"8"#;
}

const SERVICE: &str = "com.qoder.harness-studio.ontology";
// Bound total extraction concurrency and memory across connections.
static EXTRACTOR: Mutex<()> = Mutex::new(());
unsafe extern "C" {
    fn harness_ontology_protocol() -> *const AnyProtocol;
}
fn interface() -> Retained<NSXPCInterface> {
    // SAFETY: Clang provides a process-lifetime protocol with the exact NSData
    // and reply-block signatures implemented below. Neither side exports others.
    unsafe { NSXPCInterface::interfaceWithProtocol(&*harness_ontology_protocol()) }
}

define_class!(
    #[unsafe(super = NSObject)]
    struct OntologyService;
    unsafe impl NSObjectProtocol for OntologyService {}
    impl OntologyService {
        #[unsafe(method(performRequest:reply:))]
        fn perform_request(&self, request: &NSData, reply: &DynBlock<dyn Fn(NonNull<NSData>)>) {
            autoreleasepool(|_| {
                let result = std::panic::catch_unwind(|| {
                    if request.length() > MAX_REQUEST {
                        return serde_json::json!({"version":1,"id":null,"error":{"code":"request-limit"}});
                    }
                    let _lock = EXTRACTOR.lock().unwrap_or_else(|poison| poison.into_inner());
                    // A disconnected client cannot cancel synchronous extraction. Bound
                    // work independently of the bridge; launchd restarts on exit.
                    let (done, wait) = mpsc::channel::<()>();
                    let watchdog = std::thread::spawn(move || {
                        if matches!(wait.recv_timeout(Duration::from_secs(30)), Err(mpsc::RecvTimeoutError::Timeout)) {
                            std::process::exit(70);
                        }
                    });
                    let result = handle(&request.to_vec());
                    drop(done);
                    let _ = watchdog.join();
                    result
                });
                let value = result.unwrap_or_else(|_| serde_json::json!({"version":1,"id":null,"error":{"code":"extractor-panic"}}));
                let mut bytes = serde_json::to_vec(&value).unwrap_or_default();
                if bytes.len() > MAX_RESPONSE {
                    bytes = serde_json::to_vec(&serde_json::json!({"version":1,"id":value["id"],"error":{"code":"response-limit"}})).unwrap();
                }
                let data = NSData::with_bytes(&bytes);
                reply.call((NonNull::from(&*data),));
            });
        }
    }
);

define_class!(
    #[unsafe(super = NSObject)]
    struct ListenerDelegate;
    unsafe impl NSObjectProtocol for ListenerDelegate {}
    unsafe impl NSXPCListenerDelegate for ListenerDelegate {
        #[unsafe(method(listener:shouldAcceptNewConnection:))]
        fn accept(&self, _listener: &NSXPCListener, connection: &NSXPCConnection) -> bool {
            connection.setExportedInterface(Some(&interface()));
            // SAFETY: NSObject init and exported method signatures match Foundation.
            let object: Retained<OntologyService> =
                unsafe { msg_send![OntologyService::alloc(), init] };
            unsafe {
                connection.setExportedObject(Some(&object));
            }
            connection.resume();
            true
        }
    }
);

pub fn listen() {
    autoreleasepool(|_| {
        let delegate: Retained<ListenerDelegate> =
            unsafe { msg_send![ListenerDelegate::alloc(), init] };
        let listener = NSXPCListener::serviceListener();
        listener.setDelegate(Some(ProtocolObject::from_ref(&*delegate)));
        listener.resume(); // serviceListener hands control to Foundation; never returns.
    });
}

/// One connection per bridge. No source enters the client's extraction core.
/// EOF invalidates the connection; the host kills the bridge on its own deadline.
pub fn bridge() -> io::Result<()> {
    autoreleasepool(|_| {
        let connection = NSXPCConnection::initWithServiceName(
            NSXPCConnection::alloc(),
            &NSString::from_str(SERVICE),
        );
        connection.setRemoteObjectInterface(Some(&interface()));
        connection.resume();
        let result = forward(&connection);
        connection.invalidate();
        result
    })
}

fn forward(connection: &NSXPCConnection) -> io::Result<()> {
    let mut input = io::stdin().lock();
    let mut output = io::stdout().lock();
    loop {
        let mut frame = Vec::new();
        let bytes = input
            .by_ref()
            .take((MAX_REQUEST + 1) as u64)
            .read_until(b'\n', &mut frame)?;
        if bytes == 0 {
            return Ok(());
        }
        if bytes > MAX_REQUEST || frame.last() != Some(&b'\n') {
            return Err(io::Error::other(
                "NSXPC request frame limit or truncated frame",
            ));
        }
        let response = autoreleasepool(|_| -> io::Result<Vec<u8>> {
            let (send, receive) = mpsc::channel();
            let failed = send.clone();
            let error = RcBlock::new(move |_error: NonNull<NSError>| {
                let _ = failed.send(Err(io::Error::other("NSXPC connection failed")));
            });
            let reply = RcBlock::with_encoding::<_, _, _, DataReplyEncoding>(
                move |data: NonNull<NSData>| {
                    // SAFETY: NSXPCInterface restricts this argument to NSData and
                    // Foundation keeps it alive for the duration of the callback.
                    let data = unsafe { data.as_ref() };
                    let result = if data.length() > MAX_RESPONSE {
                        Err(io::Error::other("NSXPC response limit"))
                    } else {
                        Ok(data.to_vec())
                    };
                    let _ = send.send(result);
                },
            );
            let proxy = connection.remoteObjectProxyWithErrorHandler(&error);
            let data = NSData::with_bytes(&frame);
            // SAFETY: selector and argument encodings are supplied by the shared
            // Clang protocol; NSXPC copies the reply block before returning.
            unsafe {
                let _: () = msg_send![&*proxy, performRequest: &*data, reply: &*reply];
            }
            receive
                .recv_timeout(Duration::from_secs(30))
                .map_err(|_| io::Error::other("NSXPC reply deadline"))?
        })?;
        let mut value: serde_json::Value = serde_json::from_slice(&response)?;
        let service_pid = connection.processIdentifier();
        if service_pid <= 0 || value["pid"].as_i64() != Some(i64::from(service_pid)) {
            return Err(io::Error::other("NSXPC reply has invalid service identity"));
        }
        value["transport"] = "nsxpc".into();
        value["bridgePid"] = std::process::id().into();
        serde_json::to_writer(&mut output, &value)?;
        output.write_all(b"\n")?;
        output.flush()?;
    }
}
