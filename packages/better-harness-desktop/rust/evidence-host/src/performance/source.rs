//! On-demand JSONL windows. Never parse or allocate the whole source file.
use super::{SourceRequest, reader::safe_directory};
use serde_json::{Value, json};
use std::{fs, io::{BufRead, BufReader, Read}, path::{Path, PathBuf}};

const SCAN_BYTES: u64 = 32 * 1024 * 1024;
const LINE_BYTES: usize = 16 * 1024;
const DISPLAY_CHARS: usize = 4096;

pub fn call_summary(data: &Value) -> Option<String> {
    let args = &data["args"];
    let value = args.get("command").or_else(|| data.get("command"))
        .or_else(|| args.get("description")).or_else(|| args.get("file_path"))
        .or_else(|| args.get("path")).or_else(|| args.get("pattern"))
        .or_else(|| data.get("args"))?;
    let text = value.as_str().map(str::to_owned).unwrap_or_else(|| value.to_string());
    let safe = crate::privacy::redact_private_text(&text);
    if safe.trim().is_empty() { return None; }
    Some(safe.chars().take(480).collect())
}

pub fn read(home: &Path, dirs: &[PathBuf], request: &SourceRequest) -> Result<Value, String> {
    // This is a portable evidence identifier, never a filesystem path supplied
    // by the client. Resolve only one of the discovered session directories.
    let parts: Vec<_> = request.source.split('/').collect();
    if parts.len() != 3 || parts[1] != "segments" || !parts[2].ends_with(".jsonl")
        || parts[2].contains('\\') || parts[2].contains(':') || request.line == 0 || request.line > 1_000_000 {
        return Err("invalid-source-reference".into());
    }
    let index = parts[0].parse::<usize>().ok().and_then(|i| i.checked_sub(1)).ok_or("invalid-source-reference")?;
    let dir = dirs.get(index).ok_or("source-not-found")?.join("segments");
    if !safe_directory(&dir, home) { return Err("source-not-found".into()); }
    let path = dir.join(parts[2]);
    let meta = fs::symlink_metadata(&path).map_err(|_| "source-not-found")?;
    if !meta.is_file() || meta.file_type().is_symlink() { return Err("source-not-found".into()); }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if meta.file_attributes() & 0x400 != 0 { return Err("source-not-found".into()); }
    }
    let mut options = fs::OpenOptions::new(); options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        options.custom_flags(0x00200000);
    }
    let file = options.open(path).map_err(|_| "source-not-found")?;
    if !file.metadata().is_ok_and(|m| m.is_file()) { return Err("source-not-found".into()); }
    window(BufReader::new(file.take(SCAN_BYTES)), request)
}

fn window<R: BufRead>(mut reader: R, request: &SourceRequest) -> Result<Value, String> {
    let start = request.line.saturating_sub(3).max(1);
    let end = request.line + 3;
    let mut lines = Vec::new();
    let mut scanned = 0u64;
    let mut truncated = false;
    let mut found = false;
    for number in 1..=end {
        let mut bytes = Vec::new();
        let mut length = 0usize;
        let mut terminated = false;
        loop {
            let buffer = reader.fill_buf().map_err(|_| "source-read-failed")?;
            if buffer.is_empty() { break; }
            let size = buffer.iter().position(|&b| b == b'\n').map(|i| i + 1).unwrap_or(buffer.len());
            terminated = buffer[size - 1] == b'\n';
            if number >= start && length < LINE_BYTES { bytes.extend_from_slice(&buffer[..size.min(LINE_BYTES - length)]); }
            length += size;
            scanned += size as u64;
            reader.consume(size);
            if terminated { break; }
        }
        if length == 0 { break; }
        if number == request.line { found = true; }
        if number >= start {
            // Omit overlong lines rather than reveal a partially read secret.
            let text = if length > LINE_BYTES || (!terminated && scanned >= SCAN_BYTES) {
                truncated = true;
                "[Line exceeds preview limit]".to_string()
            } else {
                let safe = crate::privacy::redact_private_text(String::from_utf8_lossy(&bytes).trim_end());
                if safe.chars().count() > DISPLAY_CHARS {
                    truncated = true;
                    format!("{}…", safe.chars().take(DISPLAY_CHARS).collect::<String>())
                } else { safe }
            };
            lines.push(text);
        }
    }
    if !found { return Err(if scanned >= SCAN_BYTES { "source-scan-limit" } else { "source-line-not-found" }.into()); }
    Ok(json!({"schemaVersion":1,"engine":"rust","source":request.source,"line":request.line,
        "startLine":start,"content":lines.join("\n"),"truncated":truncated || scanned >= SCAN_BYTES,"scannedBytes":scanned}))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;
    #[test]
    fn scans_only_to_context_and_preserves_line_numbers() {
        let input = (1..=10000).map(|n| format!("{{\"line\":{n}}}\r\n")).collect::<String>();
        let result = window(Cursor::new(&input), &SourceRequest {source:"1/segments/a.jsonl".into(),line:44}).unwrap();
        assert_eq!(result["startLine"],41);
        let lines: Vec<_> = result["content"].as_str().unwrap().lines().collect();
        assert_eq!(lines.len(),7);
        assert_eq!(serde_json::from_str::<Value>(lines[3]).unwrap()["line"],44);
        assert!(result["scannedBytes"].as_u64().unwrap() < 1000);
        assert!(!result["content"].as_str().unwrap().contains('\r'));
    }
    #[test]
    fn bounds_long_lines_redacts_secrets_and_reports_missing_target() {
        let input = format!("{}\n{{\"password\":\"dont-show\"}}\n", "x".repeat(100000));
        let result = window(Cursor::new(input), &SourceRequest {source:"1/segments/a.jsonl".into(),line:2}).unwrap();
        assert_eq!(result["truncated"],true);
        assert!(result["content"].as_str().unwrap().len()<200);
        assert!(!result.to_string().contains("dont-show"));
        assert!(window(Cursor::new("a\n"), &SourceRequest {source:"x".into(),line:4}).is_err());
        assert!(call_summary(&json!({})).is_none());
        assert_eq!(call_summary(&json!({"args":{"command":"git status"}})).unwrap(),"git status");
    }
}
