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

pub fn qoder_slug_variants(workspace: &Path) -> Vec<String> {
    let text = workspace.to_string_lossy().replace('\\', "/");
    let slashy = text.replace(':', "-").replace('/', "-");
    let no_colon = text.replace(':', "").replace('/', "-");
    let mut values = vec![slashy, no_colon];
    values.sort();
    values.dedup();
    values
}

/// Claude Code folds `/`, `.`, and `_` into `-` when naming `~/.claude/projects/<slug>`.
pub fn claude_slug_variants(workspace: &Path) -> Vec<String> {
    let text = workspace.to_string_lossy().replace('\\', "/");
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

pub fn walk_jsonl(root: &Path, max_depth: usize, limit: usize) -> Vec<PathBuf> {
    let mut out = Vec::new();
    walk_jsonl_rec(root, 0, max_depth, limit, &mut out);
    out
}

fn walk_jsonl_rec(dir: &Path, depth: usize, max_depth: usize, limit: usize, out: &mut Vec<PathBuf>) {
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
            walk_jsonl_rec(&path, depth + 1, max_depth, limit, out);
        } else if file_type.is_file() && path.extension().and_then(|ext| ext.to_str()) == Some("jsonl") {
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
    if !Path::new(candidate).is_absolute() && !candidate.contains('/') && !candidate.contains('\\') {
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
        assert!(variants.iter().any(|value| value == "-Users-phodal-workspace-better-harness"));
    }

    #[test]
    fn claude_slug_folds_dot_and_slash() {
        let variants = claude_slug_variants(Path::new("/Users/phodal/workspace/better-harness"));
        assert!(variants.iter().any(|value| value == "-Users-phodal-workspace-better-harness"));
    }
}
