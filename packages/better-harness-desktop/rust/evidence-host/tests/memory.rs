use harness_evidence_host::memory::{discover, read};
use serde_json::json;
use std::{
    fs,
    path::PathBuf,
    time::{SystemTime, UNIX_EPOCH},
};

struct Home(PathBuf);
impl Home {
    fn new() -> Self {
        let p = std::env::temp_dir().join(format!(
            "memory-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&p).unwrap();
        Self(fs::canonicalize(p).unwrap())
    }
    fn put(&self, path: &str, body: &str) -> PathBuf {
        let p = self.0.join(path);
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(&p, body).unwrap();
        p
    }
}
impl Drop for Home {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.0).ok();
    }
}

#[test]
fn inventory_is_metadata_only_and_snapshot_requires_explicit_scope() {
    let home = Home::new();
    home.put(".codex/memories/MEMORY.md", "private native body");
    home.put(".codex/memories/AGENTS.md", "instruction");
    home.put(".codex/memories/sessions/raw.md", "transcript");
    let options = json!({"home":home.0,"platform":"codex"});
    let inventory = discover(&options).unwrap();
    assert_eq!(inventory["documents"].as_array().unwrap().len(), 1);
    assert!(inventory["documents"][0].get("content").is_none());
    let mut request = json!({"home":home.0,"id":inventory["documents"][0]["id"],"scope":"user"});
    assert!(read(&request).is_err());
    request["includeMemories"] = json!(true);
    request["includeMemoryContent"] = json!(true);
    let snapshot = read(&request).unwrap();
    assert_eq!(snapshot["content"], "private native body");
    assert_eq!(snapshot["digest"].as_str().unwrap().len(), 64);
    assert_eq!(snapshot["provenance"]["host"], "codex");
    request["scope"] = json!("project");
    assert!(read(&request).is_err());
}

#[test]
fn configured_claude_root_and_qwen_surfaces_are_native_and_separate() {
    let home = Home::new();
    let root = home.0.join("custom");
    home.put("custom/MEMORY.md", "index");
    home.put("custom/topic.md", "topic");
    home.put(
        ".claude/settings.json",
        &json!({"autoMemoryDirectory":root}).to_string(),
    );
    let inventory = discover(&json!({"home":home.0,"platform":"claude"})).unwrap();
    assert_eq!(inventory["documents"].as_array().unwrap().len(), 2);
    assert_eq!(inventory["sources"][0]["root"]["source"], "config");
    home.put(
        ".qwen/projects/native-project/memory/pinned/design.md",
        "pinned",
    );
    home.put(".qwen/memories/personal.md", "user");
    home.put(".qwen/memories/QWEN.md", "instruction");
    let inventory = discover(&json!({"home":home.0,"platform":"qwen"})).unwrap();
    assert_eq!(inventory["documents"].as_array().unwrap().len(), 2);
    assert!(
        inventory["documents"]
            .as_array()
            .unwrap()
            .iter()
            .any(|d| d["role"] == "pinned")
    );
}

#[test]
fn unsupported_hosts_do_not_scan_and_oversized_files_cannot_be_read() {
    let home = Home::new();
    home.put(".cursor/memories/topic.md", "not a public contract");
    let unavailable = discover(&json!({"home":home.0,"platform":"cursor"})).unwrap();
    assert!(unavailable["documents"].as_array().unwrap().is_empty());
    assert_eq!(unavailable["sources"][0]["capabilities"]["read"], false);
    home.put(".codex/memories/MEMORY.md", &"x".repeat(1024 * 1024 + 1));
    let inventory = discover(&json!({"home":home.0,"platform":"codex"})).unwrap();
    assert!(read(&json!({"home":home.0,"id":inventory["documents"][0]["id"],"scope":"user","includeMemories":true,"includeMemoryContent":true})).unwrap_err().contains("too-large"));
}

#[test]
fn version_two_separates_materials_without_changing_legacy_scope_or_identity() {
    let home = Home::new();
    for path in [
        "memory_summary.md",
        "MEMORY.md",
        "rollout_summaries/history.md",
        "skills/example/SKILL.md",
        "extensions/ad_hoc/notes/example.md",
        "raw_memories.md",
    ] {
        home.put(&format!(".codex/memories/{path}"), "private body");
    }
    let old = discover(&json!({"home":home.0,"platform":"codex"})).unwrap();
    let new = discover(&json!({"home":home.0,"platform":"codex","schemaVersion":2})).unwrap();
    assert!(old.get("schemaVersion").is_none());
    assert_eq!(new["schemaVersion"], 2);
    for doc in new["documents"].as_array().unwrap() {
        let legacy = old["documents"]
            .as_array()
            .unwrap()
            .iter()
            .find(|d| d["id"] == doc["id"])
            .unwrap();
        assert_eq!(legacy["scope"], doc["scope"]);
        assert_eq!(doc["contentScope"]["kind"], "unknown");
        assert_eq!(doc["binding"]["kind"], "global");
        assert!(doc.get("content").is_none());
    }
    let mut roles: Vec<_> = new["documents"]
        .as_array()
        .unwrap()
        .iter()
        .map(|d| d["materialRole"].as_str().unwrap())
        .collect();
    roles.sort();
    assert_eq!(
        roles,
        vec![
            "episode",
            "extension",
            "registry",
            "skill",
            "summary",
            "working"
        ]
    );
    let snapshot = read(&json!({"home":home.0,"schemaVersion":2,"id":new["documents"][0]["id"],"scope":"user","includeMemories":true,"includeMemoryContent":true})).unwrap();
    assert_eq!(snapshot["document"]["id"], snapshot["documentId"]);
    assert_eq!(
        snapshot["source"]["library"]["id"],
        snapshot["document"]["libraryId"]
    );
}

#[test]
fn version_two_enumerates_qoder_projects_and_accounts_without_a_workspace() {
    let home = Home::new();
    home.put(
        ".qoder/memories/account-a/global/user_communication/style.md",
        "personal",
    );
    home.put(
        ".qoder/memories/account-a/projects/same-project/knowledge.md",
        "project A",
    );
    home.put(
        ".qoder/memories/account-b/projects/same-project/knowledge.md",
        "project B",
    );
    let old = discover(&json!({"home":home.0,"platform":"qoder"})).unwrap();
    assert_eq!(old["documents"].as_array().unwrap().len(), 1);
    let new = discover(&json!({"home":home.0,"platform":"qoder","schemaVersion":2})).unwrap();
    let docs = new["documents"].as_array().unwrap();
    assert_eq!(docs.len(), 3);
    let projects: Vec<_> = docs
        .iter()
        .filter(|d| d["contentScope"]["kind"] == "project")
        .collect();
    assert_eq!(projects.len(), 2);
    assert_ne!(projects[0]["libraryId"], projects[1]["libraryId"]);
    assert_ne!(projects[0]["sourceId"], projects[1]["sourceId"]);
    assert_eq!(projects[0]["binding"]["identity"], "same-project");
    assert_eq!(
        docs.iter()
            .filter(|d| d["contentScope"]["kind"] == "personal")
            .count(),
        1
    );
    for doc in projects {
        let snapshot = read(&json!({"home":home.0,"schemaVersion":2,"id":doc["id"],"scope":"project","includeMemories":true,"includeMemoryContent":true})).unwrap();
        assert_eq!(snapshot["documentId"], doc["id"]);
        assert_eq!(snapshot["document"]["binding"]["identity"], "same-project");
    }
}

#[test]
fn memory_schema_versions_are_explicit() {
    let home = Home::new();
    assert!(discover(&json!({"home":home.0,"schemaVersion":3})).is_err());
    assert!(discover(&json!({"home":home.0,"schemaVersion":"2"})).is_err());
}

#[cfg(unix)]
#[test]
fn symbolic_links_and_deep_trees_are_partial_without_reading_the_target() {
    let home = Home::new();
    let outside = home.put("outside.md", "outside");
    let deep = format!(".codex/memories/{}deep.md", "level/".repeat(10));
    home.put(&deep, "deep");
    std::os::unix::fs::symlink(outside, home.0.join(".codex/memories/link.md")).unwrap();
    let inventory = discover(&json!({"home":home.0,"platform":"codex"})).unwrap();
    assert!(inventory["documents"].as_array().unwrap().is_empty());
    assert_eq!(inventory["sources"][0]["coverage"]["state"], "partial");
}
