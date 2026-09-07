use harness_oxc_service::serve;
use std::io;
fn main() -> io::Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args == ["--version"] {
        println!("harness-oxc-service 0.1.0 (oxc 0.147.0; protocol 1)");
        return Ok(());
    }
    if args == ["--help"] {
        println!(
            "harness-oxc-service [--version|--help]\nReads protocol v1 JSONL parse/transform requests from stdin; writes JSONL results to stdout."
        );
        return Ok(());
    }
    if !args.is_empty() {
        eprintln!("Unknown argument. Use --help.");
        std::process::exit(2);
    }
    serve(io::stdin().lock(), io::stdout().lock())
}
