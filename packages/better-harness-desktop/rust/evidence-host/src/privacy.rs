use crate::model::SessionSummary;

/// Redact credentials and filesystem/id material in retained snapshot text.
/// Structured `filePath` fields are left alone so Artifact observations still resolve.
pub fn redact_private_text(input: &str) -> String {
    let mut text = strip_markdown_media(input);
    text = redact_quoted_json_secrets(&text);
    text = redact_assignment_secrets(&text);
    text = redact_bearer(&text);
    text = redact_known_prefixes(&text);
    text = redact_url_userinfo(&text);
    text = redact_fs_paths(&text);
    text = redact_ids(&text);
    collapse_space(&text)
}

pub fn prepare_prompt_text(input: &str) -> String {
    let mut text = strip_injected_blocks(input);
    if let Some(body) = delegated_input(&text) {
        text = body;
    }
    if let Some(index) = find_ci(&text, "# my request") {
        if let Some(colon) = text[index..].find(':') {
            text = text[index + colon + 1..].trim().to_string();
        }
    } else if starts_injected_prefix(&text) {
        return String::new();
    }
    text.trim().to_string()
}

pub fn redact_session(session: &mut SessionSummary) {
    for prompt in &mut session.prompts {
        prompt.text = redact_private_text(&prepare_prompt_text(&prompt.text));
    }
    session.prompts.retain(|prompt| !prompt.text.is_empty());
    session.prompt_count = session.prompts.len() as u32;
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

fn strip_injected_blocks(input: &str) -> String {
    let mut text = input.to_string();
    for tag in [
        "environment_context",
        "skill",
        "recommended_plugins",
        "codex_internal_context",
        "local-command-caveat",
        "local-command-stdout",
        "command-name",
        "command-message",
        "command-args",
        "turn_aborted",
        "image",
    ] {
        text = strip_tag_blocks(&text, tag);
    }
    text
}

fn strip_tag_blocks(input: &str, tag: &str) -> String {
    let open = format!("<{tag}");
    let close = format!("</{tag}>");
    let lower = input.to_ascii_lowercase();
    let open_l = open.to_ascii_lowercase();
    let close_l = close.to_ascii_lowercase();
    let mut out = String::new();
    let mut i = 0;
    while let Some(rel) = lower[i..].find(&open_l) {
        let start = i + rel;
        out.push_str(&input[i..start]);
        let after_open = start + open.len();
        let rest_l = &lower[after_open..];
        if rest_l.starts_with("/>") {
            i = after_open + 2;
            continue;
        }
        if let Some(end_rel) = rest_l.find(&close_l) {
            i = after_open + end_rel + close.len();
            continue;
        }
        break;
    }
    out.push_str(&input[i..]);
    out
}

fn delegated_input(text: &str) -> Option<String> {
    let lower = text.to_ascii_lowercase();
    if !lower.contains("<codex_delegation>") {
        return None;
    }
    let start = lower.find("<input>")? + 7;
    let end = lower[start..].find("</input>")?;
    Some(text[start..start + end].trim().to_string())
}

fn starts_injected_prefix(text: &str) -> bool {
    let trimmed = text.trim_start();
    let lower = trimmed.to_ascii_lowercase();
    lower.starts_with("# agents.md")
        || lower.starts_with("<environment_context>")
        || lower.starts_with("<skill>")
        || lower.starts_with("# files mentioned by the user:")
}

fn find_ci(haystack: &str, needle: &str) -> Option<usize> {
    haystack.to_ascii_lowercase().find(needle)
}

fn strip_markdown_media(input: &str) -> String {
    let mut text = String::new();
    let mut rest = input;
    while let Some(start) = rest.find("![") {
        text.push_str(&rest[..start]);
        let after = &rest[start + 2..];
        if let Some(mid) = after.find("](") {
            if let Some(end) = after[mid + 2..].find(')') {
                rest = &after[mid + 2 + end + 1..];
                text.push(' ');
                continue;
            }
        }
        text.push_str(&rest[start..start + 2]);
        rest = &rest[start + 2..];
    }
    text.push_str(rest);
    let mut out = String::new();
    let mut rest = text.as_str();
    while let Some(start) = rest.find('[') {
        out.push_str(&rest[..start]);
        let after = &rest[start + 1..];
        if let Some(mid) = after.find("](") {
            if mid <= 200 {
                if let Some(end) = after[mid + 2..].find(')') {
                    out.push_str(&after[..mid]);
                    rest = &after[mid + 2 + end + 1..];
                    continue;
                }
            }
        }
        out.push('[');
        rest = after;
    }
    out.push_str(rest);
    out
}

fn redact_fs_paths(input: &str) -> String {
    let mut out = String::new();
    let mut i = 0;
    while i < input.len() {
        if input[i..].starts_with("://") {
            out.push_str("://");
            i += 3;
            let body = &input[i..];
            let extra = body
                .find(|ch: char| ch.is_whitespace() || matches!(ch, '"' | '\'' | '<' | '>'))
                .unwrap_or(body.len());
            out.push_str(&body[..extra]);
            i += extra;
            continue;
        }
        if let Some(len) = posix_abs_path_len(input, i) {
            out.push_str("<path>");
            i += len;
            continue;
        }
        if let Some(len) = windows_path_len(&input[i..]) {
            out.push_str("<path>");
            i += len;
            continue;
        }
        if let Some(len) = relative_path_len(&input[i..]) {
            out.push_str("<path>");
            i += len;
            continue;
        }
        let ch = input[i..].chars().next().unwrap();
        out.push(ch);
        i += ch.len_utf8();
    }
    out
}

fn posix_abs_path_len(input: &str, i: usize) -> Option<usize> {
    let rest = &input[i..];
    if !rest.starts_with('/') {
        return None;
    }
    if i > 0 {
        let prev = input[..i].chars().next_back()?;
        if prev.is_ascii_alphanumeric() || prev == '_' {
            return None;
        }
    }
    for root in ["/Users/", "/home/", "/var/", "/private/", "/tmp/", "/opt/"] {
        if rest.starts_with(root)
            || rest
                .to_ascii_lowercase()
                .starts_with(&root.to_ascii_lowercase())
        {
            let body = &rest[root.len()..];
            let extra = body
                .find(|ch: char| ch.is_whitespace() || matches!(ch, '"' | '\'' | '`' | '<' | '>'))
                .unwrap_or(body.len());
            return Some(root.len() + extra);
        }
    }
    None
}

fn windows_path_len(rest: &str) -> Option<usize> {
    let mut chars = rest.chars();
    let drive = chars.next()?;
    if !drive.is_ascii_alphabetic() {
        return None;
    }
    if chars.next() != Some(':') || chars.next() != Some('\\') {
        return None;
    }
    let extra = rest[3..]
        .find(|ch: char| ch.is_whitespace() || matches!(ch, '"' | '\'' | '`' | '<' | '>'))
        .unwrap_or(rest.len() - 3);
    Some(3 + extra)
}

fn relative_path_len(rest: &str) -> Option<usize> {
    if rest.starts_with("../") || rest.starts_with("..\\") {
        return pathy_run(&rest[3..]).map(|extra| 3 + extra);
    }
    if rest.starts_with("./") || rest.starts_with(".\\") {
        return pathy_run(&rest[2..]).map(|extra| 2 + extra);
    }
    pathy_run(rest)
}

fn pathy_run(rest: &str) -> Option<usize> {
    let mut consumed = 0;
    let mut segments = 0;
    let mut i = 0;
    while i < rest.len() {
        let ch = rest[i..].chars().next()?;
        if ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-') {
            i += ch.len_utf8();
            consumed = i;
            continue;
        }
        if (ch == '/' || ch == '\\') && i > 0 {
            segments += 1;
            i += 1;
            consumed = i;
            continue;
        }
        break;
    }
    if segments == 0 || consumed == 0 {
        return None;
    }
    if rest[..consumed].ends_with('/') || rest[..consumed].ends_with('\\') {
        consumed -= 1;
    }
    (consumed > 0 && segments >= 1).then_some(consumed)
}

fn redact_ids(input: &str) -> String {
    let mut out = String::new();
    let mut i = 0;
    while i < input.len() {
        if let Some(len) = uuid_len(&input[i..]) {
            out.push_str("<id>");
            i += len;
            continue;
        }
        if let Some(len) = labeled_id_len(&input[i..]) {
            out.push_str("<id>");
            i += len;
            continue;
        }
        let ch = input[i..].chars().next().unwrap();
        out.push(ch);
        i += ch.len_utf8();
    }
    out
}

fn uuid_len(rest: &str) -> Option<usize> {
    const LEN: usize = 36;
    if rest.len() < LEN || !rest.is_char_boundary(LEN) {
        return None;
    }
    let candidate = &rest[..LEN];
    let bytes = candidate.as_bytes();
    if bytes[8] != b'-' || bytes[13] != b'-' || bytes[18] != b'-' || bytes[23] != b'-' {
        return None;
    }
    let version = candidate.as_bytes()[14];
    if !(b'1'..=b'5').contains(&version) {
        return None;
    }
    let hex = |ch: u8| ch.is_ascii_hexdigit();
    if candidate
        .bytes()
        .enumerate()
        .all(|(idx, ch)| matches!(idx, 8 | 13 | 18 | 23) || hex(ch))
    {
        Some(LEN)
    } else {
        None
    }
}

fn labeled_id_len(rest: &str) -> Option<usize> {
    let lower = rest.to_ascii_lowercase();
    for label in [
        "session-", "session_", "session:", "thread-", "thread_", "thread:", "task-", "task_",
        "task:",
    ] {
        if lower.starts_with(label) {
            let body = &rest[label.len()..];
            let body_len = body
                .find(|ch: char| !(ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-')))
                .unwrap_or(body.len());
            if body_len >= 8 && body[..body_len].chars().any(|ch| ch.is_ascii_digit()) {
                return Some(label.len() + body_len);
            }
        }
    }
    None
}

fn collapse_space(input: &str) -> String {
    let mut out = String::new();
    let mut prev_space = false;
    for ch in input.chars() {
        if ch.is_whitespace() {
            if !prev_space && !out.is_empty() {
                out.push(' ');
            }
            prev_space = true;
        } else {
            prev_space = false;
            out.push(ch);
        }
    }
    out.trim().to_string()
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
        assert!(redact_private_text("see /Users/phodal/src/app.ts later").contains("<path>"));
        assert!(redact_private_text("docs/kept.md").contains("<path>"));
        assert!(!redact_private_text("plain words only").contains("<path>"));
        assert_eq!(
            prepare_prompt_text(
                "<environment_context>cwd: /tmp</environment_context>\n# AGENTS.md instructions"
            ),
            ""
        );
        assert!(prepare_prompt_text("# My request:\nShip the parser").contains("Ship the parser"));
    }
}
