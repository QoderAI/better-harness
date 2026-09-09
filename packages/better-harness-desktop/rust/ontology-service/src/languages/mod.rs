//! One module per registered language. Native pilots supply a grammar
//! function and an entity query; `pending` lists the languages that are
//! registered but wait on a `.wasm` grammar buffer (ADR-0008).

#[cfg(feature = "native-grammars")]
pub mod go;
#[cfg(feature = "native-grammars")]
pub mod javascript;
pub mod pending;
#[cfg(feature = "native-grammars")]
pub mod python;
#[cfg(feature = "native-grammars")]
pub mod rust;
#[cfg(feature = "native-grammars")]
pub mod tsx;
#[cfg(feature = "native-grammars")]
pub mod typescript;

// Without `native-grammars`, every language falls back to a `WasmPending`
// entry so `host.describe` still lists all eleven ids and every method stays
// callable (returning `grammar-unavailable`) rather than failing to compile.
#[cfg(not(feature = "native-grammars"))]
pub mod go {
    pub const ENTRY: crate::grammar::LanguageEntry =
        crate::languages::pending::entry("go", "Go", &["go"]);
}
#[cfg(not(feature = "native-grammars"))]
pub mod javascript {
    pub const ENTRY: crate::grammar::LanguageEntry =
        crate::languages::pending::entry("javascript", "JavaScript", &["js", "jsx", "mjs", "cjs"]);
}
#[cfg(not(feature = "native-grammars"))]
pub mod python {
    pub const ENTRY: crate::grammar::LanguageEntry =
        crate::languages::pending::entry("python", "Python", &["py", "pyi"]);
}
#[cfg(not(feature = "native-grammars"))]
pub mod rust {
    pub const ENTRY: crate::grammar::LanguageEntry =
        crate::languages::pending::entry("rust", "Rust", &["rs"]);
}
#[cfg(not(feature = "native-grammars"))]
pub mod tsx {
    pub const ENTRY: crate::grammar::LanguageEntry =
        crate::languages::pending::entry("tsx", "TSX", &["tsx"]);
}
#[cfg(not(feature = "native-grammars"))]
pub mod typescript {
    pub const ENTRY: crate::grammar::LanguageEntry =
        crate::languages::pending::entry("typescript", "TypeScript", &["ts", "cts", "mts"]);
}
