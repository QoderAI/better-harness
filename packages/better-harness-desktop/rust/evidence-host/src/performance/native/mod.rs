//! Timing for the transcript formats that are not Qoder execution logs.
//!
//! Only the reader is platform-specific. Each one normalizes its own transcript
//! into the shared event vocabulary (`model.request.*`, `tool.*`, `turn.*`) and
//! then hands it to the same pairing and interval accounting that Qoder uses, so
//! a Claude or Codex Session is measured by identical rules rather than by a
//! second, parallel notion of "elapsed".
pub mod claude;
pub mod codex;

use super::{Coverage, Event, Evidence};
use serde_json::{Map, Value};
use std::{
    fs,
    io::{BufRead, BufReader, Read},
    path::{Path, PathBuf},
    time::SystemTime,
};

pub const MAX_FILE_BYTES: u64 = 24 * 1024 * 1024;
pub const MAX_EVENTS: usize = 20_000;
const MAX_LINE_BYTES: usize = 1024 * 1024;

/// One retained transcript file and the Session identity it states.
pub struct Transcript {
    pub id: String,
    pub path: PathBuf,
    pub modified: Option<SystemTime>,
}

/// A parsed transcript line, numbered from 1 so evidence points at the record a
/// reader can open for themselves.
pub struct Record {
    pub line: usize,
    pub value: Value,
}

/// Namespaced ids keep a Claude Session distinguishable from a Qoder Session
/// that happens to share a uuid, and let a detail request route itself.
pub fn namespaced(provider: &str, id: &str) -> String {
    format!("{provider}:{id}")
}

/// Split `provider:id`. Returns None for a bare Qoder id.
pub fn split_namespace(session_id: &str) -> Option<(&str, &str)> {
    let (provider, id) = session_id.split_once(':')?;
    (!provider.is_empty() && !id.is_empty()).then_some((provider, id))
}

/// A transcript is read only when it is a regular file inside its own provider
/// home: never a symlink, never a device, never a path a request supplied.
pub fn open_bounded(path: &Path, root: &Path) -> Option<(fs::File, u64)> {
    if !path.starts_with(root) {
        return None;
    }
    let meta = fs::symlink_metadata(path).ok()?;
    if !meta.is_file() || meta.file_type().is_symlink() || meta.len() > MAX_FILE_BYTES {
        return None;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if meta.file_attributes() & 0x400 != 0 {
            return None;
        }
    }
    let mut options = fs::OpenOptions::new();
    options.read(true);
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
    let file = options.open(path).ok()?;
    let length = file.metadata().ok().filter(|m| m.is_file())?.len();
    (length == meta.len()).then_some((file, length))
}

/// Read a transcript into numbered JSON records, accounting for everything that
/// could not be read rather than silently narrowing the evidence.
pub fn records(path: &Path, root: &Path, coverage: &mut Coverage) -> Vec<Record> {
    let Some((file, length)) = open_bounded(path, root) else {
        coverage.unreadable_files += 1;
        return Vec::new();
    };
    coverage.files += 1;
    let mut records = Vec::new();
    for (index, line) in BufReader::new(file.take(length)).lines().enumerate() {
        if records.len() >= MAX_EVENTS {
            coverage.truncated = true;
            break;
        }
        let Ok(line) = line else {
            coverage.invalid_lines += 1;
            continue;
        };
        if line.trim().is_empty() {
            continue;
        }
        if line.len() > MAX_LINE_BYTES {
            coverage.invalid_lines += 1;
            coverage.truncated = true;
            continue;
        }
        match serde_json::from_str::<Value>(&line) {
            Ok(value) => records.push(Record {
                line: index + 1,
                value,
            }),
            Err(_) => coverage.invalid_lines += 1,
        }
    }
    records
}

/// The portable evidence identifier for a transcript file. `source::read`
/// resolves it back to one of the discovered files, never to a client path.
pub fn evidence_source(index: usize, path: &Path) -> String {
    format!(
        "{}/transcript/{}",
        index + 1,
        path.file_name().unwrap_or_default().to_string_lossy()
    )
}

/// Builder for one normalized event. `kind` is the shared vocabulary; `marker`
/// names the record the boundary was actually read from.
pub struct EventBuilder {
    pub kind: &'static str,
    pub marker: String,
    pub at: i64,
    pub line: usize,
    pub seq: u64,
    pub turn: String,
    pub request: String,
    pub tool: String,
    pub data: Map<String, Value>,
}

impl EventBuilder {
    pub fn new(kind: &'static str, marker: impl Into<String>, at: i64, line: usize) -> Self {
        Self {
            kind,
            marker: marker.into(),
            at,
            line,
            seq: line as u64,
            turn: String::new(),
            request: String::new(),
            tool: String::new(),
            data: Map::new(),
        }
    }
    pub fn turn(mut self, id: impl Into<String>) -> Self {
        self.turn = id.into();
        self
    }
    pub fn request(mut self, id: impl Into<String>) -> Self {
        self.request = id.into();
        self
    }
    pub fn tool(mut self, id: impl Into<String>) -> Self {
        self.tool = id.into();
        self
    }
    pub fn fact(mut self, key: &str, value: Value) -> Self {
        if !value.is_null() {
            self.data.insert(key.into(), value);
        }
        self
    }
    pub fn build(self, source: &str) -> Event {
        Event {
            kind: self.kind.to_string(),
            at: self.at,
            seq: self.seq,
            turn: self.turn,
            loop_id: String::new(),
            request: self.request,
            tool: self.tool,
            data: Value::Object(self.data),
            evidence: Evidence {
                source: source.to_string(),
                line: self.line,
                event_type: self.marker,
                timestamp_ms: self.at,
            },
        }
    }
}

/// Bounded, redacted text for a Session title or a call summary.
pub fn safe_text(value: &str, limit: usize) -> String {
    let prepared = crate::privacy::redact_private_text(&crate::privacy::prepare_prompt_text(value));
    prepared
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(limit)
        .collect()
}

/// Reject a timestamp that cannot describe a retained Session.
pub fn stamp(value: &Value) -> Option<i64> {
    crate::time::millis(value).filter(|v| *v > 0 && *v < 253_402_300_800_000)
}
