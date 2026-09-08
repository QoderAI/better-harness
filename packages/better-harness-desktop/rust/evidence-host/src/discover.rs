use serde::Deserialize;
use serde_json::{Value, json};

use crate::artifacts::observe;
use crate::model::{PORTED, ProviderStatus, SessionSummary, UNPORTED};
use crate::paths::normalize_workspace;
use crate::platforms::{claude, codex, copilot, cursor, grok, qoder};

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
}

pub fn discover(params: DiscoverParams) -> Result<Value, String> {
    let workspace = normalize_workspace(&params.workspace);
    let max_sessions = params.max_sessions.unwrap_or(100).clamp(1, 100) as usize;
    let _ = (params.include_tool_trace, params.include_dialogue);

    let mut providers = Vec::new();
    let mut sessions = Vec::new();

    for platform in PORTED {
        let result = match *platform {
            "qoder" => qoder::discover(&workspace, max_sessions),
            "codex" => codex::discover(&workspace, max_sessions),
            "claude" => claude::discover(&workspace, max_sessions),
            "cursor" => cursor::discover(&workspace, max_sessions),
            "copilot" => copilot::discover(&workspace, max_sessions),
            "grok" => grok::discover(&workspace, max_sessions),
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

    sessions.sort_by(|left, right| right.last_seen.cmp(&left.last_seen));
    if sessions.len() > max_sessions {
        sessions.truncate(max_sessions);
    }

    recount_included(&mut providers, &sessions);
    let observations = observe(&workspace, &sessions);
    Ok(json!({
        "sessions": sessions,
        "providers": providers,
        "observations": observations,
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
    let sessions: Vec<SessionSummary> = serde_json::from_value(
        params
            .get("sessions")
            .cloned()
            .unwrap_or_else(|| json!([])),
    )
    .map_err(|error| error.to_string())?;
    let observations = observe(&normalize_workspace(workspace), &sessions);
    Ok(json!({ "observations": observations }))
}
