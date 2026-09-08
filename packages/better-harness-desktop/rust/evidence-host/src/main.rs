//! Newline-delimited JSON driver for the evidence host.

use std::io::{self, BufRead, Write};
use std::process::ExitCode;

use harness_evidence_host::handle_line;
use harness_evidence_host::wire::{MAX_REQUEST_BYTES, parse_request_frame};

fn main() -> ExitCode {
    let stdin = io::stdin();
    let mut stdout = io::stdout();
    let mut reader = stdin.lock();
    loop {
        let line = match read_line_bounded(&mut reader, MAX_REQUEST_BYTES) {
            Ok(None) => return ExitCode::SUCCESS,
            Ok(Some(line)) => line,
            Err(error) => {
                eprintln!("[evidence-host] {error}");
                return ExitCode::FAILURE;
            }
        };
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if let Err(error) = parse_request_frame(trimmed) {
            eprintln!("[evidence-host] {error}");
            return ExitCode::FAILURE;
        }
        match handle_line(trimmed) {
            Ok(reply) => {
                if stdout.write_all(reply.as_bytes()).is_err() || stdout.flush().is_err() {
                    return ExitCode::SUCCESS;
                }
                if trimmed.contains("\"method\":\"shutdown\"") {
                    return ExitCode::SUCCESS;
                }
            }
            Err(error) => {
                eprintln!("[evidence-host] {error}");
                return ExitCode::FAILURE;
            }
        }
    }
}

fn read_line_bounded<R: BufRead>(reader: &mut R, limit: usize) -> io::Result<Option<String>> {
    let mut out = Vec::new();
    loop {
        let available = reader.fill_buf()?;
        if available.is_empty() {
            return if out.is_empty() {
                Ok(None)
            } else {
                Ok(Some(String::from_utf8_lossy(&out).into_owned()))
            };
        }
        if let Some(index) = available.iter().position(|&byte| byte == b'\n') {
            if out.len() + index + 1 > limit {
                return Err(io::Error::other("request frame exceeded its size limit"));
            }
            out.extend_from_slice(&available[..=index]);
            reader.consume(index + 1);
            return Ok(Some(String::from_utf8_lossy(&out).into_owned()));
        }
        if out.len() + available.len() > limit {
            return Err(io::Error::other("request frame exceeded its size limit"));
        }
        out.extend_from_slice(available);
        let consumed = available.len();
        reader.consume(consumed);
    }
}
