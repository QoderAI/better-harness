use crate::model::SessionSummary;

/// Redact credentials in retained snapshot text. Structured `filePath` fields
/// are left alone so Artifact observations still resolve.
pub fn redact_private_text(input: &str) -> String {
    let mut text = redact_quoted_json_secrets(input);
    text = redact_assignment_secrets(&text);
    text = redact_bearer(&text);
    text = redact_known_prefixes(&text);
    text = redact_url_userinfo(&text);
    text
}

pub fn redact_session(session: &mut SessionSummary) {
    for prompt in &mut session.prompts {
        prompt.text = redact_private_text(&prompt.text);
    }
    if let Some(activity) = &mut session.tool_activity {
        for call in &mut activity.calls {
            if let Some(detail) = &mut call.detail {
                *detail = redact_private_text(detail);
            }
            if let Some(output) = &mut call.output {
                *output = redact_private_text(output);
            }
        }
    }
    if let Some(dialogue) = &mut session.dialogue {
        for turn in &mut dialogue.turns {
            if let Some(response) = &mut turn.response {
                *response = redact_private_text(response);
            }
        }
    }
}

fn redact_quoted_json_secrets(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let lower = input.to_ascii_lowercase();
    let mut i = 0;
    while i < input.len() {
        if let Some(key_end) = quoted_secret_key(&lower, i) {
            if let Some((quote, value_from)) = skip_to_quoted_value(input, key_end) {
                if let Some(value_end) = input[value_from + 1..].find(quote) {
                    out.push_str(&input[i..value_from + 1]);
                    out.push_str("<redacted>");
                    let close = value_from + 1 + value_end;
                    out.push(quote);
                    i = close + 1;
                    continue;
                }
            }
        }
        let ch = input[i..].chars().next().unwrap();
        out.push(ch);
        i += ch.len_utf8();
    }
    out
}

fn quoted_secret_key(lower: &str, from: usize) -> Option<usize> {
    let rest = &lower[from..];
    for key in [
        "api_key",
        "api-key",
        "access_token",
        "access-token",
        "auth_token",
        "auth-token",
        "password",
        "secret",
    ] {
        let quoted = format!("\"{key}\"");
        let quoted_single = format!("'{key}'");
        if rest.starts_with(&quoted) {
            return Some(from + quoted.len());
        }
        if rest.starts_with(&quoted_single) {
            return Some(from + quoted_single.len());
        }
    }
    None
}

fn skip_to_quoted_value(input: &str, key_end: usize) -> Option<(char, usize)> {
    let rest = input[key_end..].trim_start_matches([' ', '\t']);
    let rest = rest.strip_prefix(':')?.trim_start_matches([' ', '\t']);
    let quote = rest.chars().next()?;
    if quote != '"' && quote != '\'' {
        return None;
    }
    let offset = input.len() - rest.len();
    Some((quote, offset))
}

fn redact_assignment_secrets(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let lower = input.to_ascii_lowercase();
    let mut i = 0;
    while i < input.len() {
        if let Some(key) = starts_with_secret_key(&lower[i..]) {
            let after_key = i + key.len();
            let trimmed = input[after_key..].trim_start_matches([' ', '\t']);
            if trimmed.starts_with('=') || trimmed.starts_with(':') {
                out.push_str(&input[i..after_key]);
                let sep_offset = input[after_key..]
                    .find(|ch| ch == '=' || ch == ':')
                    .unwrap_or(0);
                let sep_at = after_key + sep_offset;
                out.push_str(&input[after_key..=sep_at]);
                let value_start = input[sep_at + 1..]
                    .char_indices()
                    .find(|(_, ch)| !ch.is_whitespace())
                    .map(|(idx, _)| sep_at + 1 + idx)
                    .unwrap_or(input.len());
                out.push_str(&input[sep_at + 1..value_start]);
                out.push_str("<redacted>");
                let value = &input[value_start..];
                let value_len = value
                    .find(|ch: char| ch.is_whitespace() || matches!(ch, ',' | ';' | '"' | '\''))
                    .unwrap_or(value.len());
                i = value_start + value_len;
                continue;
            }
        }
        let ch = input[i..].chars().next().unwrap();
        out.push(ch);
        i += ch.len_utf8();
    }
    out
}

fn starts_with_secret_key(lower: &str) -> Option<&str> {
    for key in [
        "api_key",
        "api-key",
        "access_token",
        "access-token",
        "auth_token",
        "auth-token",
        "password",
        "secret",
    ] {
        if lower.starts_with(key) {
            return Some(key);
        }
    }
    None
}

fn redact_bearer(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let lower = input.to_ascii_lowercase();
    let mut i = 0;
    while i < input.len() {
        if lower[i..].starts_with("bearer ") {
            let rest = &input[i + 7..];
            let token_len = rest
                .find(|ch: char| {
                    !(ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-' | '~' | '+' | '/'))
                })
                .unwrap_or(rest.len());
            if token_len >= 8 {
                out.push_str("Bearer <redacted>");
                i += 7 + token_len;
                continue;
            }
        }
        let ch = input[i..].chars().next().unwrap();
        out.push(ch);
        i += ch.len_utf8();
    }
    out
}

fn redact_known_prefixes(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut i = 0;
    while i < input.len() {
        let rest = &input[i..];
        if let Some(len) = secret_prefix_len(rest) {
            out.push_str("<secret>");
            i += len;
            continue;
        }
        let ch = rest.chars().next().unwrap();
        out.push(ch);
        i += ch.len_utf8();
    }
    out
}

fn secret_prefix_len(rest: &str) -> Option<usize> {
    for prefix in [
        "sk-",
        "ghp-",
        "github_pat_",
        "glpat-",
        "xoxa-",
        "xoxb-",
        "xoxp-",
        "xoxr-",
        "xoxs-",
    ] {
        if rest.len() >= prefix.len()
            && rest.is_char_boundary(prefix.len())
            && rest[..prefix.len()].eq_ignore_ascii_case(prefix)
        {
            let body = &rest[prefix.len()..];
            let body_len = body
                .find(|ch: char| !(ch.is_ascii_alphanumeric() || ch == '_' || ch == '-'))
                .unwrap_or(body.len());
            if body_len >= 8 {
                return Some(prefix.len() + body_len);
            }
        }
    }
    if rest.starts_with("AKIA") && rest.len() >= 16 {
        let body_len = rest[4..]
            .find(|ch: char| !ch.is_ascii_alphanumeric())
            .unwrap_or(rest.len() - 4);
        if body_len >= 12 {
            return Some(4 + body_len);
        }
    }
    None
}

fn redact_url_userinfo(input: &str) -> String {
    let mut out = String::new();
    let mut last = 0;
    let lower = input.to_ascii_lowercase();
    for (idx, _) in lower.match_indices("://") {
        if idx < last {
            continue;
        }
        out.push_str(&input[last..idx + 3]);
        let after = &input[idx + 3..];
        if let Some(at) = after.find('@') {
            let creds = &after[..at];
            if !creds.is_empty() && !creds.contains('/') && creds.len() < 256 {
                out.push_str("<redacted>@");
                last = idx + 3 + at + 1;
                continue;
            }
        }
        last = idx + 3;
    }
    out.push_str(&input[last..]);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redacts_bearer_and_assignment_and_quoted_json() {
        assert!(
            redact_private_text("Authorization: Bearer abcdefghijklmnop")
                .contains("Bearer <redacted>")
        );
        assert!(redact_private_text("api_key=super-secret-value").contains("api_key=<redacted>"));
        assert!(redact_private_text(r#"{"api_key":"confidential"}"#).contains("<redacted>"));
        assert!(redact_private_text("sk-abcdefghijklmnop").contains("<secret>"));
        assert!(!redact_private_text("docs/kept.md").contains("<path>"));
    }
}
