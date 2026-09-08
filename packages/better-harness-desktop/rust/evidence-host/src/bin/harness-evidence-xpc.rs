//! launchd entry point for the macOS evidence NSXPC service.
fn main() {
    #[cfg(target_os = "macos")]
    harness_evidence_host::xpc::listen();
    #[cfg(not(target_os = "macos"))]
    {
        eprintln!("NSXPC requires macOS");
        std::process::exit(2);
    }
}
