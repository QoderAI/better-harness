//! stdio<->NSXPC bridge Studio spawns in place of `harness-acp-host` on macOS.
//! It performs no ACP work: it forwards newline frames to the launchd-managed
//! service and writes the service's replies and events back to stdout.
fn main() -> std::process::ExitCode {
    #[cfg(target_os = "macos")]
    {
        harness_acp_host::xpc::bridge()
    }
    #[cfg(not(target_os = "macos"))]
    {
        eprintln!("NSXPC requires macOS");
        std::process::ExitCode::from(2)
    }
}
