use super::native;
use super::{analyze, Coverage, Detail, Event, Evidence, PerformanceParams, Summary};
use crate::paths::{expand_home, normalize_workspace, qoder_slug_variants};
use crate::platforms::qoder::qoder_home;
use crate::time::millis;
use serde_json::{json, Value};
use std::{
    cmp::Reverse,
    collections::BTreeMap,
    fs,
    io::{BufRead, BufReader, Read},
    path::{Path, PathBuf},
    time::SystemTime,
};

const MAX_FILE_BYTES: u64 = 8 * 1024 * 1024;
const MAX_SESSION_BYTES: u64 = 32 * 1024 * 1024;
const MAX_CATALOG_BYTES: u64 = 128 * 1024 * 1024;
const MAX_EVENTS: usize = 20_000;
const MAX_LINE_BYTES: usize = 1024 * 1024;
const MAX_FILES: usize = 128;
const MAX_DIRECTORIES: usize = 2_000;

/// Route by the namespace the Session id carries. A bare id is a Qoder
/// execution log; `claude:`/`codex:` name a retained transcript read by the
/// matching native reader. A catalog request asks all three.
pub fn read(params: PerformanceParams) -> Result<Value, String> {
    if params.workspace.trim().is_empty() {
        return Err("workspace-required".into());
    }
    if params
        .session_id
        .as_deref()
        .is_some_and(|id| !valid_request_id(id))
    {
        return Err("invalid-session-id".into());
    }
    if params.source.is_some() && params.session_id.is_none() {
        return Err("source-session-required".into());
    }
    let workspace = normalize_workspace(&params.workspace);
    if !workspace.is_dir() {
        return Err("workspace-unavailable".into());
    }
    match params
        .session_id
        .as_deref()
        .and_then(native::split_namespace)
    {
        Some((provider, _)) if native_provider(provider) => {
            return native_detail(&params, &workspace);
        }
        Some(_) => return Err("session-timing-not-found".into()),
        None => {}
    }
    if params.session_id.is_none() {
        return catalog(&params, &workspace);
    }
    qoder(&params, &workspace)
}

pub fn native_provider(provider: &str) -> bool {
    matches!(provider, native::claude::PROVIDER | native::codex::PROVIDER)
}

enum Ranked {
    Qoder {
        id: String,
        paths: Vec<PathBuf>,
    },
    Native {
        provider: &'static str,
        transcript: native::Transcript,
    },
}

/// The catalog spans every provider this host can measure. Rank by observed
/// mtime, then analyse only the global cap — not 200 rows per provider.
fn catalog(params: &PerformanceParams, workspace: &Path) -> Result<Value, String> {
    let limit = params.max_sessions.unwrap_or(200).clamp(1, 500);
    let (home, qoder_sessions, mut unreadable, directory_limit) = list_qoder(params, workspace)?;
    let mut ranked: Vec<(Option<SystemTime>, Ranked)> = qoder_sessions
        .into_iter()
        .map(|(id, paths, modified)| (modified, Ranked::Qoder { id, paths }))
        .collect();
    for provider in [native::claude::PROVIDER, native::codex::PROVIDER] {
        for transcript in native_transcripts(params, workspace, provider) {
            ranked.push((
                transcript.modified,
                Ranked::Native {
                    provider,
                    transcript,
                },
            ));
        }
    }
    ranked.sort_by(|left, right| right.0.cmp(&left.0));
    let discovered = ranked.len();
    ranked.truncate(limit);
    let omitted = discovered.saturating_sub(ranked.len());
    let mut sessions = Vec::new();
    let mut remaining = MAX_CATALOG_BYTES;
    let mut partial = omitted > 0 || directory_limit || unreadable > 0;
    for (_, entry) in ranked {
        let summary = match entry {
            Ranked::Qoder { id, paths } => {
                if remaining == 0 {
                    partial = true;
                    continue;
                }
                let (events, coverage, bytes) =
                    read_events(&home, &paths, remaining.min(MAX_SESSION_BYTES));
                remaining = remaining.saturating_sub(bytes);
                if coverage.unreadable_files > 0 {
                    unreadable += 1;
                }
                analyze::summarize(&id, events, coverage)
            }
            Ranked::Native {
                provider,
                transcript,
            } => {
                let summary = native_summary_for(provider, &transcript, params);
                if summary.coverage.unreadable_files > 0 {
                    unreadable += 1;
                }
                summary
            }
        };
        partial |= summary.status == "partial";
        sessions.push(
            serde_json::to_value(summary).map_err(|_| "performance-encode-failed".to_string())?,
        );
    }
    sessions.sort_by(|left, right| {
        let key = |value: &Value| {
            (
                Reverse(value["longestMs"].as_i64().unwrap_or(0)),
                Reverse(value["lastActivityMs"].as_i64().unwrap_or(0)),
                value["id"].as_str().unwrap_or("").to_string(),
            )
        };
        key(left).cmp(&key(right))
    });
    Ok(json!({
        "schemaVersion": 1, "engine": "rust", "provider": "multi",
        "status": if sessions.is_empty() && unreadable == 0 { "no-evidence" }
            else if omitted > 0 || directory_limit || unreadable > 0 || partial { "partial" } else { "ok" },
        "sessions": sessions,
        "coverage": { "discoveredSessions": discovered, "omittedSessions": omitted,
            "directoryLimitReached": directory_limit, "unreadableDirectories": unreadable },
    }))
}

fn native_home(params: &PerformanceParams, provider: &str) -> PathBuf {
    let configured = if provider == native::claude::PROVIDER {
        params.claude_home.as_deref()
    } else {
        params.codex_home.as_deref()
    };
    match configured {
        Some(path) => expand_home(path),
        None if provider == native::claude::PROVIDER => native::claude::home(),
        None => native::codex::home(),
    }
}

fn native_transcripts(
    params: &PerformanceParams,
    workspace: &Path,
    provider: &str,
) -> Vec<native::Transcript> {
    let home = native_home(params, provider);
    if provider == native::claude::PROVIDER {
        native::claude::transcripts(&home, workspace)
    } else {
        native::codex::transcripts(&home, workspace)
    }
}

fn native_events(
    provider: &str,
    transcript: &native::Transcript,
    params: &PerformanceParams,
) -> (Vec<Event>, Coverage) {
    let home = native_home(params, provider);
    let mut coverage = Coverage::default();
    let mut events = if provider == native::claude::PROVIDER {
        native::claude::events(0, &transcript.path, &home, &mut coverage)
    } else {
        native::codex::events(0, &transcript.path, &home, &mut coverage)
    };
    events
        .sort_by(|a, b| (a.at, &a.evidence.source, a.seq).cmp(&(b.at, &b.evidence.source, b.seq)));
    coverage.events = events.len();
    (events, coverage)
}

fn native_detail_for(
    provider: &str,
    transcript: &native::Transcript,
    params: &PerformanceParams,
) -> Detail {
    let (events, coverage) = native_events(provider, transcript, params);
    let id = native::namespaced(provider, &transcript.id);
    analyze::analyze_provider(&id, provider, events, coverage)
}

fn native_summary_for(
    provider: &str,
    transcript: &native::Transcript,
    params: &PerformanceParams,
) -> Summary {
    let (events, coverage) = native_events(provider, transcript, params);
    let id = native::namespaced(provider, &transcript.id);
    analyze::summarize_provider(&id, provider, events, coverage)
}

/// One retained transcript, read only when the request names it.
fn native_detail(params: &PerformanceParams, workspace: &Path) -> Result<Value, String> {
    let session_id = params.session_id.as_deref().unwrap_or_default();
    let (provider, id) = native::split_namespace(session_id).ok_or("invalid-session-id")?;
    let transcript = native_transcripts(params, workspace, provider)
        .into_iter()
        .find(|transcript| transcript.id == id)
        .ok_or("session-timing-not-found")?;
    if let Some(source) = &params.source {
        let home = native_home(params, provider);
        return super::source::read_files(&home, &[transcript.path], source);
    }
    serde_json::to_value(native_detail_for(provider, &transcript, params))
        .map_err(|_| "performance-encode-failed".into())
}

fn qoder_mtime(paths: &[PathBuf]) -> Option<SystemTime> {
    paths
        .iter()
        .flat_map(|path| segment_paths(path).0)
        .filter_map(|path| fs::metadata(path).ok()?.modified().ok())
        .max()
}

fn list_qoder(
    params: &PerformanceParams,
    workspace: &Path,
) -> Result<
    (
        PathBuf,
        Vec<(String, Vec<PathBuf>, Option<SystemTime>)>,
        usize,
        bool,
    ),
    String,
> {
    let home = params
        .qoder_home
        .as_deref()
        .map(expand_home)
        .unwrap_or_else(qoder_home);
    let mut dirs: BTreeMap<String, Vec<PathBuf>> = BTreeMap::new();
    let (mut unreadable, mut directory_limit) = (0, false);
    for slug in qoder_slug_variants(workspace) {
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
            if dirs.len() >= MAX_DIRECTORIES && !dirs.contains_key(&id) {
                directory_limit = true;
                continue;
            }
            dirs.entry(id).or_default().push(entry.path());
        }
    }
    let sessions = dirs
        .into_iter()
        .map(|(id, paths)| {
            let modified = qoder_mtime(&paths);
            (id, paths, modified)
        })
        .collect();
    Ok((home, sessions, unreadable, directory_limit))
}

fn qoder(params: &PerformanceParams, workspace: &Path) -> Result<Value, String> {
    let (home, sessions, _, _) = list_qoder(params, workspace)?;
    let wanted = params
        .session_id
        .as_ref()
        .ok_or("session-timing-not-found")?;
    let paths = sessions
        .into_iter()
        .find(|(id, _, _)| id == wanted)
        .map(|(_, paths, _)| paths)
        .ok_or("session-timing-not-found")?;
    if let Some(source) = &params.source {
        return super::source::read_segments(&home, &paths, source);
    }
    let (events, coverage, _) = read_events(&home, &paths, MAX_SESSION_BYTES);
    let detail = analyze::analyze(wanted, events, coverage);
    serde_json::to_value(detail).map_err(|_| "performance-encode-failed".into())
}

/// A requested Session id may carry one provider namespace. Both halves stay
/// within the same character set a path component is allowed to use, so a
/// namespaced id can never widen what a reader may reach.
fn valid_request_id(id: &str) -> bool {
    match native::split_namespace(id) {
        Some((provider, rest)) => {
            provider.len() <= 32 && valid_id(provider) && valid_id(rest) && !id.contains("::")
        }
        None => valid_id(id),
    }
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

pub(super) fn safe_directory(path: &Path, home: &Path) -> bool {
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
                // Retain bounded metadata and a redacted invocation summary only.
                let mut data = serde_json::Map::new();
                if kind == "tool.requested" || kind == "tool.shell.started" {
                    if let Some(summary) = super::source::call_summary(&raw["data"]) {
                        data.insert("callSummary".into(), summary.into());
                    }
                }
                // Only actual user-input events may supply a Session title.
                // Never promote model prompts or tool-output previews.
                if matches!(kind, "input.prompt.submitted" | "input.prompt.received") {
                    if let Some(preview) = raw["data"]["text_preview"].as_str() {
                        let safe = crate::privacy::redact_private_text(
                            &crate::privacy::prepare_prompt_text(preview),
                        );
                        let title = safe.split_whitespace().collect::<Vec<_>>().join(" ");
                        data.insert(
                            "text_preview".into(),
                            title.chars().take(160).collect::<String>().into(),
                        );
                    }
                }
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
