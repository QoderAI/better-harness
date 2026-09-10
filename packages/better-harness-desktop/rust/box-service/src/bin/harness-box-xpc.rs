//! launchd entry point for the macOS box NSXPC service.
fn main() {
    #[cfg(target_os = "macos")]
    harness_box_host::xpc::listen();
    #[cfg(not(target_os = "macos"))]
    {
        eprintln!("NSXPC requires macOS");
        std::process::exit(2);
    }
}
