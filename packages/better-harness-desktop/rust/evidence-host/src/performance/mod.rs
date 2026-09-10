//! Read-only retained-session timing. This capability owns pairing and interval
//! accounting; the Node host and browser only project its typed results.
mod analyze;
mod breakdown;
mod intervals;
mod model;
mod native;
mod reader;
mod source;

pub use model::*;
use serde_json::Value;

pub fn analyze_params(value: &Value) -> Result<Value, String> {
    let params: PerformanceParams = serde_json::from_value(value.clone())
        .map_err(|_| "invalid-performance-parameters".to_string())?;
    reader::read(params)
}

#[cfg(test)]
mod tests;
