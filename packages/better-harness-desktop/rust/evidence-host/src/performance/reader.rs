use super::{Coverage, Event, Evidence, PerformanceParams, analyze};
use crate::paths::{normalize_workspace, qoder_slug_variants};
use crate::platforms::qoder::qoder_home;
use crate::time::millis;
use serde_json::{Value, json};
use std::{
    collections::BTreeMap,
    fs,
    io::{BufRead, BufReader, Read},
    path::{Path, PathBuf},
};

const MAX_FILE_BYTES: u64 = 8 * 1024 * 1024;
const MAX_SESSION_BYTES: u64 = 32 * 1024 * 1024;
const MAX_CATALOG_BYTES: u64 = 128 * 1024 * 1024;
const MAX_EVENTS: usize = 20_000;
const MAX_LINE_BYTES: usize = 1024 * 1024;
const MAX_FILES: usize = 128;
const MAX_DIRECTORIES: usize = 2_000;

pub fn read(params: PerformanceParams) -> Result<Value, String> {
    if params.workspace.trim().is_empty() {
        return Err("workspace-required".into());
    }
    if params.session_id.as_deref().is_some_and(|id| !valid_id(id)) {
        return Err("invalid-session-id".into());
    }
    let workspace = normalize_workspace(&params.workspace);
    if !workspace.is_dir() {
        return Err("workspace-unavailable".into());
    }
    let home = params
        .qoder_home
        .map(PathBuf::from)
        .unwrap_or_else(qoder_home);
    let limit = params.max_sessions.unwrap_or(200).clamp(1, 500);
    let mut dirs: BTreeMap<String, Vec<PathBuf>> = BTreeMap::new();
    let (mut unreadable, mut directory_limit) = (0, false);
    for slug in qoder_slug_variants(&workspace) {
        let root = home.join("logs").join("sessions").join(slug);
        if !root.exists() {
            continue;
        }
        if !safe_directory(&root, &home) {
            unreadable += 1;
            continue;
        }
        let entries = fs::read_dir(&root).map_err(|_| "session-logs-unreadable")?;
        for entry in entries {
            let Ok(entry) = entry else {
                unreadable += 1;
                continue;
            };
            let id = entry.file_name().to_string_lossy().into_owned();
            if !valid_id(&id) || !entry.file_type().is_ok_and(|t| t.is_dir()) {
                continue;
            }
            if params
                .session_id
                .as_ref()
                .is_some_and(|wanted| wanted != &id)
            {
                continue;
            }
            if dirs.len() >= MAX_DIRECTORIES && !dirs.contains_key(&id) {
                directory_limit = true;
                continue;
            }
            dirs.entry(id).or_default().push(entry.path());
        }
    }
    let mut selected: Vec<_> = dirs.into_iter().collect();
    let discovered = selected.len();
    // Rotation/continued sessions change segment mtimes, not necessarily the
    // parent directory mtime. Rank bounded source files before selecting.
    selected.sort_by_cached_key(|(id, paths)| {
        let modified = paths
            .iter()
            .flat_map(|p| segment_paths(p).0)
            .filter_map(|p| fs::metadata(p).ok()?.modified().ok())
            .max();
        (std::cmp::Reverse(modified), id.clone())
    });
    selected.truncate(limit);
    let mut sessions = Vec::new();
    let mut remaining = MAX_CATALOG_BYTES;
    for (id, paths) in selected {
        if remaining == 0 {
            break;
        }
        let (events, coverage, bytes) =
            read_events(&home, &paths, remaining.min(MAX_SESSION_BYTES));
        remaining = remaining.saturating_sub(bytes);
        let mut detail = analyze::analyze(&id, events, coverage);
        if params.session_id.is_some() {
            return serde_json::to_value(detail).map_err(|_| "performance-encode-failed".into());
        }
        // The catalog only needs the top-level partition. Drilldown calls are
        // returned on explicit detail reads, keeping the catalog frame bounded.
        for segment in &mut detail.session.breakdown.segments {
            segment.parts.clear();
            segment.call_parts.clear();
        }
        sessions.push(detail.session);
    }
    if params.session_id.is_some() {
        return Err("session-timing-not-found".into());
    }
    sessions.sort_by_key(|s| {
        (
            std::cmp::Reverse(s.longest_ms),
            std::cmp::Reverse(s.last_activity_ms),
            s.id.clone(),
        )
    });
    let omitted = discovered.saturating_sub(sessions.len());
    Ok(json!({
        "schemaVersion": 1, "engine": "rust", "provider": "qoder",
        "status": if sessions.is_empty() && unreadable == 0 { "no-evidence" }
            else if omitted > 0 || directory_limit || unreadable > 0 || sessions.iter().any(|s| s.coverage.partial()) { "partial" } else { "ok" },
        "sessions": sessions,
        "coverage": { "discoveredSessions": discovered, "omittedSessions": omitted,
            "directoryLimitReached": directory_limit, "unreadableDirectories": unreadable },
    }))
}

fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 160
        && id != "."
        && id != ".."
        && id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'-' | b'_' | b'.'))
}

fn safe_directory(path: &Path, home: &Path) -> bool {
    let Ok(relative) = path.strip_prefix(home) else {
        return false;
    };
    let mut cursor = home.to_path_buf();
    for component in relative.components() {
        cursor.push(component);
        if !fs::symlink_metadata(&cursor).is_ok_and(|m| m.is_dir() && !m.file_type().is_symlink()) {
            return false;
        }
        #[cfg(windows)]
        {
            use std::os::windows::fs::MetadataExt;
            if fs::symlink_metadata(&cursor).is_ok_and(|m| m.file_attributes() & 0x400 != 0) {
                return false;
            }
        }
    }
    true
}

fn segment_paths(session: &Path) -> (Vec<PathBuf>, bool) {
    let root = session.join("segments");
    if !fs::symlink_metadata(&root).is_ok_and(|m| m.is_dir() && !m.file_type().is_symlink()) {
        return (Vec::new(), false);
    }
    let mut files = Vec::new();
    let mut truncated = false;
    if let Ok(entries) = fs::read_dir(root) {
        for entry in entries.flatten() {
            if entry.path().extension().is_some_and(|ext| ext == "jsonl") {
                if files.len() >= MAX_FILES {
                    truncated = true;
                    break;
                }
                files.push(entry.path());
            }
        }
    }
    files.sort();
    (files, truncated)
}

fn read_events(home: &Path, dirs: &[PathBuf], budget: u64) -> (Vec<Event>, Coverage, u64) {
    let mut coverage = Coverage::default();
    let mut events = Vec::new();
    let mut bytes = 0;
    for (root_index, dir) in dirs.iter().enumerate() {
        if !safe_directory(&dir.join("segments"), home) {
            coverage.unreadable_files += 1;
            continue;
        }
        let (files, truncated) = segment_paths(dir);
        coverage.truncated |= truncated;
        for path in files {
            let Ok(meta) = fs::symlink_metadata(&path) else {
                coverage.unreadable_files += 1;
                continue;
            };
            if !meta.is_file() || meta.file_type().is_symlink() {
                coverage.unreadable_files += 1;
                continue;
            }
            #[cfg(windows)]
            {
                use std::os::windows::fs::MetadataExt;
                if meta.file_attributes() & 0x400 != 0 {
                    coverage.unreadable_files += 1;
                    continue;
                }
            }
            if meta.len() > MAX_FILE_BYTES
                || bytes + meta.len() > budget
                || events.len() >= MAX_EVENTS
            {
                coverage.truncated = true;
                continue;
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
            let Ok(file) = options.open(&path) else {
                coverage.unreadable_files += 1;
                continue;
            };
            if !file
                .metadata()
                .is_ok_and(|m| m.is_file() && m.len() == meta.len())
            {
                coverage.unreadable_files += 1;
                continue;
            }
            coverage.files += 1;
            bytes += meta.len();
            let source = format!(
                "{}/segments/{}",
                root_index + 1,
                path.file_name().unwrap_or_default().to_string_lossy()
            );
            for (index, line) in BufReader::new(file.take(meta.len())).lines().enumerate() {
                if events.len() >= MAX_EVENTS {
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
                let Ok(raw) = serde_json::from_str::<Value>(&line) else {
                    coverage.invalid_lines += 1;
                    continue;
                };
                let Some(at) = millis(&raw["ts"]).filter(|v| *v > 0 && *v < 253_402_300_800_000)
                else {
                    coverage.invalid_timestamps += 1;
                    continue;
                };
                let Some(kind) = raw["type"].as_str() else {
                    coverage.invalid_lines += 1;
                    continue;
                };
                let text = |key: &str| {
                    raw[key]
                        .as_str()
                        .unwrap_or("")
                        .chars()
                        .take(256)
                        .collect::<String>()
                };
                // Keep only metadata used by this analysis. Tool arguments,
                // commands, outputs and arbitrary error messages never leave
                // the input line or enter a service response.
                let mut data = serde_json::Map::new();
                for key in [
                    "model",
                    "tool_name",
                    "hook_event_name",
                    "hook_name",
                    "source",
                    "hook_index",
                    "duration_ms",
                    "is_subagent",
                    "request_index",
                    "prompt_id",
                    "fork_label",
                    "phase",
                    "status",
                    "success",
                    "allowed",
                    "is_error",
                    "exit_code",
                    "aborted",
                    "attempt",
                    "will_retry",
                    "error_name",
                    "error_code",
                    "stream_event_count",
                    "input_tokens",
                    "output_tokens",
                    "cache_read_input_tokens",
                    "stop_reason",
                ] {
                    if let Some(value) = raw["data"]
                        .get(key)
                        .filter(|v| !v.is_object() && !v.is_array())
                    {
                        data.insert(key.to_string(), value.clone());
                    }
                }
                events.push(Event {
                    kind: kind.to_string(),
                    at,
                    seq: raw["seq"].as_u64().unwrap_or(index as u64),
                    turn: text("turn_id"),
                    loop_id: text("loop_id"),
                    request: text("request_id"),
                    tool: text("tool_call_id"),
                    data: Value::Object(data),
                    evidence: Evidence {
                        source: source.clone(),
                        line: index + 1,
                        event_type: kind.to_string(),
                        timestamp_ms: at,
                    },
                });
            }
        }
    }
    events
        .sort_by(|a, b| (a.at, &a.evidence.source, a.seq).cmp(&(b.at, &b.evidence.source, b.seq)));
    coverage.events = events.len();
    (events, coverage, bytes)
}
