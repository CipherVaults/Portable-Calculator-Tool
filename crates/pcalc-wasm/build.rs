//! Caps the WASM linear memory at 64 MiB (plan B3) for wasm32 builds only.

fn main() {
    println!("cargo:rerun-if-changed=build.rs");
    if std::env::var("CARGO_CFG_TARGET_ARCH").as_deref() == Ok("wasm32") {
        println!("cargo:rustc-link-arg=--max-memory=67108864");
    }
}
