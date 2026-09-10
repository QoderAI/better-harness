fn main() {
    println!("cargo:rerun-if-changed=src/box-protocol.m");
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        cc::Build::new()
            .file("src/box-protocol.m")
            .flag("-fobjc-arc")
            .flag("-fblocks")
            .compile("harness_box_protocol");
        println!("cargo:rustc-link-lib=framework=Foundation");
    }
}
