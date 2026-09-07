fn main() -> std::io::Result<()> {
    #[cfg(target_os = "macos")]
    {
        harness_oxc_service::nsxpc::bridge()
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err(std::io::Error::other("NSXPC requires macOS"))
    }
}
