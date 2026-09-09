fn main() {
    #[cfg(target_os = "macos")]
    harness_ontology_service::nsxpc::listen();
    #[cfg(not(target_os = "macos"))]
    {
        eprintln!("NSXPC requires macOS");
        std::process::exit(2);
    }
}
