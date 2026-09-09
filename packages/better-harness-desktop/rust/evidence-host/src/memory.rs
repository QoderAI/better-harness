//! Native Memory only. No instructions, sessions, caches or body prefetch.
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fs,
    io::Read,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

const MAX_BYTES: u64 = 1024 * 1024;
const HOSTS: &[&str] = &[
    "claude",
    "codex",
    "qoder",
    "qwen",
    "cursor",
    "pi",
    "kimi",
    "copilot",
    "workbuddy",
    "grok",
    "auggie",
    "dsh",
];
type Result<T> = std::result::Result<T, String>;
fn text<'a>(v: &'a Value, k: &str) -> Option<&'a str> {
    v.get(k).and_then(Value::as_str)
}
fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn id(parts: &[&str]) -> String {
    hash(serde_json::to_string(parts).unwrap().as_bytes())
}
fn stamp(time: SystemTime) -> String {
    let millis = time
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    crate::time::normalize_timestamp(&json!(millis as u64)).unwrap_or_default()
}
fn absolute(path: &Path) -> Result<PathBuf> {
    std::path::absolute(path).map_err(|e| e.to_string())
}
fn safe(path: &Path) -> Result<PathBuf> {
    let path = absolute(path)?;
    let mut current = PathBuf::new();
    for part in path.components() {
        current.push(part);
        // A Windows drive/UNC prefix becomes a filesystem root only after RootDir.
        if matches!(part, std::path::Component::Prefix(_)) {
            continue;
        }
        let meta = fs::symlink_metadata(&current).map_err(|e| e.to_string())?;
        if meta.file_type().is_symlink() {
            return Err("symbolic-link-not-supported".into());
        }
        #[cfg(windows)]
        {
            use std::os::windows::fs::MetadataExt;
            if meta.file_attributes() & 0x400 != 0 {
                return Err("reparse-point-not-supported".into());
            }
        }
    }
    fs::canonicalize(path).map_err(|e| e.to_string())
}
fn same_file(a: &fs::Metadata, b: &fs::Metadata) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if a.dev() != b.dev() || a.ino() != b.ino() {
            return false;
        }
    }
    a.len() == b.len() && a.modified().ok() == b.modified().ok()
}
fn body(path: &Path) -> Result<(String, String)> {
    let canonical = safe(path)?;
    let mut options = fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        options.custom_flags(0x00200000); // FILE_FLAG_OPEN_REPARSE_POINT
    }
    let mut file = options.open(&canonical).map_err(|e| e.to_string())?;
    let before = file.metadata().map_err(|e| e.to_string())?;
    if !before.is_file() || before.len() > MAX_BYTES {
        return Err("memory-document-too-large-or-not-regular".into());
    }
    let current = fs::symlink_metadata(&canonical).map_err(|e| e.to_string())?;
    if current.file_type().is_symlink() || !same_file(&before, &current) {
        return Err("memory-document-changed".into());
    }
    let mut bytes = Vec::new();
    (&mut file)
        .take(MAX_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    let after = file.metadata().map_err(|e| e.to_string())?;
    let current = fs::symlink_metadata(&canonical).map_err(|e| e.to_string())?;
    if bytes.len() as u64 != before.len()
        || !same_file(&before, &after)
        || !same_file(&after, &current)
        || safe(path)? != canonical
    {
        return Err("memory-document-changed".into());
    }
    let revision = format!(
        "{}:{}",
        stamp(after.modified().map_err(|e| e.to_string())?),
        after.len()
    );
    Ok((
        String::from_utf8(bytes).map_err(|_| "memory-not-utf8")?,
        revision,
    ))
}
fn walk(root: &Path) -> Result<(Vec<PathBuf>, bool)> {
    safe(root)?;
    let mut files = Vec::new();
    let mut partial = false;
    let mut visited = 0;
    fn visit(
        dir: &Path,
        depth: usize,
        files: &mut Vec<PathBuf>,
        partial: &mut bool,
        visited: &mut usize,
    ) -> Result<()> {
        if depth > 8 {
            *partial = true;
            return Ok(());
        }
        safe(dir)?;
        let mut entries = Vec::new();
        for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
            if *visited >= 10000 {
                *partial = true;
                break;
            }
            *visited += 1;
            entries.push(entry.map_err(|e| e.to_string())?);
        }
        entries.sort_by_key(|e| e.file_name());
        for entry in entries {
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.starts_with('.')
                || ["node_modules", "sessions", "cache", "db"].contains(&name.as_str())
            {
                continue;
            }
            let kind = entry.file_type().map_err(|e| e.to_string())?;
            if kind.is_symlink() {
                *partial = true;
                continue;
            }
            if kind.is_dir() {
                visit(&entry.path(), depth + 1, files, partial, visited)?;
            } else if kind.is_file()
                && name.to_lowercase().ends_with(".md")
                && !["CLAUDE.MD", "AGENTS.MD", "QWEN.MD"].contains(&name.to_uppercase().as_str())
            {
                files.push(entry.path());
            }
        }
        Ok(())
    }
    visit(root, 0, &mut files, &mut partial, &mut visited)?;
    files.sort();
    Ok((files, partial))
}
fn project_slug(path: &Path) -> String {
    let value = path.to_string_lossy();
    let value = if cfg!(windows) {
        value.to_lowercase()
    } else {
        value.into_owned()
    };
    value
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect()
}
// Preserve the existing inventory's Qoder account/projects qualification.
fn qoder_slug(path: &Path) -> String {
    let value = path.to_string_lossy();
    let value = if value.as_bytes().get(1) == Some(&b':') {
        &value[2..]
    } else {
        &value
    };
    value
        .split(['/', '\\'])
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("-")
}
fn repository(workspace: &Path, common: bool) -> (PathBuf, &'static str) {
    let result = Command::new("git")
        .args(["-C"])
        .arg(workspace)
        .args([
            "rev-parse",
            if common {
                "--git-common-dir"
            } else {
                "--show-toplevel"
            },
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .and_then(|mut child| {
            let deadline = Instant::now() + Duration::from_secs(3);
            loop {
                if child.try_wait()?.is_some() {
                    return child.wait_with_output();
                }
                if Instant::now() >= deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(std::io::Error::new(
                        std::io::ErrorKind::TimedOut,
                        "git identity timed out",
                    ));
                }
                std::thread::sleep(Duration::from_millis(10));
            }
        });
    if let Ok(output) = result
        && output.status.success()
    {
        let value = String::from_utf8_lossy(&output.stdout).trim().to_owned();
        let path = PathBuf::from(value);
        let path = if path.is_absolute() {
            path
        } else {
            workspace.join(path)
        };
        let path = if common {
            path.parent().unwrap_or(workspace).to_owned()
        } else {
            path
        };
        return (path, "git-root");
    }
    (workspace.to_owned(), "working-directory")
}
struct Root {
    path: PathBuf,
    scope: &'static str,
    workspace: Option<Value>,
    origin: &'static str,
    files: Option<Vec<PathBuf>>,
    partial: bool,
}
fn root(path: PathBuf, scope: &'static str, workspace: Option<Value>) -> Root {
    Root {
        path,
        scope,
        workspace,
        origin: "host-discovery",
        files: None,
        partial: false,
    }
}
fn roots(host: &str, home: &Path, workspace: Option<&Path>, version2: bool) -> Result<Vec<Root>> {
    let mut result = Vec::new();
    if host == "codex" || host == "qoder" {
        let path = home.join("memories");
        let (files, partial) = walk(&path)?;
        if host == "qoder" && version2 {
            let mut groups: BTreeMap<PathBuf, Root> = BTreeMap::new();
            for file in files {
                let parts: Vec<_> = file.strip_prefix(&path).unwrap().components().collect();
                if parts.len() < 3 {
                    continue;
                }
                let account_root = path.join(parts[0]);
                let (group, scope, binding) = if parts[1].as_os_str() == "global" {
                    (account_root.join("global"), "user", None)
                } else if parts[1].as_os_str() == "projects" && parts.len() >= 4 {
                    let project = parts[2].as_os_str().to_string_lossy();
                    if workspace.is_some_and(|w| qoder_slug(w) != project) {
                        continue;
                    }
                    (
                        account_root.join("projects").join(parts[2]),
                        "project",
                        Some(json!({"identity":project,"qualification":"host-native"})),
                    )
                } else {
                    continue;
                };
                let item = groups.entry(group.clone()).or_insert_with(|| {
                    let mut item = root(group, scope, binding);
                    item.files = Some(Vec::new());
                    item.partial = partial;
                    item
                });
                item.files.as_mut().unwrap().push(file);
            }
            if groups.is_empty() {
                let mut item = root(path, "user", None);
                item.files = Some(Vec::new());
                item.partial = partial;
                return Ok(vec![item]);
            }
            return Ok(groups.into_values().collect());
        }
        for scope in ["user", "project"] {
            let chosen: Vec<_> = files
                .iter()
                .filter(|file| {
                    if host == "codex" {
                        return scope == "user";
                    }
                    let parts: Vec<_> = file
                        .strip_prefix(&path)
                        .unwrap()
                        .components()
                        .map(|c| c.as_os_str().to_string_lossy().into_owned())
                        .collect();
                    if scope == "user" {
                        parts.get(1).is_some_and(|p| p == "global")
                    } else {
                        workspace.is_some_and(|w| {
                            parts.get(1).is_some_and(|p| p == "projects")
                                && parts.get(2) == Some(&qoder_slug(w))
                        })
                    }
                })
                .cloned()
                .collect();
            if chosen.is_empty() && scope == "project" {
                continue;
            }
            let mut item = root(
                path.clone(),
                scope,
                if scope == "project" {
                    workspace.map(|w| json!({"identity":w,"qualification":"host-native"}))
                } else {
                    None
                },
            );
            item.files = Some(chosen);
            item.partial = partial;
            result.push(item);
        }
        return Ok(result);
    }
    let repo = workspace.map(|w| repository(w, host == "claude"));
    if host == "claude" {
        let settings = home.join("settings.json");
        match fs::symlink_metadata(&settings) {
            Ok(_) => {
                let settings: Value =
                    serde_json::from_str(&body(&settings)?.0).map_err(|e| e.to_string())?;
                if let Some(value) = settings.get("autoMemoryDirectory") {
                    let path =
                        PathBuf::from(value.as_str().ok_or("invalid-auto-memory-directory")?);
                    if !path.is_absolute() {
                        return Err("invalid-auto-memory-directory".into());
                    }
                    let mut item = root(
                        path,
                        "project",
                        repo.as_ref()
                            .map(|(p, _)| json!({"identity":p,"qualification":"host-native"})),
                    );
                    item.origin = "config";
                    return Ok(vec![item]);
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => (),
            Err(e) => return Err(e.to_string()),
        }
    }
    if let Some(workspace) = workspace {
        let (identity, qualification) = if host == "claude" {
            repo.clone().unwrap()
        } else {
            (workspace.to_owned(), "working-directory")
        };
        result.push(root(
            home.join("projects")
                .join(project_slug(&identity))
                .join("memory"),
            "project",
            Some(json!({"identity":identity,"qualification":qualification})),
        ));
    } else {
        let projects = home.join("projects");
        if projects.exists() {
            safe(&projects)?;
            let entries: Vec<_> = fs::read_dir(projects)
                .map_err(|e| e.to_string())?
                .take(1001)
                .collect();
            let partial = entries.len() > 1000;
            for entry in entries.into_iter().take(1000) {
                let entry = entry.map_err(|e| e.to_string())?;
                if entry.file_type().map_err(|e| e.to_string())?.is_dir() {
                    let mut item = root(
                        entry.path().join("memory"),
                        "project",
                        Some(
                            json!({"identity":entry.file_name().to_string_lossy(),"qualification":"host-native"}),
                        ),
                    );
                    item.partial = partial;
                    result.push(item);
                }
            }
        }
    }
    if host == "qwen" {
        result.push(root(home.join("memories"), "user", None));
        if let Some((path, qualification)) = repo {
            result.push(root(
                path.join(".qwen").join("team-memory"),
                "team",
                Some(json!({"identity":path,"qualification":qualification})),
            ));
        }
    }
    Ok(result)
}

pub fn discover(options: &Value) -> Result<Value> {
    let version2 = memory_version2(options)?;
    let scope = text(options, "scope");
    if scope.is_some_and(|s| !["user", "project", "team", "agent"].contains(&s)) {
        return Err("Invalid memory scope".into());
    }
    let home = absolute(
        &text(options, "home")
            .map(PathBuf::from)
            .unwrap_or_else(crate::paths::home_dir),
    )?;
    let workspace = text(options, "workspace")
        .map(|w| absolute(Path::new(w)))
        .transpose()?;
    let hosts = match text(options, "platform") {
        None | Some("all") => HOSTS.to_vec(),
        Some(host) if HOSTS.contains(&host) => vec![host],
        _ => return Err("Unknown memory platform".into()),
    };
    let mut sources = Vec::new();
    let mut documents = Vec::new();
    let observed = stamp(SystemTime::now());
    for host in hosts {
        let support = match host {
            "claude" | "codex" | "qwen" => "filesystem-native",
            "qoder" => "host-observed",
            _ => "unavailable",
        };
        let unavailable = |reason: &str| json!({"sourceId":id(&[host, reason]),"host":host,"support":support,"scope":"user","capabilities":{"enumerate":false,"read":false,"metadata":false,"write":false},"coverage":{"state":"unavailable","reason":reason}});
        if support == "unavailable" {
            sources.push(unavailable("native-memory-storage-contract-unavailable"));
            continue;
        }
        let env = if text(options, "home").is_none() && ["codex", "qwen"].contains(&host) {
            std::env::var(format!("{}_HOME", host.to_uppercase())).ok()
        } else {
            None
        };
        let host_home = absolute(
            &text(options, &format!("{host}Home"))
                .map(PathBuf::from)
                .or_else(|| env.map(PathBuf::from))
                .unwrap_or_else(|| home.join(format!(".{host}"))),
        )?;
        let roots = match roots(host, &host_home, workspace.as_deref(), version2) {
            Ok(r) => r,
            Err(_) => {
                sources.push(unavailable("memory-discovery-failed"));
                continue;
            }
        };
        if roots.is_empty() {
            sources.push(unavailable("memory-root-not-found"));
        }
        for item in roots {
            if scope.is_some_and(|s| s != item.scope) {
                continue;
            }
            let source_id = id(&[host, &item.path.to_string_lossy(), item.scope]);
            let mut source = json!({"sourceId":source_id,"host":host,"support":support,"scope":item.scope,"root":{"displayPath":item.path,"source":item.origin},"capabilities":{"enumerate":true,"read":true,"metadata":true,"write":false},"coverage":{"state":"available"}});
            if let Some(workspace) = item.workspace {
                source["workspace"] = workspace;
            }
            if version2 {
                let mut library = json!({"id":id(&[host,&host_home.to_string_lossy()]),"host":host,"root":host_home.join("memories")});
                if host == "qoder" {
                    if let Ok(relative) = item.path.strip_prefix(host_home.join("memories")) {
                        if let Some(account) = relative.components().next() {
                            let account = account.as_os_str().to_string_lossy();
                            library["accountNamespace"] = json!(account);
                            library["id"] =
                                json!(id(&[host, &host_home.to_string_lossy(), &account]));
                            library["root"] =
                                json!(host_home.join("memories").join(account.as_ref()));
                        }
                    }
                } else if host != "codex" {
                    library["root"] = source["root"]["displayPath"].clone();
                    library["id"] = json!(id(&[host, &item.path.to_string_lossy()]));
                }
                source["library"] = library;
                source["binding"] = match source.get("workspace") {
                    Some(workspace) => {
                        json!({"kind":"project","identity":workspace["identity"],"qualification":workspace["qualification"]})
                    }
                    None if item.scope == "user" => json!({"kind":"global"}),
                    _ => json!({"kind":"unknown"}),
                };
            }
            let walked = item
                .files
                .map(|f| Ok((f, item.partial)))
                .unwrap_or_else(|| walk(&item.path));
            match walked {
                Err(_) => {
                    source["coverage"] =
                        json!({"state":"unavailable","reason":"memory-root-unreadable"});
                    source["capabilities"] =
                        json!({"enumerate":false,"read":false,"metadata":false,"write":false});
                }
                Ok((files, partial)) => {
                    if partial || item.partial {
                        source["coverage"] = json!({"state":"partial","reason":"bounded-scan-or-symbolic-link-skipped"});
                    }
                    for file in files {
                        let Ok(meta) = fs::symlink_metadata(&file) else {
                            continue;
                        };
                        if !meta.is_file() {
                            continue;
                        }
                        let relative = file.strip_prefix(&item.path).map_err(|e| e.to_string())?;
                        let name = file.file_name().unwrap().to_string_lossy();
                        let role = if relative.components().any(|c| c.as_os_str() == "pinned") {
                            "pinned"
                        } else if host == "codex" {
                            if name == "MEMORY.md" || name == "memory_summary.md" {
                                "consolidated"
                            } else {
                                "generated"
                            }
                        } else if name == "MEMORY.md" {
                            "index"
                        } else {
                            "topic"
                        };
                        let mut document = json!({"id":id(&[&source_id,&relative.to_string_lossy()]),"sourceId":source_id,"nativeIdentity":{"path":file},"role":role,"scope":item.scope,"metadata":{"title":relative,"updatedAt":stamp(meta.modified().map_err(|e| e.to_string())?),"byteSize":meta.len()},"provenance":{"host":host,"sourceKind":"native-memory","observedAt":observed}});
                        if version2 {
                            // This is a portable display path, separate from nativeIdentity.path.
                            document["metadata"]["title"] = json!(relative.components().map(|c| c.as_os_str().to_string_lossy().into_owned()).collect::<Vec<_>>().join("/"));
                            document["materialRole"] = json!(material_role(host, relative));
                            document["binding"] = source["binding"].clone();
                            document["libraryId"] = source["library"]["id"].clone();
                            let personal = host == "qoder"
                                && item.scope == "user"
                                && relative.components().next().is_some_and(|c| {
                                    ["user_behavior", "user_communication", "user_info"]
                                        .iter()
                                        .any(|part| c.as_os_str() == *part)
                                });
                            document["contentScope"] = if source["binding"]["kind"] == "project" {
                                json!({"kind":"project","projectIdentity":source["binding"]["identity"],"evidence":"native-binding"})
                            } else if personal {
                                json!({"kind":"personal","evidence":"native-layout"})
                            } else {
                                json!({"kind":"unknown","evidence":"unparsed"})
                            };
                        }
                        documents.push(document);
                    }
                }
            }
            sources.push(source);
        }
    }
    let mut result = json!({"sources":sources,"documents":documents});
    if version2 {
        result["schemaVersion"] = json!(2);
    }
    Ok(result)
}

fn memory_version2(options: &Value) -> Result<bool> {
    match options.get("schemaVersion") {
        None => Ok(false),
        Some(v) if v == 1 => Ok(false),
        Some(v) if v == 2 => Ok(true),
        _ => Err("Unsupported Memory schema version".into()),
    }
}

fn material_role(host: &str, relative: &Path) -> &'static str {
    let name = relative.file_name().unwrap_or_default();
    if host == "codex" {
        let first = relative.components().next().map(|c| c.as_os_str());
        if first.is_some_and(|c| c == "rollout_summaries") {
            return "episode";
        }
        if first.is_some_and(|c| c == "skills") {
            return "skill";
        }
        if first.is_some_and(|c| c == "extensions") {
            return "extension";
        }
        if relative.components().count() == 1 {
            if name == "memory_summary.md" {
                return "summary";
            }
            if name == "MEMORY.md" {
                return "registry";
            }
            if name == "raw_memories.md" {
                return "working";
            }
        }
        return "unknown";
    }
    if name == "MEMORY.md" {
        "registry"
    } else {
        "knowledge"
    }
}

pub fn read(options: &Value) -> Result<Value> {
    if options["includeMemories"] != true
        || options["includeMemoryContent"] != true
        || text(options, "id").is_none()
        || text(options, "scope").is_none()
    {
        return Err("Explicit document, scope, include-memories and include-memory-content authorization required".into());
    }
    let inventory = discover(options)?;
    let document = inventory["documents"]
        .as_array()
        .unwrap()
        .iter()
        .find(|d| d["id"] == options["id"] && d["scope"] == options["scope"])
        .ok_or("Memory document unavailable in authorized scope")?;
    let source = inventory["sources"]
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["sourceId"] == document["sourceId"])
        .unwrap();
    if source["capabilities"]["read"] != true {
        return Err("Memory source is not readable".into());
    }
    let file = Path::new(document["nativeIdentity"]["path"].as_str().unwrap());
    if !safe(file)?.starts_with(safe(Path::new(
        source["root"]["displayPath"].as_str().unwrap(),
    ))?) {
        return Err("Memory document outside source".into());
    }
    let (content, revision) = body(file)?;
    let mut snapshot = json!({"documentId":document["id"],"digest":hash(content.as_bytes()),"content":content,"capturedAt":stamp(SystemTime::now()),"sourceRevision":revision,"scope":document["scope"],"workspace":source.get("workspace").cloned().unwrap_or_else(|| json!({"identity":source["sourceId"],"qualification":"unknown"})),"provenance":{"host":source["host"],"sourceId":source["sourceId"],"nativeIdentity":file}});
    if memory_version2(options)? {
        snapshot["schemaVersion"] = json!(2);
        snapshot["document"] = document.clone();
        snapshot["source"] = source.clone();
    }
    Ok(snapshot)
}
