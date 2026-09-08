fn main() {
    println!("cargo:rerun-if-changed=src/evidence-protocol.m");
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        cc::Build::new()
            .file("src/evidence-protocol.m")
            .flag("-fobjc-arc")
            .flag("-fblocks")
            .compile("harness_evidence_protocol");
        println!("cargo:rustc-link-lib=framework=Foundation");
    }
}
