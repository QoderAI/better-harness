use std::path::{Component, Path, PathBuf};

pub fn home_dir() -> PathBuf {
    if let Ok(home) = std::env::var("HOME") {
        if !home.is_empty() {
            return PathBuf::from(home);
        }
    }
    if let Ok(profile) = std::env::var("USERPROFILE") {
        if !profile.is_empty() {
            return PathBuf::from(profile);
        }
    }
    PathBuf::from("/")
}

pub fn expand_home(value: &str) -> PathBuf {
    if value == "~" {
        return home_dir();
    }
    if let Some(rest) = value.strip_prefix("~/") {
        return home_dir().join(rest);
    }
    PathBuf::from(value)
}

pub fn normalize_workspace(workspace: &str) -> PathBuf {
    let expanded = expand_home(workspace);
    std::fs::canonicalize(&expanded).unwrap_or_else(|_| {
        if expanded.is_absolute() {
            expanded
        } else {
            std::env::current_dir()
                .unwrap_or_else(|_| PathBuf::from("."))
                .join(expanded)
        }
    })
}

pub fn grok_group_name(workspace: &Path) -> String {
    urlencoding::encode_path(&workspace.to_string_lossy())
}

/// Minimal path-segment encoder matching `encodeURIComponent` for absolute POSIX paths.
mod urlencoding {
    pub fn encode_path(value: &str) -> String {
        let mut out = String::new();
        for byte in value.bytes() {
            match byte {
                b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                    out.push(byte as char);
                }
                _ => out.push_str(&format!("%{byte:02X}")),
            }
        }
        out
    }
}

pub fn env_home(var: &str, default_name: &str) -> PathBuf {
    std::env::var(var)
        .ok()
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| home_dir().join(default_name))
}

// Canonical Windows paths include an IO-only verbatim prefix. Native hosts
// encode the conventional drive/UNC spelling in their storage directory names.
fn workspace_slug_input(workspace: &Path) -> String {
    let raw = workspace.to_string_lossy();
    let native = if let Some(unc) = raw.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{unc}")
    } else {
        raw.strip_prefix(r"\\?\").unwrap_or(&raw).to_owned()
    };
    native.replace('\\', "/")
}

pub fn qoder_slug_variants(workspace: &Path) -> Vec<String> {
    let text = workspace_slug_input(workspace);
    let slashy = text.replace(':', "-").replace('/', "-");
    let no_colon = text.replace(':', "").replace('/', "-");
    let mut values = vec![slashy, no_colon];
    values.sort();
    values.dedup();
    values
}

/// Claude Code folds `/`, `.`, and `_` into `-` when naming `~/.claude/projects/<slug>`.
pub fn claude_slug_variants(workspace: &Path) -> Vec<String> {
    let text = workspace_slug_input(workspace);
    let bases = [text.replace(':', "-"), text.replace(':', "")];
    let classes: [&[char]; 3] = [&['/', '.', '_'], &['/', '.'], &['/']];
    let mut values = Vec::new();
    for base in bases {
        for class in classes {
            values.push(
                base.chars()
                    .map(|ch| if class.contains(&ch) { '-' } else { ch })
                    .collect(),
            );
        }
    }
    values.sort();
    values.dedup();
    values
}

pub fn cwd_matches(workspace: &Path, candidate: &str) -> bool {
    if candidate.trim().is_empty() {
        return false;
    }
    let resolved = normalize_workspace(candidate);
    &resolved == workspace || resolved.starts_with(workspace)
}

/// Qwen `sanitizeCwd`: every non-alphanumeric char becomes `-`. Windows also
/// lowercases; emit both so a POSIX host can still find a Windows-written tree.
pub fn qwen_slug_variants(workspace: &Path) -> Vec<String> {
    let text = workspace_slug_input(workspace);
    let slug: String = text
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '-' })
        .collect();
    let mut values = vec![slug.clone(), slug.to_ascii_lowercase()];
    values.sort();
    values.dedup();
    values
}

/// Pi default tree: `--<cwd with /\: folded to ->>--`. OMP also writes a
/// home-relative `-<rel>--` form when the workspace sits under `$HOME`.
pub fn pi_session_dir_variants(workspace: &Path) -> Vec<String> {
    let text = workspace_slug_input(workspace);
    let body = text
        .trim_start_matches(['/', '\\'])
        .replace(['/', '\\', ':'], "-");
    let mut values = vec![format!("--{body}--")];
    if let Ok(relative) = workspace.strip_prefix(home_dir()) {
        let home_body = relative.to_string_lossy().replace(['/', '\\', ':'], "-");
        if !home_body.is_empty() && !home_body.starts_with("..") {
            values.push(format!("-{home_body}"));
        }
    }
    values.sort();
    values.dedup();
    values
}

/// WorkBuddy project dirs: strip one leading separator, fold `/\:` to `-`.
pub fn workbuddy_slug_variants(workspace: &Path) -> Vec<String> {
    let text = workspace_slug_input(workspace);
    let body = text.trim_start_matches('/').replace(['/', '\\', ':'], "-");
    vec![body]
}

pub fn encode_dsh_session_id(raw: &str) -> String {
    if raw == "." {
        return "~002E".into();
    }
    if raw == ".." {
        return "~002E~002E".into();
    }
    let mut encoded = String::new();
    for ch in raw.chars() {
        if ch != '~' && (ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-')) {
            encoded.push(ch);
        } else {
            encoded.push_str(&format!("~{:04X}", u32::from(ch)));
        }
    }
    encoded
}

pub fn dsh_project_key(cwd: &str) -> String {
    let mut readable = String::new();
    let mut separator_run = false;
    for ch in cwd.chars() {
        if matches!(ch, '/' | '\\' | ':') {
            if !separator_run {
                readable.push('-');
            }
            separator_run = true;
        } else if ch != '~' && (ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-')) {
            readable.push(ch);
            separator_run = false;
        } else {
            readable.push_str(&format!("~{:04X}", u32::from(ch)));
            separator_run = false;
        }
    }
    let body = readable.trim_start_matches('-');
    let clipped: String = if body.is_empty() {
        "root".into()
    } else {
        body.chars().take(251).collect()
    };
    format!("--{clipped}--")
}

pub fn walk_jsonl(root: &Path, max_depth: usize, limit: usize) -> Vec<PathBuf> {
    walk_matching(root, max_depth, limit, &|path| {
        path.extension().and_then(|ext| ext.to_str()) == Some("jsonl")
    })
}

pub fn walk_json(root: &Path, max_depth: usize, limit: usize) -> Vec<PathBuf> {
    walk_matching(root, max_depth, limit, &|path| {
        path.extension().and_then(|ext| ext.to_str()) == Some("json")
            && !path
                .file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.ends_with(".tmp"))
    })
}

pub fn walk_named(root: &Path, max_depth: usize, limit: usize, file_name: &str) -> Vec<PathBuf> {
    walk_matching(root, max_depth, limit, &|path| {
        path.file_name().and_then(|name| name.to_str()) == Some(file_name)
    })
}

fn walk_matching(
    root: &Path,
    max_depth: usize,
    limit: usize,
    matches: &dyn Fn(&Path) -> bool,
) -> Vec<PathBuf> {
    let mut out = Vec::new();
    walk_matching_rec(root, 0, max_depth, limit, matches, &mut out);
    out
}

fn walk_matching_rec(
    dir: &Path,
    depth: usize,
    max_depth: usize,
    limit: usize,
    matches: &dyn Fn(&Path) -> bool,
    out: &mut Vec<PathBuf>,
) {
    if out.len() >= limit || depth > max_depth {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        if out.len() >= limit {
            return;
        }
        let path = entry.path();
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if file_type.is_dir() {
            walk_matching_rec(&path, depth + 1, max_depth, limit, matches, out);
        } else if file_type.is_file() && matches(&path) {
            out.push(path);
        }
    }
}

pub fn paths_from_text(workspace: &Path, text: &str) -> Vec<String> {
    let root = workspace.to_string_lossy();
    if root.is_empty() {
        return Vec::new();
    }
    let mut paths = Vec::new();
    let mut from = 0;
    while let Some(rel) = text[from..].find(root.as_ref()) {
        let start = from + rel;
        let after = &text[start + root.len()..];
        let extra: String = after
            .chars()
            .take_while(|ch| {
                !ch.is_whitespace()
                    && !matches!(*ch, '"' | '\'' | '`' | ',' | ')' | ';' | '|' | '<' | '>')
            })
            .collect();
        let candidate = format!("{}{}", root, extra.trim_end_matches(['\\', '/']));
        if let Some(relative) = repo_relative(workspace, &candidate) {
            if !paths.contains(&relative) {
                paths.push(relative);
            }
        }
        from = start + 1;
        if paths.len() >= 40 {
            break;
        }
    }
    paths
}

pub fn tool_paths(workspace: &Path, value: &serde_json::Value) -> Vec<String> {
    let mut paths = Vec::new();
    if let Some(text) = value.as_str() {
        if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(text) {
            return tool_paths(workspace, &parsed);
        }
        return paths_from_text(workspace, text);
    }
    if let Some(map) = value.as_object() {
        for (key, value) in map {
            let found = if [
                "path",
                "file",
                "file_path",
                "filePath",
                "file_paths",
                "filePaths",
                "files",
            ]
            .contains(&key.as_str())
            {
                declared_tool_paths(workspace, value)
            } else {
                tool_paths(workspace, value)
            };
            for path in found {
                if !paths.contains(&path) {
                    paths.push(path);
                }
            }
        }
    } else if let Some(items) = value.as_array() {
        for item in items {
            for path in tool_paths(workspace, item) {
                if !paths.contains(&path) {
                    paths.push(path);
                }
            }
        }
    }
    paths
}

fn declared_tool_paths(workspace: &Path, value: &serde_json::Value) -> Vec<String> {
    if let Some(text) = value.as_str() {
        if text.trim().is_empty() {
            return Vec::new();
        }
        let candidate = if Path::new(text).is_absolute() {
            PathBuf::from(text)
        } else {
            workspace.join(text)
        };
        return repo_relative(workspace, &candidate.to_string_lossy())
            .into_iter()
            .collect();
    }
    value
        .as_array()
        .map(|items| {
            items
                .iter()
                .flat_map(|item| declared_tool_paths(workspace, item))
                .collect()
        })
        .unwrap_or_default()
}

pub fn paths_from_value(workspace: &Path, value: &serde_json::Value) -> Vec<String> {
    let mut paths = Vec::new();
    collect_paths(workspace, value, &mut paths);
    paths
}

fn collect_paths(workspace: &Path, value: &serde_json::Value, paths: &mut Vec<String>) {
    if paths.len() >= 40 {
        return;
    }
    match value {
        serde_json::Value::String(text) => {
            if let Some(relative) = repo_relative(workspace, text) {
                if !paths.contains(&relative) {
                    paths.push(relative);
                }
            } else {
                for relative in paths_from_text(workspace, text) {
                    if !paths.contains(&relative) {
                        paths.push(relative);
                    }
                    if paths.len() >= 40 {
                        break;
                    }
                }
            }
        }
        serde_json::Value::Array(items) => {
            for item in items {
                collect_paths(workspace, item, paths);
            }
        }
        serde_json::Value::Object(map) => {
            for item in map.values() {
                collect_paths(workspace, item, paths);
            }
        }
        _ => {}
    }
}

pub fn repo_relative(root: &Path, candidate: &str) -> Option<String> {
    if candidate.trim().is_empty() || candidate.contains('\0') {
        return None;
    }
    // Bare tokens like "function_call" are not files.
    if !Path::new(candidate).is_absolute() && !candidate.contains('/') && !candidate.contains('\\')
    {
        return None;
    }
    let path = if Path::new(candidate).is_absolute() {
        PathBuf::from(candidate)
    } else {
        root.join(candidate)
    };
    let relative = path.strip_prefix(root).ok()?;
    if relative.as_os_str().is_empty() {
        return None;
    }
    if relative
        .components()
        .any(|component| matches!(component, Component::ParentDir))
    {
        return None;
    }
    Some(relative.to_string_lossy().replace('\\', "/"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn native_storage_slugs_ignore_windows_verbatim_prefixes() {
        for (native, canonical) in [
            (r"C:\work\sample", r"\\?\C:\work\sample"),
            (r"\\server\share\sample", r"\\?\UNC\server\share\sample"),
        ] {
            let native = Path::new(native);
            let canonical = Path::new(canonical);
            assert_eq!(qoder_slug_variants(canonical), qoder_slug_variants(native));
            assert_eq!(claude_slug_variants(canonical), claude_slug_variants(native));
            assert_eq!(qwen_slug_variants(canonical), qwen_slug_variants(native));
            assert_eq!(pi_session_dir_variants(canonical), pi_session_dir_variants(native));
            assert_eq!(workbuddy_slug_variants(canonical), workbuddy_slug_variants(native));
        }
    }

    #[test]
    fn explicit_file_arguments_keep_root_files_without_treating_programs_as_paths() {
        let root = std::env::temp_dir().join("tool-path-fixture");
        let parsed = tool_paths(
            &root,
            &serde_json::json!({
                "arguments": "{\"file_paths\":[\"README.md\",\"src/my file.rs\",\"../escape\"],\"command\":\"echo src/generated.rs\"}"
            }),
        );
        assert_eq!(parsed, vec!["README.md", "src/my file.rs"]);
    }

    #[test]
    fn grok_group_matches_encode_uri_component() {
        let path = Path::new("/Users/phodal/workspace/better-harness");
        assert_eq!(
            grok_group_name(path),
            "%2FUsers%2Fphodal%2Fworkspace%2Fbetter-harness"
        );
    }

    #[test]
    fn qoder_slug_uses_leading_dash_for_posix_root() {
        let variants = qoder_slug_variants(Path::new("/Users/phodal/workspace/better-harness"));
        assert!(variants
            .iter()
            .any(|value| value == "-Users-phodal-workspace-better-harness"));
    }

    #[test]
    fn claude_slug_folds_dot_and_slash() {
        let variants = claude_slug_variants(Path::new("/Users/phodal/workspace/better-harness"));
        assert!(variants
            .iter()
            .any(|value| value == "-Users-phodal-workspace-better-harness"));
    }

    #[test]
    fn qwen_slug_replaces_non_alnum() {
        let variants = qwen_slug_variants(Path::new("/Users/phodal/workspace/better-harness"));
        assert!(variants
            .iter()
            .any(|value| value == "-Users-phodal-workspace-better-harness"));
    }

    #[test]
    fn pi_session_dir_wraps_cwd_slug() {
        let variants = pi_session_dir_variants(Path::new("/Users/phodal/workspace/better-harness"));
        assert!(variants
            .iter()
            .any(|value| value == "--Users-phodal-workspace-better-harness--"));
    }

    #[test]
    fn workbuddy_slug_strips_leading_separator() {
        assert_eq!(
            workbuddy_slug_variants(Path::new("/Users/phodal/workspace/better-harness")),
            vec!["Users-phodal-workspace-better-harness".to_string()]
        );
    }

    #[test]
    fn dsh_project_key_and_session_id_match_js_fold() {
        assert_eq!(
            dsh_project_key("/Users/phodal/workspace/better-harness"),
            "--Users-phodal-workspace-better-harness--"
        );
        assert_eq!(encode_dsh_session_id("ses_ab-cd"), "ses_ab-cd");
        assert_eq!(encode_dsh_session_id("a/b"), "a~002Fb");
    }
}

/// Filesystem modification time as epoch milliseconds, when it can be read.
pub fn modified_ms(path: &Path) -> Option<i64> {
    let modified = std::fs::metadata(path).ok()?.modified().ok()?;
    let since = modified.duration_since(std::time::UNIX_EPOCH).ok()?;
    i64::try_from(since.as_millis()).ok()
}
