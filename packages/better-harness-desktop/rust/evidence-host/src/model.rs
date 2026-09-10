use serde::{Deserialize, Serialize};

/// The observation window a reader is asking about, as absolute instants.
///
/// The window is chosen in local calendar days, but only the browser knows the
/// reader's clock, so it resolves the days and sends instants. Nothing here
/// guesses a timezone.
#[derive(Debug, Clone, Copy, Default)]
pub struct Window {
    pub from_ms: Option<i64>,
    pub to_ms: Option<i64>,
}

impl Window {
    pub fn is_open(&self) -> bool {
        self.from_ms.is_none() && self.to_ms.is_none()
    }
    /// Does a stated activity instant fall inside the window? An unrecorded
    /// instant is kept: a window must narrow a catalog, never silently drop a
    /// Session whose time could not be read.
    pub fn contains(&self, at_ms: Option<i64>) -> bool {
        let Some(at) = at_ms else { return true };
        self.from_ms.is_none_or(|from| at >= from) && self.to_ms.is_none_or(|to| at <= to)
    }
    /// Can a file last written at `modified_ms` still hold in-window activity?
    ///
    /// A Session is never newer than the file that records it, so a file
    /// written before the window opened cannot contain one. The upper bound is
    /// deliberately not applied: an unrelated later write must not hide a
    /// Session that really did end inside the window. One day of slack absorbs
    /// clock skew between the recorded instants and the filesystem.
    pub fn may_hold(&self, modified_ms: Option<i64>) -> bool {
        let (Some(from), Some(modified)) = (self.from_ms, modified_ms) else {
            return true;
        };
        modified >= from - 86_400_000
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderStatus {
    pub platform: String,
    pub status: String,
    pub discovered: u32,
    pub included: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SessionSummary {
    #[serde(rename = "sessionId")]
    pub session_id: String,
    pub platform: String,
    #[serde(rename = "firstSeen", skip_serializing_if = "Option::is_none")]
    pub first_seen: Option<String>,
    #[serde(rename = "lastSeen", skip_serializing_if = "Option::is_none")]
    pub last_seen: Option<String>,
    pub prompts: Vec<Prompt>,
    #[serde(rename = "promptCount")]
    pub prompt_count: u32,
    #[serde(rename = "assistantMessageCount")]
    pub assistant_message_count: u32,
    #[serde(rename = "toolCallCount")]
    pub tool_call_count: u32,
    #[serde(rename = "toolActivity", skip_serializing_if = "Option::is_none")]
    pub tool_activity: Option<ToolActivity>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dialogue: Option<Dialogue>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub models: Vec<String>,
    #[serde(rename = "tokenUsage", skip_serializing_if = "Option::is_none")]
    pub token_usage: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Prompt {
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timestamp: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ToolActivity {
    pub calls: Vec<ToolCall>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ToolCall {
    pub id: String,
    pub family: String,
    #[serde(rename = "actionLabel")]
    pub action_label: String,
    #[serde(rename = "toolName")]
    pub tool_name: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output: Option<String>,
    #[serde(rename = "durationMs", skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<i64>,
    #[serde(rename = "filePath", skip_serializing_if = "Option::is_none")]
    pub file_path: Option<String>,
    #[serde(rename = "filePaths", skip_serializing_if = "Vec::is_empty")]
    pub file_paths: Vec<String>,
    #[serde(rename = "startedAt", skip_serializing_if = "Option::is_none")]
    pub started_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Dialogue {
    pub turns: Vec<Turn>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Turn {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timestamp: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub response: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArtifactObservation {
    #[serde(rename = "relativePath")]
    pub relative_path: String,
    #[serde(rename = "sessionId")]
    pub session_id: String,
    #[serde(rename = "savedAt")]
    pub saved_at: String,
    pub prompt: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
}

pub fn truncate_prompt(text: &str) -> String {
    let trimmed = text.trim();
    if trimmed.chars().count() <= 200 {
        return trimmed.to_string();
    }
    trimmed.chars().take(200).collect()
}

pub fn tool_family(name: &str) -> String {
    let lower = name.to_ascii_lowercase();
    if ["read", "read_file", "grep", "glob", "search", "list", "ls"]
        .iter()
        .any(|item| lower.contains(item))
    {
        "inspect".into()
    } else if ["write", "edit", "apply", "patch", "create", "delete"]
        .iter()
        .any(|item| lower.contains(item))
    {
        "deliver".into()
    } else {
        "explore".into()
    }
}

pub const PORTED: &[&str] = &[
    "qoder",
    "codex",
    "claude",
    "cursor",
    "copilot",
    "grok",
    "augment",
    "qwen",
    "pi",
    "kimi",
    "workbuddy",
    "dsh",
    "harness-run",
];

pub const UNPORTED: &[&str] = &[];

/// Discovery is a bounded snapshot. Divide the text budget fairly across every
/// retained request/result rather than dropping the oldest calls or turns.
pub fn bound_session_text(session: &mut SessionSummary, budget: usize) {
    crate::privacy::redact_session(session);
    let mut lengths: Vec<usize> = session
        .prompts
        .iter()
        .map(|prompt| prompt.text.len())
        .collect();
    if let Some(activity) = &session.tool_activity {
        for call in &activity.calls {
            for text in [&call.detail, &call.output].into_iter().flatten() {
                lengths.push(text.len());
            }
        }
    }
    if let Some(dialogue) = &session.dialogue {
        for turn in &dialogue.turns {
            if let Some(text) = &turn.response {
                lengths.push(text.len());
            }
        }
    }
    if lengths.iter().sum::<usize>() <= budget {
        return;
    }
    let (mut low, mut high) = (0, lengths.iter().copied().max().unwrap_or(0));
    while low < high {
        let mid = (low + high + 1) / 2;
        if lengths
            .iter()
            .map(|length| (*length).min(mid))
            .sum::<usize>()
            <= budget
        {
            low = mid;
        } else {
            high = mid - 1;
        }
    }
    fn bound(text: &mut String, limit: usize) {
        if text.len() <= limit {
            return;
        }
        let suffix = "… [truncated]";
        if limit < suffix.len() {
            text.clear();
            text.push_str(&"..."[..limit.min(3)]);
            return;
        }
        let mut end = limit - suffix.len();
        while !text.is_char_boundary(end) {
            end -= 1;
        }
        text.truncate(end);
        text.push_str(suffix);
    }
    for prompt in &mut session.prompts {
        bound(&mut prompt.text, low);
    }
    if let Some(activity) = &mut session.tool_activity {
        for call in &mut activity.calls {
            for text in [&mut call.detail, &mut call.output].into_iter().flatten() {
                bound(text, low);
            }
        }
    }
    if let Some(dialogue) = &mut session.dialogue {
        for turn in &mut dialogue.turns {
            if let Some(text) = &mut turn.response {
                bound(text, low);
            }
        }
    }
}

#[cfg(test)]
mod evidence_tests {
    use super::*;
    #[test]
    fn snapshot_budget_keeps_call_identity_and_marks_unicode_excerpts() {
        let mut session = SessionSummary {
            tool_call_count: 20,
            tool_activity: Some(ToolActivity {
                calls: (0..20)
                    .map(|index| ToolCall {
                        id: index.to_string(),
                        detail: Some("详细输入".repeat(100)),
                        output: Some("结果".repeat(100)),
                        ..ToolCall::default()
                    })
                    .collect(),
            }),
            ..SessionSummary::default()
        };
        bound_session_text(&mut session, 2000);
        let calls = &session.tool_activity.unwrap().calls;
        assert_eq!(calls.len(), 20);
        assert_eq!(session.tool_call_count, 20);
        assert_eq!(calls[19].id, "19");
        assert!(calls[0].detail.as_ref().unwrap().ends_with("… [truncated]"));
        assert!(
            calls
                .iter()
                .map(|c| c.detail.as_ref().unwrap().len() + c.output.as_ref().unwrap().len())
                .sum::<usize>()
                <= 2000
        );
    }
}

pub fn evidence_excerpt(text: &str) -> String {
    let mut characters = text.trim().chars();
    let mut result: String = characters.by_ref().take(8000).collect();
    if characters.next().is_some() {
        result.push_str("… [truncated]");
    }
    result
}
