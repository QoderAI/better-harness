//! Credential redaction for retained protocol frames.
//!
//! Frames are evidence: they are persisted, rendered in Studio, and read by
//! people reviewing a run. An ACP agent may put a bearer token in `_meta`, so a
//! verbatim frame is a credential leak with a long tail.
//!
//! The rule mirrors the Node executor's `redactTraceValue` exactly, because the
//! two produce the same `trace` array and a reviewer must not have to know which
//! host wrote it. That implementation uses a case-insensitive regex allowing an
//! optional `_` or `-` between words; this normalizes the key instead, which
//! avoids a regex dependency and matches the same set.

use serde_json::Value;

/// Placeholder written in place of a credential-shaped value.
pub const REDACTED: &str = "[REDACTED]";

/// Key fragments that mark a value as credential-shaped, already normalized.
const SECRET_FRAGMENTS: &[&str] = &[
    "authorization",
    "apikey",
    "accesstoken",
    "refreshtoken",
    "serviceaccountkey",
    "secret",
    "credential",
];

/// Whether a field name looks like it carries a credential.
///
/// Separators are dropped before matching so `api_key`, `api-key`, and `apiKey`
/// are treated alike, the same set the Node regex accepts.
pub fn is_secret_field(key: &str) -> bool {
    let normalized: String = key
        .chars()
        .filter(|character| *character != '_' && *character != '-')
        .flat_map(char::to_lowercase)
        .collect();
    SECRET_FRAGMENTS
        .iter()
        .any(|fragment| normalized.contains(fragment))
}

/// Replace every credential-shaped field, at any depth, with [`REDACTED`].
///
/// Redaction is by key, not by value shape: a token is not recognisable from its
/// text, and guessing would both miss real secrets and mangle innocent strings.
pub fn redact(value: Value) -> Value {
    match value {
        Value::Array(items) => Value::Array(items.into_iter().map(redact).collect()),
        Value::Object(fields) => Value::Object(
            fields
                .into_iter()
                .map(|(key, field)| {
                    if is_secret_field(&key) {
                        (key, Value::String(REDACTED.to_owned()))
                    } else {
                        (key, redact(field))
                    }
                })
                .collect(),
        ),
        scalar => scalar,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn recognizes_credential_field_names_across_separator_styles() {
        for key in [
            "authorization",
            "Authorization",
            "api_key",
            "api-key",
            "apiKey",
            "APIKEY",
            "access_token",
            "refreshToken",
            "service_account_key",
            "clientSecret",
            "credential",
            "credentials",
        ] {
            assert!(is_secret_field(key), "{key} should be treated as a secret");
        }
    }

    #[test]
    fn leaves_ordinary_field_names_alone() {
        for key in [
            "sessionId",
            "toolCallId",
            "method",
            "prompt",
            "title",
            "kind",
            "protocolVersion",
        ] {
            assert!(!is_secret_field(key), "{key} should not be redacted");
        }
    }

    #[test]
    fn redacts_a_nested_credential_without_disturbing_its_siblings() {
        // Shaped after the fixture agent, which sends a bearer token in _meta
        // precisely so redaction is exercised on a real frame.
        let frame = json!({
            "jsonrpc": "2.0",
            "id": 3,
            "method": "session/request_permission",
            "params": {
                "sessionId": "fixture-session",
                "toolCall": { "toolCallId": "fixture-tool", "title": "Inspect" },
                "_meta": { "authorization": "Bearer fixture-secret" },
            },
        });
        let redacted = redact(frame);
        assert_eq!(redacted["params"]["_meta"]["authorization"], REDACTED);
        assert_eq!(redacted["params"]["sessionId"], "fixture-session");
        assert_eq!(redacted["method"], "session/request_permission");
        let serialized = serde_json::to_string(&redacted).expect("frame should serialize");
        assert!(
            !serialized.contains("fixture-secret"),
            "no credential text may survive, got {serialized}"
        );
    }

    #[test]
    fn redacts_credentials_inside_arrays() {
        let redacted = redact(json!({
            "servers": [
                { "name": "one", "apiKey": "k1" },
                { "name": "two", "apiKey": "k2" },
            ],
        }));
        assert_eq!(redacted["servers"][0]["apiKey"], REDACTED);
        assert_eq!(redacted["servers"][1]["apiKey"], REDACTED);
        assert_eq!(redacted["servers"][1]["name"], "two");
    }

    #[test]
    fn redacts_a_whole_subtree_when_the_key_itself_is_credential_shaped() {
        // The value is replaced, not walked: a nested token would otherwise
        // survive under an innocent-looking inner key.
        let redacted = redact(json!({ "credentials": { "user": "a", "pass": "b" } }));
        assert_eq!(redacted["credentials"], REDACTED);
    }

    #[test]
    fn leaves_scalars_and_nulls_unchanged() {
        assert_eq!(redact(json!(7)), json!(7));
        assert_eq!(redact(json!("plain")), json!("plain"));
        assert_eq!(redact(Value::Null), Value::Null);
    }
}
