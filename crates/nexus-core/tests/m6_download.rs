//! M6: the catalogue the first-run screen reads and the download preconditions that must
//! refuse *before* a process is spawned or a byte leaves the machine.
//!
//! The download itself is proven live in `tools/m6-gate.mjs`; these tests cover the
//! decisions that must be wrong-proof without a network.

use std::path::PathBuf;

use nexus_core::dispatch::{Core, NullSink};
use nexus_core::system::memory_status;
use serde_json::json;

fn scratch(tag: &str) -> (Core, PathBuf) {
    let dir = std::env::temp_dir().join(format!("nexus-m6-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let core = Core::new(&dir, dir.join("engine"));
    (core, dir)
}

#[test]
fn catalog_lists_both_choices_and_recommends_by_this_machines_ram() {
    let (mut core, _dir) = scratch("catalog");
    let value = core.execute("model.catalog", &json!({}), &mut NullSink).unwrap();

    let models = value["models"].as_array().expect("models array");
    assert_eq!(models.len(), 2);
    let ids: Vec<&str> = models.iter().filter_map(|m| m["id"].as_str()).collect();
    assert!(ids.contains(&"llama-3.2-1b-instruct-q4-k-m"));
    assert!(ids.contains(&"llama-3.2-3b-instruct-q4-k-m"));

    let total = memory_status().expect("this Windows reports RAM").total_mb;
    let expected = nexus_model::recommend(total).id;
    assert_eq!(value["recommended"], expected);
    assert_eq!(value["totalRamMb"], total);
    assert!(value["freeDiskBytes"].as_u64().unwrap() > 0);
}

#[test]
fn download_status_starts_idle() {
    let (mut core, _dir) = scratch("idle");
    let value = core
        .execute("model.downloadStatus", &json!({}), &mut NullSink)
        .unwrap();
    assert_eq!(value["state"], "idle");
}

#[test]
fn download_refuses_an_unknown_id_without_spawning_anything() {
    let (mut core, _dir) = scratch("unknown");
    let err = core
        .execute("model.download", &json!({ "id": "llama-9.9-imaginary" }), &mut NullSink)
        .unwrap_err();
    assert_eq!(err.code, nexus_core::error::ErrorCode::ValidationField);
    let status = core
        .execute("model.downloadStatus", &json!({}), &mut NullSink)
        .unwrap();
    assert_eq!(status["state"], "idle");
}

#[test]
fn download_refuses_a_model_that_is_already_in_the_folder() {
    let (mut core, dir) = scratch("installed");
    let entry = nexus_model::catalog()
        .iter()
        .find(|e| e.id == "llama-3.2-1b-instruct-q4-k-m")
        .expect("1B entry");
    std::fs::write(dir.join(entry.file_name), b"already here").unwrap();

    let err = core
        .execute("model.download", &json!({ "id": entry.id }), &mut NullSink)
        .unwrap_err();
    assert_eq!(err.code, nexus_core::error::ErrorCode::ValidationField);
    assert!(err.message.contains("already"), "{}", err.message);
}

/// A packaged install has no models folder yet: `%LOCALAPPDATA%\NexusAI\models` is created
/// on first use. The free-space probe must measure the volume, not fail on the path, or
/// every fresh machine is told it has zero bytes free and can never download.
#[test]
fn catalog_measures_a_models_folder_that_does_not_exist_yet() {
    let root = std::env::temp_dir().join(format!("nexus-m6-fresh-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    let models = root.join("NexusAI").join("models");
    assert!(!models.exists());
    let mut core = Core::new(&models, root.join("engine"));

    let value = core.execute("model.catalog", &json!({}), &mut NullSink).unwrap();
    assert!(
        value["freeDiskBytes"].as_u64().unwrap() > 0,
        "a fresh install reports free disk: {value}"
    );
    let one = value["models"]
        .as_array()
        .unwrap()
        .iter()
        .find(|m| m["id"] == "llama-3.2-1b-instruct-q4-k-m")
        .expect("1B row");
    assert_eq!(one["diskOk"], true, "{value}");
    assert_eq!(one["installed"], false, "{value}");

    let _ = std::fs::remove_dir_all(&root);
}
