use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PerformanceParams {
    pub workspace: String,
    pub qoder_home: Option<String>,
    /// Server-owned roots for the non-Qoder transcript formats. Absent means the
    /// platform default; a browser request can never supply one.
    pub claude_home: Option<String>,
    pub codex_home: Option<String>,
    pub session_id: Option<String>,
    pub max_sessions: Option<usize>,
    pub source: Option<SourceRequest>,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Coverage {
    pub files: usize,
    pub events: usize,
    pub invalid_lines: usize,
    pub invalid_timestamps: usize,
    pub unreadable_files: usize,
    pub truncated: bool,
    pub unpaired_events: usize,
    pub ambiguous_pairs: usize,
    pub clock_conflicts: usize,
}
impl Coverage {
    pub fn partial(&self) -> bool {
        self.truncated
            || self.invalid_lines
                + self.invalid_timestamps
                + self.unreadable_files
                + self.unpaired_events
                + self.ambiguous_pairs
                + self.clock_conflicts
                > 0
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Evidence {
    /// Relative portable path in this session's execution-log directory.
    pub source: String,
    pub line: usize,
    pub event_type: String,
    pub timestamp_ms: i64,
}

#[derive(Debug, Clone)]
pub struct Event {
    pub kind: String,
    pub at: i64,
    pub seq: u64,
    pub turn: String,
    pub loop_id: String,
    pub request: String,
    pub tool: String,
    pub data: Value,
    pub evidence: Evidence,
}
impl Event {
    pub fn text(&self, key: &str) -> &str {
        self.data[key].as_str().unwrap_or("")
    }
    pub fn duration(&self) -> Option<i64> {
        self.data["duration_ms"]
            .as_i64()
            .filter(|v| *v >= 0 && *v <= 30 * 86400 * 1000)
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Span {
    pub id: String,
    pub kind: String,
    pub label: String,
    pub start_ms: Option<i64>,
    pub end_ms: Option<i64>,
    pub duration_ms: Option<i64>,
    pub basis: String,
    pub status: String,
    pub turn_id: Option<String>,
    pub parent_id: Option<String>,
    pub relationship: Option<String>,
    pub evidence: Vec<Evidence>,
    pub facts: Value,
    #[serde(skip)]
    pub invocation: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Turn {
    pub id: String,
    pub label: String,
    pub start_ms: i64,
    pub end_ms: Option<i64>,
    pub duration_ms: Option<i64>,
    pub is_subagent: bool,
    pub parent_span_id: Option<String>,
    pub evidence: Vec<Evidence>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Metric {
    pub kind: String,
    pub count: usize,
    pub timed_count: usize,
    /// Per-category interval union, not additive with other categories.
    pub duration_ms: Option<i64>,
    pub p95_ms: Option<i64>,
    pub max_ms: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Subagents {
    pub count: usize,
    pub timed_count: usize,
    pub cumulative_ms: Option<i64>,
    pub elapsed_ms: Option<i64>,
    pub max_ms: Option<i64>,
    pub peak_concurrency: usize,
    pub unlinked_count: usize,
    pub unlinked_turn_count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Finding {
    pub code: String,
    pub span_id: Option<String>,
    pub duration_ms: Option<i64>,
    pub count: usize,
    pub label: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    pub breakdown: super::breakdown::Breakdown,
    pub id: String,
    pub provider: String,
    pub label: String,
    pub first_seen_ms: Option<i64>,
    pub last_seen_ms: Option<i64>,
    pub last_activity_ms: Option<i64>,
    pub wall_ms: Option<i64>,
    pub completed_turn_ms: Option<i64>,
    pub timed_union_ms: Option<i64>,
    pub unattributed_turn_ms: Option<i64>,
    pub longest_ms: Option<i64>,
    pub turn_count: usize,
    pub tool_count: usize,
    pub retry_count: usize,
    pub metrics: Vec<Metric>,
    pub subagents: Subagents,
    pub findings: Vec<Finding>,
    pub coverage: Coverage,
    pub status: &'static str,
    /// "unrecorded" unless the transcript states a time-to-first-token itself.
    pub first_token_status: &'static str,
    pub first_token_ms: Option<i64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Detail {
    pub schema_version: u8,
    pub engine: &'static str,
    pub session: Summary,
    pub turns: Vec<Turn>,
    pub total_spans: usize,
    pub omitted_spans: usize,
    pub spans: Vec<Span>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SourceRequest {
    pub source: String,
    pub line: usize,
}
