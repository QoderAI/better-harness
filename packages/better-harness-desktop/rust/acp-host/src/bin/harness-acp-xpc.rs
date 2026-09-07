//! launchd entry point for the macOS ACP NSXPC service. All behaviour is in
//! `harness_acp_host::xpc`; this binary only hands control to Foundation.
fn main() {
    #[cfg(target_os = "macos")]
    harness_acp_host::xpc::listen();
    #[cfg(not(target_os = "macos"))]
    {
        eprintln!("NSXPC requires macOS");
        std::process::exit(2);
    }
}
