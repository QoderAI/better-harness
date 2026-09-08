use std::fs;
use std::path::Path;

use serde_json::Value;

use crate::model::{
    tool_family, truncate_prompt, Dialogue, Prompt, SessionSummary, ToolActivity, ToolCall,
};
use crate::paths::paths_from_value;
use crate::time::normalize_timestamp;

pub struct Snapshot {
    pub session_id: String,
    pub platform: &'static str,
    pub first_seen: Option<String>,
    pub last_seen: Option<String>,
    pub prompts: Vec<Prompt>,
    pub assistant_count: u32,
    pub calls: Vec<ToolCall>,
    pub last_response: Option<String>,
    pub matched: bool,
    pub models: Vec<String>,
    pub usage: serde_json::Map<String, Value>,
    call_index: std::collections::HashMap<String, usize>,
}

impl Snapshot {
    pub fn new(session_id: impl Into<String>, platform: &'static str) -> Self {
        Self {
            session_id: session_id.into(),
            platform,
            first_seen: None,
            last_seen: None,
            prompts: Vec::new(),
            assistant_count: 0,
            calls: Vec::new(),
            last_response: None,
            matched: false,
            models: Vec::new(),
            usage: serde_json::Map::new(),
            call_index: std::collections::HashMap::new(),
        }
    }

    pub fn stamp(&mut self, value: Option<String>) {
        if self.first_seen.is_none() {
            self.first_seen = value.clone();
        }
        if value.is_some() {
            self.last_seen = value;
        }
    }

    pub fn prompt(&mut self, text: &str, timestamp: Option<String>) {
        let prompt = truncate_prompt(text);
        if prompt.is_empty() {
            return;
        }
        if self.prompts.len() < 8 && !self.prompts.iter().any(|item| item.text == prompt) {
            self.prompts.push(Prompt {
                text: prompt,
                timestamp,
            });
        }
    }

    pub fn assistant(&mut self, text: &str) {
        let response = truncate_prompt(text);
        if response.is_empty() {
            return;
        }
        self.assistant_count += 1;
        self.last_response = Some(response);
    }

    pub fn tool(
        &mut self,
        workspace: &Path,
        id: &str,
        name: &str,
        input: &Value,
        started_at: Option<String>,
    ) {
        let paths = paths_from_value(workspace, input);
        let call_id = if id.is_empty() {
            format!(
                "{}-{}-{}",
                self.platform,
                self.session_id,
                self.calls.len() + 1
            )
        } else {
            id.to_string()
        };
        if !id.is_empty() {
            self.call_index.insert(id.to_string(), self.calls.len());
        }
        self.calls.push(ToolCall {
            id: call_id,
            family: tool_family(name),
            action_label: name.to_string(),
            tool_name: name.to_string(),
            status: "observed".into(),
            detail: input
                .as_object()
                .map(|_| truncate_prompt(&input.to_string()))
                .filter(|text| !text.is_empty()),
            file_path: paths.first().cloned(),
            file_paths: paths,
            started_at,
            ..ToolCall::default()
        });
    }

    pub fn tool_result(&mut self, id: &str, output: &str, failed: bool) {
        let Some(index) = self.call_index.get(id).copied() else {
            return;
        };
        let call = &mut self.calls[index];
        if !output.trim().is_empty() {
            call.output = Some(truncate_prompt(output));
        }
        call.status = if failed { "failed" } else { "completed" }.into();
    }

    pub fn observe_model(&mut self, model: &str) {
        let model = model.trim();
        if model.is_empty() || self.models.iter().any(|item| item == model) {
            return;
        }
        self.models.push(model.to_string());
    }

    pub fn observe_usage(&mut self, raw: &Value) {
        let Some(map) = raw.as_object() else {
            return;
        };
        for (source, target) in [
            ("inputTokens", "inputTokens"),
            ("input_tokens", "inputTokens"),
            ("input", "inputTokens"),
            ("promptTokenCount", "inputTokens"),
            ("inputOther", "inputTokens"),
            ("outputTokens", "outputTokens"),
            ("output_tokens", "outputTokens"),
            ("output", "outputTokens"),
            ("candidatesTokenCount", "outputTokens"),
            ("cacheReadInputTokens", "cacheReadInputTokens"),
            ("cache_read_input_tokens", "cacheReadInputTokens"),
            ("cacheRead", "cacheReadInputTokens"),
            ("cacheReadTokens", "cacheReadInputTokens"),
            ("inputCacheRead", "cacheReadInputTokens"),
            ("cachedContentTokenCount", "cacheReadInputTokens"),
            ("cacheCreationInputTokens", "cacheCreationInputTokens"),
            ("cache_creation_input_tokens", "cacheCreationInputTokens"),
            ("cacheWrite", "cacheCreationInputTokens"),
            ("cacheWriteTokens", "cacheCreationInputTokens"),
            ("inputCacheCreation", "cacheCreationInputTokens"),
        ] {
            if let Some(value) = finite_non_negative(map.get(source)) {
                self.usage.insert(target.into(), value.into());
            }
        }
    }

    pub fn finish(self) -> Option<SessionSummary> {
        if !self.matched && self.prompts.is_empty() {
            return None;
        }
        let mut session = SessionSummary {
            session_id: self.session_id,
            platform: self.platform.into(),
            last_seen: self.last_seen.or(self.first_seen.clone()),
            first_seen: self.first_seen,
            prompt_count: self.prompts.len() as u32,
            assistant_message_count: self.assistant_count,
            tool_call_count: self.calls.len() as u32,
            prompts: self.prompts,
            tool_activity: Some(ToolActivity { calls: self.calls }),
            dialogue: self.last_response.map(|response| Dialogue {
                turns: vec![crate::model::Turn {
                    timestamp: None,
                    response: Some(response),
                }],
            }),
            models: self.models,
            token_usage: (!self.usage.is_empty()).then_some(Value::Object(self.usage)),
        };
        crate::privacy::redact_session(&mut session);
        Some(session)
    }
}

fn finite_non_negative(value: Option<&Value>) -> Option<u64> {
    let value = value?;
    let number = value.as_u64().or_else(|| {
        value
            .as_f64()
            .filter(|raw| raw.is_finite() && *raw >= 0.0)
            .map(|raw| raw as u64)
    })?;
    Some(number)
}

pub fn read_jsonl(path: &Path) -> Vec<Value> {
    parse_jsonl(&fs::read_to_string(path).unwrap_or_default())
}

pub fn read_zstd_jsonl(path: &Path) -> Vec<Value> {
    let Ok(bytes) = fs::read(path) else {
        return Vec::new();
    };
    let Ok(decoded) = zstd::decode_all(bytes.as_slice()) else {
        return Vec::new();
    };
    let Ok(text) = String::from_utf8(decoded) else {
        return Vec::new();
    };
    parse_jsonl(&text)
}

fn parse_jsonl(text: &str) -> Vec<Value> {
    text.lines()
        .filter_map(|line| serde_json::from_str(line).ok())
        .collect()
}

pub fn stamp_of(record: &Value, keys: &[&str]) -> Option<String> {
    for key in keys {
        if let Some(value) = record.get(*key) {
            if let Some(stamp) = normalize_timestamp(value) {
                return Some(stamp);
            }
        }
    }
    None
}

pub fn text_of(value: Option<&Value>) -> String {
    let Some(value) = value else {
        return String::new();
    };
    match value {
        Value::String(text) => text.clone(),
        Value::Array(parts) => parts
            .iter()
            .filter_map(part_text)
            .collect::<Vec<_>>()
            .join("\n"),
        Value::Object(_) => part_text(value).unwrap_or_default(),
        _ => String::new(),
    }
}

fn part_text(part: &Value) -> Option<String> {
    if let Some(text) = part.as_str() {
        return Some(text.to_string());
    }
    let kind = part.get("type").and_then(Value::as_str);
    if kind == Some("thought") {
        return None;
    }
    if matches!(kind, Some("text" | "input_text" | "output_text") | None) {
        part.get("text").and_then(Value::as_str).map(str::to_string)
    } else {
        None
    }
}
