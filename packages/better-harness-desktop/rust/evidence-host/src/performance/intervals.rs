pub type Interval = (i64, i64);

pub fn union(mut spans: Vec<Interval>) -> Vec<Interval> {
    spans.retain(|(a, b)| b >= a);
    spans.sort_unstable();
    let mut output: Vec<Interval> = Vec::new();
    for (start, end) in spans {
        if let Some(last) = output.last_mut() {
            if start <= last.1 {
                last.1 = last.1.max(end);
                continue;
            }
        }
        output.push((start, end));
    }
    output
}

pub fn length(spans: Vec<Interval>) -> i64 {
    union(spans).iter().map(|(a, b)| b - a).sum()
}

/// Sweep two unioned lists; no per-millisecond expansion or quadratic event scan.
pub fn intersection(left: Vec<Interval>, right: Vec<Interval>) -> i64 {
    let a = union(left);
    let b = union(right);
    let (mut i, mut j, mut total) = (0, 0, 0);
    while i < a.len() && j < b.len() {
        total += (a[i].1.min(b[j].1) - a[i].0.max(b[j].0)).max(0);
        if a[i].1 <= b[j].1 {
            i += 1;
        } else {
            j += 1;
        }
    }
    total
}

pub fn peak(spans: Vec<Interval>) -> usize {
    let mut edges = Vec::new();
    for (a, b) in spans {
        if b > a {
            edges.push((a, 1i64));
            edges.push((b, -1));
        }
    }
    edges.sort_unstable(); // ending intervals leave before starts at the same time
    let (mut current, mut peak) = (0, 0);
    for (_, delta) in edges {
        current += delta;
        peak = peak.max(current);
    }
    peak as usize
}
