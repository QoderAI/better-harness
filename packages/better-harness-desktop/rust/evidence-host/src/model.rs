use serde::{Deserialize, Serialize};

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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCall {
    pub id: String,
    pub family: String,
    #[serde(rename = "actionLabel")]
    pub action_label: String,
    #[serde(rename = "toolName")]
    pub tool_name: String,
    pub status: String,
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
    if ["read", "read_file", "grep", "glob", "search", "list", "ls"].iter().any(|item| lower.contains(item))
    {
        "inspect".into()
    } else if ["write", "edit", "apply", "patch", "create", "delete"].iter().any(|item| lower.contains(item))
    {
        "deliver".into()
    } else {
        "explore".into()
    }
}

pub const PORTED: &[&str] = &["qoder", "codex", "claude", "cursor", "copilot", "grok"];

pub const UNPORTED: &[&str] = &[
    "augment", "qwen", "pi", "kimi", "workbuddy", "dsh", "harness-run",
];
