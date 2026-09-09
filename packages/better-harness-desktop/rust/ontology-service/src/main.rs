use harness_ontology_service::serve;
use std::io;

fn main() -> io::Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args == ["--version"] {
        println!("harness-ontology-service 0.1.0 (tree-sitter 0.27; protocol 1)");
        return Ok(());
    }
    if args == ["--help"] {
        println!(
            "harness-ontology-service [--version|--help]\nReads protocol v1 JSONL host.describe/languages.list/ontology.extract requests from stdin; writes JSONL results to stdout."
        );
        return Ok(());
    }
    if !args.is_empty() {
        eprintln!("Unknown argument. Use --help.");
        std::process::exit(2);
    }
    serve(io::stdin().lock(), io::stdout().lock())
}
