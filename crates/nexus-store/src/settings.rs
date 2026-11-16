//! Settings: the 13 UI sections, one row per key, JSON scalars or arrays.
//!
//! `measured` on a row means the value came from the system rather than from the owner —
//! the same flag the UI uses to keep prototype values distinguishable from real ones.

use std::collections::BTreeMap;

use rusqlite::{params, OptionalExtension};
use serde_json::Value;

use crate::types::{SettingsSnapshot, SETTINGS_SECTIONS};
use crate::{Store, StoreError, StoreResult};

impl Store {
    pub fn settings(&self) -> StoreResult<SettingsSnapshot> {
        let mut sections: BTreeMap<String, BTreeMap<String, Value>> = SETTINGS_SECTIONS
            .iter()
            .map(|s| ((*s).to_owned(), BTreeMap::new()))
            .collect();
        let mut measured = BTreeMap::new();

        let mut stmt = self
            .conn
            .prepare("SELECT section, key, value, measured FROM settings ORDER BY section, key")?;
        let rows = stmt.query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, i64>(3)? != 0,
            ))
        })?;
        for row in rows {
            let (section, key, raw, is_measured) = row?;
            if !SETTINGS_SECTIONS.contains(&section.as_str()) {
                // A row from an older build no longer maps to a rendered section. Keep it in
                // the database, but do not invent a section the UI cannot show.
                continue;
            }
            let value: Value = serde_json::from_str(&raw).unwrap_or(Value::String(raw));
            sections.entry(section.clone()).or_default().insert(key.clone(), value);
            if is_measured {
                measured.insert(format!("{section}.{key}"), true);
            }
        }

        let contract_version = self
            .conn
            .query_row("SELECT contract_version FROM app_state WHERE id = 1", [], |r| r.get(0))
            .unwrap_or(1);

        Ok(SettingsSnapshot { contract_version, sections, measured })
    }

    pub fn patch_settings(
        &self,
        section: &str,
        values: &serde_json::Map<String, Value>,
        now: &str,
    ) -> StoreResult<SettingsSnapshot> {
        if !SETTINGS_SECTIONS.contains(&section) {
            return Err(StoreError::new(
                "validation.field",
                format!("section: “{section}” is not one of the 13 settings sections"),
            ));
        }
        for (key, value) in values {
            let (text, kind): (String, &str) = match value {
                Value::Bool(_) => (value.to_string(), "bool"),
                Value::Number(n) if n.is_i64() || n.is_u64() => (value.to_string(), "int"),
                Value::String(s) => (serde_json::to_string(s).unwrap_or_default(), "text"),
                _ => (value.to_string(), "json"),
            };
            self.conn.execute(
                "INSERT INTO settings (section, key, value, value_kind, measured, updated_at)
                 VALUES (?1, ?2, ?3, ?4, 0, ?5)
                 ON CONFLICT(section, key) DO UPDATE SET
                    value = excluded.value, value_kind = excluded.value_kind,
                    measured = 0, updated_at = excluded.updated_at",
                params![section, key, text, kind, now],
            )?;
        }
        self.settings()
    }

    pub fn setting(&self, section: &str, key: &str) -> StoreResult<Option<Value>> {
        let raw: Option<String> = self
            .conn
            .query_row(
                "SELECT value FROM settings WHERE section = ?1 AND key = ?2",
                params![section, key],
                |r| r.get(0),
            )
            .optional()?;
        Ok(raw.map(|s| serde_json::from_str(&s).unwrap_or(Value::String(s))))
    }

    /// Used by commands whose value is a system fact, not an owner preference.
    pub fn set_setting(
        &self,
        section: &str,
        key: &str,
        value: &Value,
        measured: bool,
        now: &str,
    ) -> StoreResult<()> {
        if !SETTINGS_SECTIONS.contains(&section) {
            return Err(StoreError::new(
                "validation.field",
                format!("section: “{section}” is not one of the 13 settings sections"),
            ));
        }
        let text = value.to_string();
        let kind = match value {
            Value::Bool(_) => "bool",
            Value::Number(n) if n.is_i64() || n.is_u64() => "int",
            Value::String(_) => "text",
            _ => "json",
        };
        self.conn.execute(
            "INSERT INTO settings (section, key, value, value_kind, measured, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(section, key) DO UPDATE SET
                value = excluded.value, value_kind = excluded.value_kind,
                measured = excluded.measured, updated_at = excluded.updated_at",
            params![section, key, text, kind, i64::from(measured), now],
        )?;
        Ok(())
    }
}
