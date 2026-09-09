use super::{Span, Turn};
use serde::Serialize;
use std::collections::{BTreeMap, HashMap, HashSet};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Breakdown {
    pub activity_total_ms: i64,
    pub total_ms: i64,
    pub segments: Vec<Segment>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Part {
    pub label: String,
    pub duration_ms: i64,
    pub cumulative_ms: i64,
    pub count: usize,
    pub calls: Vec<Call>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Call {
    pub span_id: String,
    pub label: String,
    pub duration_ms: i64,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Segment {
    pub activity_ms: i64,
    pub cumulative_ms: i64,
    pub call_parts: Vec<Part>,
    pub parts: Vec<Part>,
    pub kind: &'static str,
    pub duration_ms: i64,
}
const KINDS: [&str; 7] = [
    "model", "tool", "hook", "wait", "subagent", "parallel", "unknown",
];

/// Partition observed intervals. A containing Agent owns its child work; tool
/// phases override their own lifecycle. Different concurrent activities have
/// an explicit parallel segment rather than an arbitrary category priority.
pub fn breakdown(spans: &[Span], turns: &[Turn]) -> Breakdown {
    let by_id: HashMap<_, _> = spans.iter().map(|s| (s.id.as_str(), s)).collect();
    let mut edges: Vec<(i64, String, usize, usize, String, i32)> = Vec::new();
    for turn in turns {
        if let Some(end) = turn.end_ms.filter(|end| *end > turn.start_ms) {
            edges.push((turn.start_ms, String::new(), 0, 6, String::new(), 1));
            edges.push((end, String::new(), 0, 6, String::new(), -1));
        }
    }
    for span in spans {
        let Some((start, end)) = span.start_ms.zip(span.end_ms).filter(|(a, b)| b > a) else {
            continue;
        };
        let (kind, rank) = match span.kind.as_str() {
            "model" => (0, 1),
            "tool" => (1, 1),
            "shell" | "tool-execution" => (1, 3),
            "hook" => (2, 4),
            "permission" | "policy" => (3, 5),
            "dispatch" | "preparation" => (3, 3),
            "subagent" | "subagent-turn" => (4, 1),
            _ => continue,
        };
        let mut owner = span.id.as_str();
        let mut cursor = span;
        let mut nested_agent = false;
        let mut seen = HashSet::new();
        while let Some(parent) = cursor
            .parent_id
            .as_deref()
            .and_then(|id| by_id.get(id))
            .copied()
        {
            if !seen.insert(parent.id.as_str()) {
                break;
            }
            if parent.kind == "subagent"
                && parent
                    .start_ms
                    .zip(parent.end_ms)
                    .is_some_and(|(a, b)| a <= start && b >= end)
            {
                nested_agent = true;
                break;
            }
            if parent.kind == "tool" {
                owner = &parent.id;
            }
            cursor = parent;
        }
        if nested_agent {
            continue;
        }
        edges.push((start, owner.into(), rank, kind, span.label.clone(), 1));
        edges.push((end, owner.into(), rank, kind, span.label.clone(), -1));
    }
    edges.sort_unstable();
    let mut active: HashMap<String, BTreeMap<(usize, usize, String), i32>> = HashMap::new();
    let mut domain = 0;
    let mut totals = [0i64; 7];
    let mut activity = [0i64; 7];
    let mut parts: HashMap<(usize, String), i64> = HashMap::new();
    let mut previous = edges.first().map_or(0, |edge| edge.0);
    for (at, owner, rank, kind, label, delta) in edges {
        if at > previous {
            let selected: Vec<_> = active
                .values()
                .flat_map(|entries| {
                    let rank = entries.last_key_value().map(|((rank, _, _), _)| *rank);
                    entries
                        .keys()
                        .filter(move |(r, _, _)| Some(*r) == rank)
                        .map(|(_, kind, label)| (*kind, label.clone()))
                })
                .collect();
            let categories: HashSet<_> = selected.iter().map(|(kind, _)| *kind).collect();
            if domain > 0 || !categories.is_empty() {
                let category = if categories.len() > 1 {
                    5
                } else {
                    categories.iter().copied().next().unwrap_or(6)
                };
                totals[category] += at - previous;
                if categories.is_empty() {
                    activity[6] += at - previous;
                } else {
                    for kind in &categories {
                        activity[*kind] += at - previous;
                    }
                }
                let labels: HashSet<_> = selected.iter().map(|(_, label)| label.clone()).collect();
                let label = if category == 5 {
                    let mut kinds: Vec<_> = categories.iter().map(|k| KINDS[*k]).collect();
                    kinds.sort();
                    kinds.join(" + ")
                } else if labels.len() == 1 {
                    labels.into_iter().next().unwrap()
                } else if labels.is_empty() {
                    "unknown".into()
                } else {
                    "concurrent-calls".into()
                };
                *parts.entry((category, label)).or_default() += at - previous;
            }
        }
        if owner.is_empty() {
            domain += delta;
        } else {
            let entries = active.entry(owner.clone()).or_default();
            let value = entries.entry((rank, kind, label.clone())).or_default();
            *value += delta;
            if *value == 0 {
                entries.remove(&(rank, kind, label));
            }
            if entries.is_empty() {
                active.remove(&owner);
            }
        }
        previous = at;
    }
    Breakdown {
        activity_total_ms: activity.iter().sum(),
        total_ms: totals.iter().sum(),
        segments: KINDS
            .into_iter()
            .zip(totals)
            .enumerate()
            .map(|(index, (kind, duration_ms))| {
                let mut rows: Vec<_> = parts
                    .iter()
                    .filter(|((k, _), _)| *k == index)
                    .map(|((_, label), duration)| {
                        let kinds: &[&str] = match index {
                            0 => &["model"],
                            1 => &["tool"],
                            2 => &["hook"],
                            3 => &["dispatch", "preparation", "permission", "policy"],
                            4 => &["subagent"],
                            _ => &[],
                        };
                        let mut calls: Vec<_> = spans
                            .iter()
                            .filter(|s| {
                                kinds.contains(&s.kind.as_str())
                                    && (s.label == *label || label == "concurrent-calls")
                            })
                            .filter_map(|s| {
                                s.duration_ms.map(|duration_ms| Call {
                                    span_id: s.id.clone(),
                                    label: s.label.clone(),
                                    duration_ms,
                                })
                            })
                            .collect();
                        calls.sort_by_key(|c| std::cmp::Reverse(c.duration_ms));
                        let cumulative_ms = calls.iter().map(|c| c.duration_ms).sum();
                        let count = calls.len();
                        calls.truncate(80);
                        Part {
                            label: label.clone(),
                            duration_ms: *duration,
                            cumulative_ms,
                            count,
                            calls,
                        }
                    })
                    .collect();
                rows.sort_by_key(|p| std::cmp::Reverse(p.duration_ms));
                let kinds: &[&str] = match index {
                    0 => &["model"],
                    1 => &["tool"],
                    2 => &["hook"],
                    3 => &["dispatch", "preparation", "permission", "policy"],
                    4 => &["subagent"],
                    _ => &[],
                };
                let mut groups: BTreeMap<String, Vec<Call>> = BTreeMap::new();
                for span in spans.iter().filter(|s| kinds.contains(&s.kind.as_str())) {
                    if let Some(duration_ms) = span.duration_ms {
                        groups.entry(span.label.clone()).or_default().push(Call {
                            span_id: span.id.clone(),
                            label: span.label.clone(),
                            duration_ms,
                        });
                    }
                }
                let mut call_parts: Vec<_> = groups
                    .into_iter()
                    .map(|(label, mut calls)| {
                        let cumulative_ms = calls.iter().map(|c| c.duration_ms).sum();
                        let count = calls.len();
                        calls.sort_by_key(|c| std::cmp::Reverse(c.duration_ms));
                        calls.truncate(80);
                        Part {
                            label,
                            duration_ms: cumulative_ms,
                            cumulative_ms,
                            count,
                            calls,
                        }
                    })
                    .collect();
                call_parts.sort_by_key(|p| std::cmp::Reverse(p.duration_ms));
                Segment {
                    activity_ms: activity[index],
                    cumulative_ms: call_parts.iter().map(|p| p.cumulative_ms).sum(),
                    call_parts,
                    kind,
                    duration_ms,
                    parts: rows,
                }
            })
            .collect(),
    }
}
