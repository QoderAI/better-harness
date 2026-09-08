use serde_json::Value;

pub fn normalize_timestamp(value: &Value) -> Option<String> {
    millis(value).map(|stamp| {
        let seconds = stamp / 1000;
        let nanos = ((stamp % 1000) * 1_000_000) as u32;
        format_millis(seconds, nanos)
    })
}

pub fn millis(value: &Value) -> Option<i64> {
    match value {
        Value::Null => None,
        Value::Number(number) => {
            let raw = number.as_f64()?;
            if !raw.is_finite() {
                return None;
            }
            let stamp = if raw < 10_000_000_000.0 {
                (raw * 1000.0) as i64
            } else {
                raw as i64
            };
            (stamp > 0).then_some(stamp)
        }
        Value::String(text) if !text.is_empty() => parse_rfc3339(text),
        _ => None,
    }
}

fn parse_rfc3339(text: &str) -> Option<i64> {
    // Accept the subset Qoder/Grok actually emit: RFC3339 with optional fractional seconds.
    let parsed = DateTimeLite::parse(text)?;
    Some(parsed)
}

struct DateTimeLite;

impl DateTimeLite {
    fn parse(text: &str) -> Option<i64> {
        // 2026-09-08T05:38:19.958Z or 2026-09-02T15:22:37.117+08:00
        let normalized = text.replace(' ', "T");
        let (date, rest) = normalized.split_once('T')?;
        let mut date_parts = date.split('-');
        let year: i32 = date_parts.next()?.parse().ok()?;
        let month: u32 = date_parts.next()?.parse().ok()?;
        let day: u32 = date_parts.next()?.parse().ok()?;
        let (time, offset) = split_offset(rest)?;
        let mut time_parts = time.split(':');
        let hour: u32 = time_parts.next()?.parse().ok()?;
        let minute: u32 = time_parts.next()?.parse().ok()?;
        let second_raw = time_parts.next().unwrap_or("0");
        let (second_text, frac) = second_raw.split_once('.').unwrap_or((second_raw, "0"));
        let second: u32 = second_text.parse().ok()?;
        let mut frac_digits: String = frac.chars().filter(|ch| ch.is_ascii_digit()).take(3).collect();
        while frac_digits.len() < 3 {
            frac_digits.push('0');
        }
        let millis: i64 = frac_digits.parse().ok()?;
        let days = days_from_civil(year, month, day)?;
        let local = ((days * 86400) + (hour as i64) * 3600 + (minute as i64) * 60 + second as i64)
            * 1000
            + millis;
        Some(local - offset)
    }
}

fn split_offset(rest: &str) -> Option<(&str, i64)> {
    if let Some(stripped) = rest.strip_suffix('Z').or_else(|| rest.strip_suffix('z')) {
        return Some((stripped, 0));
    }
    let plus = rest.rfind('+');
    let minus = rest.rfind('-').filter(|&index| index > 2);
    let (time, sign, offset_text) = if let Some(index) = plus {
        (&rest[..index], 1i64, &rest[index + 1..])
    } else if let Some(index) = minus {
        (&rest[..index], -1i64, &rest[index + 1..])
    } else {
        return Some((rest, 0));
    };
    let offset_text = offset_text.replace(':', "");
    if offset_text.len() < 2 {
        return None;
    }
    let hours: i64 = offset_text.get(0..2)?.parse().ok()?;
    let minutes: i64 = offset_text.get(2..4).unwrap_or("0").parse().ok()?;
    Some((time, sign * (hours * 3600 + minutes * 60) * 1000))
}

fn days_from_civil(year: i32, month: u32, day: u32) -> Option<i64> {
    if !(1..=12).contains(&month) || day == 0 || day > 31 {
        return None;
    }
    let y = if month <= 2 { year - 1 } else { year };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = (y - era * 400) as u32;
    let m = month.wrapping_add(9) % 12;
    let doy = (153 * m + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    Some((era as i64) * 146097 + doe as i64 - 719468)
}

fn format_millis(seconds: i64, nanos: u32) -> String {
    let (year, month, day, hour, minute, second) = civil_from_seconds(seconds);
    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}.{nanos:03}000Z", nanos = nanos / 1_000_000)
}

fn civil_from_seconds(seconds: i64) -> (i32, u32, u32, u32, u32, u32) {
    let days = seconds.div_euclid(86400);
    let tod = seconds.rem_euclid(86400) as u32;
    let hour = tod / 3600;
    let minute = (tod % 3600) / 60;
    let second = tod % 60;
    let (year, month, day) = civil_from_days(days);
    (year, month, day, hour, minute, second)
}

fn civil_from_days(days: i64) -> (i32, u32, u32) {
    let z = days + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = (z - era * 146097) as u32;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = (yoe as i64) + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if month <= 2 { y + 1 } else { y };
    (year as i32, month, day)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn unix_seconds_become_rfc3339() {
        let stamp = normalize_timestamp(&json!(1788845900)).unwrap();
        assert!(stamp.starts_with("2026-09-08T"));
        assert!(stamp.ends_with('Z'));
    }
}
