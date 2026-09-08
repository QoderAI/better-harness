use std::fs;
use std::path::Path;

use crate::model::{ArtifactObservation, SessionSummary};
use crate::paths::repo_relative;

pub fn observe(workspace: &Path, sessions: &[SessionSummary]) -> Vec<ArtifactObservation> {
    let Ok(root) = fs::canonicalize(workspace) else {
        return Vec::new();
    };
    let mut observations = Vec::new();
    for session in sessions {
        let saved_at = session
            .last_seen
            .clone()
            .or_else(|| session.first_seen.clone())
            .unwrap_or_default();
        if saved_at.is_empty() {
            continue;
        }
        let prompt = session
            .prompts
            .first()
            .map(|prompt| prompt.text.clone())
            .unwrap_or_else(|| format!("{} Session {}", session.platform, &session.session_id[..session.session_id.len().min(12)]));
        let Some(activity) = &session.tool_activity else {
            continue;
        };
        for call in &activity.calls {
            if call.family != "deliver" && call.family != "explore" && call.family != "inspect" {
                continue;
            }
            let mut paths = call.file_paths.clone();
            if let Some(path) = &call.file_path {
                paths.push(path.clone());
            }
            paths.sort();
            paths.dedup();
            for relative in paths {
                if !confined_regular_file(&root, &relative) {
                    continue;
                }
                let id = format!("{}:{}", session.platform, session.session_id);
                if observations.iter().any(|item: &ArtifactObservation| {
                    item.session_id == id && item.relative_path == relative
                }) {
                    continue;
                }
                observations.push(ArtifactObservation {
                    relative_path: relative,
                    session_id: id.clone(),
                    saved_at: saved_at.clone(),
                    prompt: prompt.clone(),
                    provider: Some(session.platform.clone()),
                });
            }
        }
    }
    observations.sort_by(|left, right| {
        right
            .saved_at
            .cmp(&left.saved_at)
            .then(left.relative_path.cmp(&right.relative_path))
    });
    observations
}

fn confined_regular_file(root: &Path, relative: &str) -> bool {
    if relative.is_empty() || relative.contains('\0') || relative == ".git" || relative.starts_with(".git/")
    {
        return false;
    }
    let Some(normalized) = repo_relative(root, relative) else {
        return false;
    };
    if normalized != relative.replace('\\', "/") {
        return false;
    }
    let candidate = root.join(relative);
    let Ok(metadata) = fs::symlink_metadata(&candidate) else {
        return false;
    };
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return false;
    }
    let Ok(physical) = fs::canonicalize(&candidate) else {
        return false;
    };
    physical.starts_with(root)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{ToolActivity, ToolCall};
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn drops_missing_and_keeps_real_files() {
        let stamp = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let root = std::env::temp_dir().join(format!("evidence-obs-{stamp}"));
        fs::create_dir_all(root.join("docs")).unwrap();
        fs::write(root.join("docs/kept.md"), "ok").unwrap();
        let session = SessionSummary {
            session_id: "s1".into(),
            platform: "grok".into(),
            first_seen: Some("2026-09-08T00:00:00.000Z".into()),
            last_seen: Some("2026-09-08T00:00:00.000Z".into()),
            prompts: vec![],
            prompt_count: 0,
            assistant_message_count: 0,
            tool_call_count: 1,
            tool_activity: Some(ToolActivity {
                calls: vec![ToolCall {
                    id: "t1".into(),
                    family: "inspect".into(),
                    action_label: "Read".into(),
                    tool_name: "read_file".into(),
                    status: "observed".into(),
                    file_path: Some("docs/kept.md".into()),
                    file_paths: vec!["docs/kept.md".into(), "../escape".into()],
                    started_at: None,
                    ..ToolCall::default()
                }],
            }),
            dialogue: None,
            ..SessionSummary::default()
        };
        let observed = observe(&root, &[session]);
        fs::remove_dir_all(&root).ok();
        assert_eq!(observed.len(), 1);
        assert_eq!(observed[0].relative_path, "docs/kept.md");
    }
}
