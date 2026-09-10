use serde::Deserialize;
use serde_json::{json, Value};

use crate::artifacts::observe;
use crate::model::{ProviderStatus, SessionSummary, Window, PORTED, UNPORTED};
use crate::paths::normalize_workspace;
use crate::platforms::{
    augment, claude, codex, copilot, cursor, dsh, grok, harness_run, kimi, pi, qoder, qwen,
    workbuddy,
};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoverParams {
    pub workspace: String,
    #[serde(default)]
    pub max_sessions: Option<u32>,
    #[serde(default)]
    pub include_tool_trace: Option<bool>,
    #[serde(default)]
    pub include_dialogue: Option<bool>,
    /// Observation window, as absolute instants resolved by the caller.
    #[serde(default)]
    pub from_ms: Option<i64>,
    #[serde(default)]
    pub to_ms: Option<i64>,
}

/// Session bodies this answer may carry, well inside the host's frame limit so
/// the providers, observations and coverage report still fit beside them.
const RESPONSE_BUDGET: usize = 8 * 1024 * 1024;

pub fn discover(params: DiscoverParams) -> Result<Value, String> {
    let workspace = normalize_workspace(&params.workspace);
    // The cap bounds one answer, not the reader's history. It is applied inside
    // the requested window so narrowing the window reaches further back rather
    // than only subtracting from the newest page.
    let max_sessions = params.max_sessions.unwrap_or(100).clamp(1, 500) as usize;
    let window = Window {
        from_ms: params.from_ms,
        to_ms: params.to_ms,
    };
    let _ = (params.include_tool_trace, params.include_dialogue);

    let mut providers = Vec::new();
    let mut sessions = Vec::new();

    for platform in PORTED {
        let result = match *platform {
            // These three carry the window down to their own file walk, where
            // it skips transcripts that cannot hold in-window activity. Every
            // other platform is filtered below instead: the window is enforced
            // in one place, and reading it earlier is only ever an optimization.
            "qoder" => qoder::discover(&workspace, max_sessions, window),
            "codex" => codex::discover(&workspace, max_sessions, window),
            "claude" => claude::discover(&workspace, max_sessions, window),
            "cursor" => cursor::discover(&workspace, max_sessions),
            "copilot" => copilot::discover(&workspace, max_sessions),
            "grok" => grok::discover(&workspace, max_sessions),
            "augment" => augment::discover(&workspace, max_sessions),
            "qwen" => qwen::discover(&workspace, max_sessions),
            "pi" => pi::discover(&workspace, max_sessions),
            "kimi" => kimi::discover(&workspace, max_sessions),
            "workbuddy" => workbuddy::discover(&workspace, max_sessions),
            "dsh" => dsh::discover(&workspace, max_sessions),
            "harness-run" => harness_run::discover(&workspace, max_sessions),
            _ => Ok(Vec::new()),
        };
        match result {
            Ok(found) => {
                let discovered = found.len() as u32;
                sessions.extend(found);
                providers.push(ok(platform, discovered, discovered));
            }
            Err(message) => providers.push(error(platform, message)),
        }
    }

    for platform in UNPORTED {
        providers.push(ProviderStatus {
            platform: (*platform).into(),
            status: "no-evidence".into(),
            discovered: 0,
            included: 0,
            message: None,
        });
    }

    // One authoritative window check, on the instant a Session states rather
    // than on the file that happens to hold it.
    if !window.is_open() {
        sessions.retain(|session| {
            window.contains(crate::time::millis(&json!(session
                .last_seen
                .clone()
                .or_else(|| session.first_seen.clone()))))
        });
    }
    sessions.sort_by(|left, right| right.last_seen.cmp(&left.last_seen));
    let in_window = sessions.len();
    if sessions.len() > max_sessions {
        sessions.truncate(max_sessions);
    }
    for session in &mut sessions {
        crate::model::bound_session_text(session, 64 * 1024);
    }
    // A count cannot know how large a Session is, and the frame this answer has
    // to fit in is measured in bytes. Keep whole Sessions until the budget is
    // reached and report the rest as omitted: a truncated answer a reader can
    // see past is worth more than a frame that cannot be delivered at all.
    let mut used = 0usize;
    let mut kept = 0usize;
    for session in &sessions {
        let size = serde_json::to_string(session).map_or(0, |text| text.len());
        if kept > 0 && used + size > RESPONSE_BUDGET {
            break;
        }
        used += size;
        kept += 1;
    }
    sessions.truncate(kept);
    let omitted = in_window.saturating_sub(sessions.len());
    recount_included(&mut providers, &sessions);
    let observations = observe(&workspace, &sessions);
    Ok(json!({
        "sessions": sessions,
        "providers": providers,
        "observations": observations,
        // What the cap left out of this window, stated rather than implied, so
        // a reader is never told a truncated page is everything they retained.
        "coverage": { "inWindow": in_window, "included": sessions.len(), "omitted": omitted,
            "windowed": !window.is_open() },
    }))
}

fn ok(platform: &str, discovered: u32, included: u32) -> ProviderStatus {
    ProviderStatus {
        platform: platform.into(),
        status: if discovered == 0 { "no-evidence" } else { "ok" }.into(),
        discovered,
        included: if discovered == 0 { 0 } else { included },
        message: None,
    }
}

fn error(platform: &str, message: String) -> ProviderStatus {
    ProviderStatus {
        platform: platform.into(),
        status: "error".into(),
        discovered: 0,
        included: 0,
        message: Some(message),
    }
}

fn recount_included(providers: &mut [ProviderStatus], sessions: &[SessionSummary]) {
    for provider in providers {
        if provider.status != "ok" {
            continue;
        }
        provider.included = sessions
            .iter()
            .filter(|session| session.platform == provider.platform)
            .count() as u32;
    }
}

pub fn observe_params(params: &Value) -> Result<Value, String> {
    let workspace = params
        .get("workspace")
        .and_then(Value::as_str)
        .ok_or_else(|| "workspace is required".to_string())?;
    let sessions: Vec<SessionSummary> =
        serde_json::from_value(params.get("sessions").cloned().unwrap_or_else(|| json!([])))
            .map_err(|error| error.to_string())?;
    let observations = observe(&normalize_workspace(workspace), &sessions);
    Ok(json!({ "observations": observations }))
}
