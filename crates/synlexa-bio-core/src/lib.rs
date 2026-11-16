//! Synlexa Studio pure-Rust deterministic structural biology, peptide,
//! genomics/CRISPR, and small-molecule cheminformatics engine.
//!
//! Strictly Research-Use-Only (RUO).

pub mod chemistry;
pub mod genomics;
pub mod json;
pub mod peptide;
pub mod ramachandran;
pub mod sha256;
pub mod structure;
pub mod superpose;

use json::JsonValue;

pub const ENGINE_NAME: &str = "synlexa-bio-core";
pub const ENGINE_VERSION: &str = env!("CARGO_PKG_VERSION");

pub const RUO_NOTICE: &str = "Research-Use-Only (RUO). Outputs are computational estimates for exploratory research and must not be used for diagnostic, therapeutic, or clinical decisions.";

#[derive(Debug, Clone, PartialEq)]
pub struct CoreError {
    pub code: &'static str,
    pub message: String,
    pub details: JsonValue,
}

impl CoreError {
    pub fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            details: JsonValue::object(vec![]),
        }
    }

    pub fn with_details(
        code: &'static str,
        message: impl Into<String>,
        details: JsonValue,
    ) -> Self {
        Self {
            code,
            message: message.into(),
            details,
        }
    }

    pub fn to_json(&self) -> JsonValue {
        JsonValue::object(vec![
            ("code", JsonValue::String(self.code.to_string())),
            ("message", JsonValue::String(self.message.clone())),
            ("details", self.details.clone()),
        ])
    }
}

impl std::fmt::Display for CoreError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for CoreError {}
