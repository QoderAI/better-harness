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
