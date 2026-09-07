//! Per-session transcript state.
//!
//! ACP delivers a turn as a stream of chunks. Rendering each chunk as its own
//! transcript row would produce hundreds of rows for one paragraph, so chunks
//! are merged into the entry they belong to and the host reports which single
//! index changed.
//!
//! The merge rules are ported from Zed's `acp_thread` rather than re-derived,
//! because the edge cases are not obvious: agents disagree on whether they send
//! message ids at all, and the same agent may start sending them mid-stream.
//! See [`can_merge_message_chunks`] for the one predicate everything rests on.
//!
//! Not included here, deliberately:
//!
//! - The reveal cadence. Smoothing belongs in the browser; doing it here would
//!   split a 200ms paragraph into a dozen NDJSON frames and then amplify them
//!   again over SSE.
//! - Markdown parsing. Entries carry text; rendering is the UI's concern.

use serde::Serialize;

/// One transcript row.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum Entry {
    /// A prompt the host submitted. Held so a reload can replay the turn.
    UserMessage { text: String },
    /// Agent output. `chunks` keeps message and thought text separate while
    /// letting them interleave in arrival order, matching how ACP sends them.
    AssistantMessage { chunks: Vec<Chunk> },
    /// One tool invocation.
    ToolCall {
        tool_call_id: String,
        title: String,
        status: ToolCallStatus,
        #[serde(skip_serializing_if = "Option::is_none")]
        raw_input: Option<serde_json::Value>,
        #[serde(skip_serializing_if = "Option::is_none")]
        raw_output: Option<serde_json::Value>,
    },
}

/// A run of agent text of one kind.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Chunk {
    pub kind: ChunkKind,
    /// The agent's message id, when it sends one. Absent for agents that do not,
    /// and backfilled the first time an id arrives for text already merged here.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message_id: Option<String>,
    pub text: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ChunkKind {
    /// Text meant for the user.
    Message,
    /// Reasoning the agent exposed. Rendered differently, so it never merges
    /// with `Message` text even when both carry the same message id.
    Thought,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ToolCallStatus {
    Pending,
    /// Blocked on a `session/request_permission` the host has not answered.
    WaitingForConfirmation,
    InProgress,
    Completed,
    Failed,
    /// The user declined.
    Rejected,
    /// The turn was cancelled before this call settled.
    Canceled,
}

/// What the caller must tell the browser after folding one update in.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Change {
    /// A row was appended at this index.
    Appended(usize),
    /// This existing row changed.
    Updated(usize),
    /// Nothing observable changed, so no frame is worth sending.
    None,
}

/// Whether two message ids may describe the same run of text.
///
/// Only a pair of *present, differing* ids proves the text belongs to separate
/// messages. Anything else merges optimistically, because agents that never send
/// ids would otherwise get one transcript row per chunk.
///
/// The asymmetry is intentional and load-bearing: it is what lets an agent start
/// sending ids partway through a message without splitting it. Tightening this
/// to require both ids to match is the most likely way to break streaming for
/// older agents.
pub fn can_merge_message_chunks(existing: Option<&str>, incoming: Option<&str>) -> bool {
    match (existing, incoming) {
        (Some(existing), Some(incoming)) => existing == incoming,
        _ => true,
    }
}

/// One session's transcript.
#[derive(Debug, Default)]
pub struct Thread {
    entries: Vec<Entry>,
}

impl Thread {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn entries(&self) -> &[Entry] {
        &self.entries
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    pub fn entry(&self, index: usize) -> Option<&Entry> {
        self.entries.get(index)
    }

    /// Record the prompt the host is about to send.
    pub fn push_user_message(&mut self, text: impl Into<String>) -> Change {
        self.entries.push(Entry::UserMessage { text: text.into() });
        Change::Appended(self.entries.len() - 1)
    }

    /// Fold one run of agent text in.
    ///
    /// Three outcomes, in the order they are tried, matching the three update
    /// granularities the UI can act on:
    ///
    /// 1. Extend the trailing chunk — the row's text grew.
    /// 2. Add a chunk to the trailing entry — the row gained a section, which
    ///    happens when kind or message id changes mid-message.
    /// 3. Append a new entry — the row count grew.
    ///
    /// Empty text is dropped rather than producing a no-op frame, so an agent
    /// that keepalives with empty chunks cannot flood the UI.
    pub fn push_agent_text(
        &mut self,
        kind: ChunkKind,
        message_id: Option<&str>,
        text: &str,
    ) -> Change {
        if text.is_empty() {
            return Change::None;
        }
        // Taken before the mutable borrow below, which would otherwise conflict.
        let last_index = self.entries.len().saturating_sub(1);
        if let Some(Entry::AssistantMessage { chunks }) = self.entries.last_mut() {
            if let Some(last) = chunks.last_mut()
                && last.kind == kind
                && can_merge_message_chunks(last.message_id.as_deref(), message_id)
            {
                // Backfill so a late id is adopted by text already merged here,
                // instead of leaving this chunk permanently id-less and letting
                // a later differing id merge into it too.
                if last.message_id.is_none() {
                    last.message_id = message_id.map(str::to_owned);
                }
                last.text.push_str(text);
                return Change::Updated(last_index);
            }
            chunks.push(Chunk {
                kind,
                message_id: message_id.map(str::to_owned),
                text: text.to_owned(),
            });
            return Change::Updated(last_index);
        }
        self.entries.push(Entry::AssistantMessage {
            chunks: vec![Chunk {
                kind,
                message_id: message_id.map(str::to_owned),
                text: text.to_owned(),
            }],
        });
        Change::Appended(self.entries.len() - 1)
    }

    /// Create or update a tool call, addressed by its ACP id.
    ///
    /// Fields arrive incrementally, so `None` means "unchanged" rather than
    /// "clear": an agent that sends a status-only update must not blank the
    /// title the UI is already showing.
    pub fn upsert_tool_call(&mut self, update: ToolCallUpdate<'_>) -> Change {
        if let Some(index) = self.tool_call_index(update.tool_call_id) {
            let Some(Entry::ToolCall {
                title,
                status,
                raw_input,
                raw_output,
                ..
            }) = self.entries.get_mut(index)
            else {
                return Change::None;
            };
            let mut changed = false;
            if let Some(new_title) = update.title
                && title.as_str() != new_title
            {
                *title = new_title.to_owned();
                changed = true;
            }
            if let Some(new_status) = update.status
                && *status != new_status
            {
                *status = new_status;
                changed = true;
            }
            if update.raw_input.is_some() && *raw_input != update.raw_input {
                *raw_input = update.raw_input;
                changed = true;
            }
            if update.raw_output.is_some() && *raw_output != update.raw_output {
                *raw_output = update.raw_output;
                changed = true;
            }
            return if changed {
                Change::Updated(index)
            } else {
                Change::None
            };
        }
        self.entries.push(Entry::ToolCall {
            tool_call_id: update.tool_call_id.to_owned(),
            title: update.title.unwrap_or("Tool").to_owned(),
            status: update.status.unwrap_or(ToolCallStatus::Pending),
            raw_input: update.raw_input,
            raw_output: update.raw_output,
        });
        Change::Appended(self.entries.len() - 1)
    }

    /// Move a tool call to a terminal state, reporting the row that changed.
    pub fn settle_tool_call(&mut self, tool_call_id: &str, status: ToolCallStatus) -> Change {
        self.upsert_tool_call(ToolCallUpdate {
            tool_call_id,
            title: None,
            status: Some(status),
            raw_input: None,
            raw_output: None,
        })
    }

    /// Settle every unfinished tool call when a turn ends without resolving them.
    ///
    /// Without this a cancelled turn leaves spinners running forever, since the
    /// agent has no obligation to send a final update for a call it abandoned.
    pub fn settle_unfinished_tool_calls(&mut self, status: ToolCallStatus) -> Vec<usize> {
        let mut changed = Vec::new();
        for (index, entry) in self.entries.iter_mut().enumerate() {
            if let Entry::ToolCall {
                status: current, ..
            } = entry
                && matches!(
                    current,
                    ToolCallStatus::Pending
                        | ToolCallStatus::WaitingForConfirmation
                        | ToolCallStatus::InProgress
                )
            {
                *current = status;
                changed.push(index);
            }
        }
        changed
    }

    fn tool_call_index(&self, wanted: &str) -> Option<usize> {
        self.entries.iter().position(
            |entry| matches!(entry, Entry::ToolCall { tool_call_id, .. } if tool_call_id == wanted),
        )
    }
}

/// An incremental tool-call update. `None` fields are absent, not cleared.
#[derive(Debug, Clone, Default)]
pub struct ToolCallUpdate<'a> {
    pub tool_call_id: &'a str,
    pub title: Option<&'a str>,
    pub status: Option<ToolCallStatus>,
    pub raw_input: Option<serde_json::Value>,
    pub raw_output: Option<serde_json::Value>,
}

impl<'a> ToolCallUpdate<'a> {
    pub fn new(tool_call_id: &'a str) -> Self {
        Self {
            tool_call_id,
            ..Default::default()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn assistant_text(thread: &Thread) -> String {
        thread
            .entries()
            .iter()
            .filter_map(|entry| match entry {
                Entry::AssistantMessage { chunks } => Some(
                    chunks
                        .iter()
                        .filter(|chunk| chunk.kind == ChunkKind::Message)
                        .map(|chunk| chunk.text.as_str())
                        .collect::<String>(),
                ),
                _ => None,
            })
            .collect()
    }

    #[test]
    fn merges_when_neither_side_carries_an_id() {
        assert!(can_merge_message_chunks(None, None));
    }

    #[test]
    fn merges_when_only_one_side_carries_an_id() {
        // Agents may start sending ids partway through a message; refusing here
        // would split that message in the transcript.
        assert!(can_merge_message_chunks(None, Some("m1")));
        assert!(can_merge_message_chunks(Some("m1"), None));
    }

    #[test]
    fn refuses_to_merge_two_different_ids() {
        assert!(!can_merge_message_chunks(Some("m1"), Some("m2")));
        assert!(can_merge_message_chunks(Some("m1"), Some("m1")));
    }

    #[test]
    fn streams_one_message_into_a_single_row() {
        let mut thread = Thread::new();
        assert_eq!(
            thread.push_agent_text(ChunkKind::Message, Some("m1"), "Hel"),
            Change::Appended(0)
        );
        assert_eq!(
            thread.push_agent_text(ChunkKind::Message, Some("m1"), "lo, "),
            Change::Updated(0)
        );
        assert_eq!(
            thread.push_agent_text(ChunkKind::Message, Some("m1"), "world"),
            Change::Updated(0)
        );
        assert_eq!(thread.len(), 1, "one message must not become three rows");
        assert_eq!(assistant_text(&thread), "Hello, world");
    }

    #[test]
    fn keeps_a_new_message_id_in_the_same_row_but_a_separate_chunk() {
        let mut thread = Thread::new();
        thread.push_agent_text(ChunkKind::Message, Some("m1"), "first");
        assert_eq!(
            thread.push_agent_text(ChunkKind::Message, Some("m2"), "second"),
            Change::Updated(0),
            "a new message id sections the row rather than appending a row"
        );
        let Some(Entry::AssistantMessage { chunks }) = thread.entry(0) else {
            panic!("expected an assistant message");
        };
        assert_eq!(chunks.len(), 2);
        assert_eq!(chunks[0].text, "first");
        assert_eq!(chunks[1].text, "second");
    }

    #[test]
    fn adopts_a_late_message_id_for_text_already_merged() {
        let mut thread = Thread::new();
        thread.push_agent_text(ChunkKind::Message, None, "start");
        thread.push_agent_text(ChunkKind::Message, Some("m1"), " middle");
        let Some(Entry::AssistantMessage { chunks }) = thread.entry(0) else {
            panic!("expected an assistant message");
        };
        assert_eq!(chunks.len(), 1, "the late id joins the existing chunk");
        assert_eq!(chunks[0].message_id.as_deref(), Some("m1"));

        // Backfill matters because the chunk is now bound to m1: a differing id
        // must section the row instead of merging into it.
        thread.push_agent_text(ChunkKind::Message, Some("m2"), " other");
        let Some(Entry::AssistantMessage { chunks }) = thread.entry(0) else {
            panic!("expected an assistant message");
        };
        assert_eq!(chunks.len(), 2);
    }

    #[test]
    fn never_merges_thought_text_into_message_text() {
        let mut thread = Thread::new();
        thread.push_agent_text(ChunkKind::Message, Some("m1"), "answer");
        thread.push_agent_text(ChunkKind::Thought, Some("m1"), "reasoning");
        let Some(Entry::AssistantMessage { chunks }) = thread.entry(0) else {
            panic!("expected an assistant message");
        };
        assert_eq!(
            chunks.len(),
            2,
            "a shared message id must not fuse thought into message text"
        );
        assert_eq!(chunks[1].kind, ChunkKind::Thought);
        assert_eq!(assistant_text(&thread), "answer");
    }

    #[test]
    fn drops_empty_text_instead_of_reporting_a_change() {
        let mut thread = Thread::new();
        assert_eq!(
            thread.push_agent_text(ChunkKind::Message, None, ""),
            Change::None
        );
        assert!(thread.is_empty(), "an empty chunk must not create a row");
    }

    #[test]
    fn starts_a_new_row_after_a_tool_call_interrupts_the_text() {
        let mut thread = Thread::new();
        thread.push_agent_text(ChunkKind::Message, Some("m1"), "before");
        thread.upsert_tool_call(ToolCallUpdate::new("t1"));
        assert_eq!(
            thread.push_agent_text(ChunkKind::Message, Some("m1"), "after"),
            Change::Appended(2),
            "text after a tool call cannot rejoin the row above it"
        );
        assert_eq!(thread.len(), 3);
    }

    #[test]
    fn appends_a_user_message_as_its_own_row() {
        let mut thread = Thread::new();
        assert_eq!(
            thread.push_user_message("do the thing"),
            Change::Appended(0)
        );
        assert_eq!(
            thread.entry(0),
            Some(&Entry::UserMessage {
                text: "do the thing".to_owned()
            })
        );
    }

    #[test]
    fn creates_then_updates_a_tool_call_at_a_stable_index() {
        let mut thread = Thread::new();
        assert_eq!(
            thread.upsert_tool_call(ToolCallUpdate {
                tool_call_id: "t1",
                title: Some("Read file"),
                status: Some(ToolCallStatus::Pending),
                ..Default::default()
            }),
            Change::Appended(0)
        );
        assert_eq!(
            thread.settle_tool_call("t1", ToolCallStatus::Completed),
            Change::Updated(0),
            "an update must address the existing row, not append a second one"
        );
        assert_eq!(thread.len(), 1);
    }

    #[test]
    fn treats_an_absent_field_as_unchanged_rather_than_cleared() {
        let mut thread = Thread::new();
        thread.upsert_tool_call(ToolCallUpdate {
            tool_call_id: "t1",
            title: Some("Read file"),
            status: Some(ToolCallStatus::Pending),
            raw_input: Some(serde_json::json!({ "path": "a.txt" })),
            ..Default::default()
        });
        thread.settle_tool_call("t1", ToolCallStatus::Completed);
        let Some(Entry::ToolCall {
            title, raw_input, ..
        }) = thread.entry(0)
        else {
            panic!("expected a tool call");
        };
        assert_eq!(
            title, "Read file",
            "a status-only update must keep the title"
        );
        assert_eq!(
            raw_input.as_ref().and_then(|value| value.get("path")),
            Some(&serde_json::json!("a.txt"))
        );
    }

    #[test]
    fn reports_no_change_when_an_update_carries_nothing_new() {
        let mut thread = Thread::new();
        thread.upsert_tool_call(ToolCallUpdate {
            tool_call_id: "t1",
            status: Some(ToolCallStatus::InProgress),
            ..Default::default()
        });
        assert_eq!(
            thread.settle_tool_call("t1", ToolCallStatus::InProgress),
            Change::None,
            "a repeated status must not spend a frame"
        );
    }

    #[test]
    fn settles_only_unfinished_tool_calls_when_a_turn_ends() {
        let mut thread = Thread::new();
        thread.upsert_tool_call(ToolCallUpdate {
            tool_call_id: "done",
            status: Some(ToolCallStatus::Completed),
            ..Default::default()
        });
        thread.upsert_tool_call(ToolCallUpdate {
            tool_call_id: "waiting",
            status: Some(ToolCallStatus::WaitingForConfirmation),
            ..Default::default()
        });
        thread.upsert_tool_call(ToolCallUpdate {
            tool_call_id: "running",
            status: Some(ToolCallStatus::InProgress),
            ..Default::default()
        });
        assert_eq!(
            thread.settle_unfinished_tool_calls(ToolCallStatus::Canceled),
            vec![1, 2],
            "a completed call must not be rewritten by cancellation"
        );
        let Some(Entry::ToolCall { status, .. }) = thread.entry(0) else {
            panic!("expected a tool call");
        };
        assert_eq!(*status, ToolCallStatus::Completed);
    }
}
