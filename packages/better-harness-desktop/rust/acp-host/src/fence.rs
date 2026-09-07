//! Path containment for the `fs/*` client capability.
//!
//! # Why this is not Zed's check
//!
//! Zed resolves an agent's path by walking its worktrees and taking the first
//! whose `abs_path` is a lexical prefix of the request. That is a *lookup* —
//! "which worktree owns this file" — and it is load-bearing for Zed only because
//! the editor supplies the real trust model around it. As a containment check it
//! has three holes: no `canonicalize`, so `..` is never normalized; no symlink
//! resolution, so a link inside a root reaches anywhere; and a purely lexical
//! comparison.
//!
//! This host has no editor and no user staring at an open buffer, so containment
//! has to hold on its own. Every decision here is made against the *canonical*
//! path, which collapses `.`, `..`, and symlinks before the comparison happens.
//!
//! # Reporting
//!
//! Rejections never name the path. An agent that probes the filesystem should
//! not learn the host's directory layout from the error text, and the run trace
//! that carries these messages must not become a place absolute paths leak.

use std::path::{Component, Path, PathBuf};

/// A rejected filesystem request.
///
/// Variants carry no path data by construction, so no caller can accidentally
/// format one into a trace.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FenceError {
    /// No roots were granted, so no path can be reached.
    NoRootsGranted,
    /// The request was not absolute, so it has no single meaning to check.
    NotAbsolute,
    /// The path, or the parent it would be created in, does not exist.
    NotFound,
    /// The canonical path lies outside every granted root.
    OutsideRoots,
    /// A write target has no parent directory, so it names a filesystem root.
    NoParentDirectory,
    /// A write target's final component is not a plain name.
    NotAPlainName,
}

impl FenceError {
    /// The stable error code Node and the run trace match on.
    pub fn code(&self) -> &'static str {
        match self {
            Self::NoRootsGranted => "fs/no-roots-granted",
            Self::NotAbsolute => "fs/not-absolute",
            Self::NotFound => "fs/not-found",
            Self::OutsideRoots => "fs/outside-roots",
            Self::NoParentDirectory => "fs/no-parent-directory",
            Self::NotAPlainName => "fs/not-a-plain-name",
        }
    }
}

impl std::fmt::Display for FenceError {
    /// Deliberately path-free. See the module note on reporting.
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let message = match self {
            Self::NoRootsGranted => {
                "this session granted no filesystem roots, so no path can be read or written"
            }
            Self::NotAbsolute => "the requested path must be absolute",
            Self::NotFound => "the requested path does not exist",
            Self::OutsideRoots => {
                "the requested path resolves outside the roots this session granted"
            }
            Self::NoParentDirectory => "the requested path has no parent directory",
            Self::NotAPlainName => "the requested path must end in a plain file or directory name",
        };
        formatter.write_str(message)
    }
}

impl std::error::Error for FenceError {}

/// The set of roots an agent may reach, held in canonical form.
#[derive(Debug, Clone, Default)]
pub struct Fence {
    roots: Vec<PathBuf>,
}

impl Fence {
    /// Canonicalize the granted roots.
    ///
    /// A root that cannot be canonicalized is dropped rather than trusted: an
    /// unresolvable root would otherwise be compared lexically, which is the
    /// exact weakness this type exists to remove. An empty result denies
    /// everything, so dropping a root can only ever narrow access.
    pub fn new<I, P>(roots: I) -> Self
    where
        I: IntoIterator<Item = P>,
        P: AsRef<Path>,
    {
        let mut canonical = Vec::new();
        for root in roots {
            if let Ok(resolved) = std::fs::canonicalize(root.as_ref())
                && !canonical.contains(&resolved)
            {
                canonical.push(resolved);
            }
        }
        Self { roots: canonical }
    }

    /// Whether any root was granted.
    pub fn is_empty(&self) -> bool {
        self.roots.is_empty()
    }

    /// The canonical roots, for receipts.
    pub fn roots(&self) -> &[PathBuf] {
        &self.roots
    }

    /// Resolve a path the agent wants to read.
    ///
    /// The target must already exist, so it is canonicalized directly. This
    /// collapses symlinks, meaning a link that lives inside a root but points
    /// outside it is rejected on the strength of where it actually leads.
    pub fn resolve_read(&self, requested: &Path) -> Result<PathBuf, FenceError> {
        self.guard(requested)?;
        let canonical = std::fs::canonicalize(requested).map_err(|_| FenceError::NotFound)?;
        self.contain(canonical)
    }

    /// Resolve a path the agent wants to write.
    ///
    /// A write target may not exist yet, so there are two cases and both are
    /// checked against canonical paths:
    ///
    /// - The target exists: canonicalize it. Following the link matters here,
    ///   because writing through an escaping symlink would otherwise land
    ///   outside the fence while the lexical path looked contained.
    /// - The target does not exist: canonicalize the parent directory and rejoin
    ///   the final component. The parent must exist; this host creates files, not
    ///   directory trees, so a missing parent is a rejection rather than an
    ///   invitation to `create_dir_all` somewhere unverified.
    pub fn resolve_write(&self, requested: &Path) -> Result<PathBuf, FenceError> {
        self.guard(requested)?;
        if requested.exists() {
            let canonical = std::fs::canonicalize(requested).map_err(|_| FenceError::NotFound)?;
            return self.contain(canonical);
        }
        let parent = requested.parent().ok_or(FenceError::NoParentDirectory)?;
        let name = match requested.components().next_back() {
            Some(Component::Normal(name)) => name,
            _ => return Err(FenceError::NotAPlainName),
        };
        let canonical_parent = std::fs::canonicalize(parent).map_err(|_| FenceError::NotFound)?;
        self.contain(canonical_parent.join(name))
    }

    /// Checks that hold before any filesystem access, so a hostile path cannot
    /// even provoke a `stat` outside the fence.
    fn guard(&self, requested: &Path) -> Result<(), FenceError> {
        if self.roots.is_empty() {
            return Err(FenceError::NoRootsGranted);
        }
        if !requested.is_absolute() {
            return Err(FenceError::NotAbsolute);
        }
        Ok(())
    }

    /// Component-wise containment against the canonical roots.
    ///
    /// `Path::starts_with` compares whole components, so a root of `/tmp/work`
    /// does not admit `/tmp/work-elsewhere` the way a string prefix would.
    fn contain(&self, canonical: PathBuf) -> Result<PathBuf, FenceError> {
        if self.roots.iter().any(|root| canonical.starts_with(root)) {
            Ok(canonical)
        } else {
            Err(FenceError::OutsideRoots)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    struct TempRoot {
        path: PathBuf,
    }

    impl TempRoot {
        fn new(label: &str) -> Self {
            let unique = uuid::Uuid::new_v4().simple().to_string();
            let path = std::env::temp_dir().join(format!("acp-fence-{label}-{unique}"));
            fs::create_dir_all(&path).expect("temp root should be creatable");
            // Canonicalize because macOS reports `/var` as a symlink to
            // `/private/var`; a test asserting on raw temp paths would compare
            // two spellings of the same directory.
            let path = fs::canonicalize(&path).expect("temp root should canonicalize");
            Self { path }
        }
    }

    impl Drop for TempRoot {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    #[test]
    fn denies_every_path_when_no_root_was_granted() {
        let fence = Fence::new(Vec::<PathBuf>::new());
        assert!(fence.is_empty());
        let error = fence
            .resolve_read(Path::new("/etc/hosts"))
            .expect_err("an empty fence must deny rather than default to permissive");
        assert_eq!(error, FenceError::NoRootsGranted);
    }

    #[test]
    fn drops_a_root_that_cannot_be_canonicalized() {
        let root = TempRoot::new("partial");
        let fence = Fence::new([root.path.clone(), root.path.join("missing")]);
        assert_eq!(
            fence.roots(),
            [root.path.clone()],
            "an unresolvable root must be dropped, never compared lexically"
        );
    }

    #[test]
    fn reads_a_file_inside_a_granted_root() {
        let root = TempRoot::new("read");
        let target = root.path.join("notes.txt");
        fs::write(&target, "hello").expect("file should be writable");
        let fence = Fence::new([root.path.clone()]);
        assert_eq!(
            fence.resolve_read(&target).expect("read should be allowed"),
            target
        );
    }

    #[test]
    fn rejects_a_relative_path() {
        let root = TempRoot::new("relative");
        let fence = Fence::new([root.path.clone()]);
        let error = fence
            .resolve_read(Path::new("notes.txt"))
            .expect_err("a relative path has no single meaning to check");
        assert_eq!(error, FenceError::NotAbsolute);
    }

    #[test]
    fn rejects_an_absolute_path_outside_every_root() {
        let root = TempRoot::new("outside");
        let neighbour = TempRoot::new("neighbour");
        let target = neighbour.path.join("secret.txt");
        fs::write(&target, "secret").expect("file should be writable");
        let fence = Fence::new([root.path.clone()]);
        let error = fence
            .resolve_read(&target)
            .expect_err("a sibling directory is not granted");
        assert_eq!(error, FenceError::OutsideRoots);
    }

    #[test]
    fn rejects_a_traversal_that_escapes_through_parent_components() {
        let root = TempRoot::new("traversal");
        let neighbour = TempRoot::new("traversal-target");
        let target = neighbour.path.join("secret.txt");
        fs::write(&target, "secret").expect("file should be writable");
        let fence = Fence::new([root.path.clone()]);
        let escaping = root
            .path
            .join("..")
            .join(neighbour.path.file_name().expect("temp dir has a name"))
            .join("secret.txt");
        let error = fence
            .resolve_read(&escaping)
            .expect_err("canonicalization must collapse .. before the containment check");
        assert_eq!(error, FenceError::OutsideRoots);
    }

    #[test]
    fn does_not_admit_a_sibling_whose_name_extends_the_root_name() {
        // A string-prefix check would accept this; component-wise matching must not.
        let base = TempRoot::new("prefix");
        let root = base.path.join("work");
        let sibling = base.path.join("work-elsewhere");
        fs::create_dir_all(&root).expect("root should be creatable");
        fs::create_dir_all(&sibling).expect("sibling should be creatable");
        let target = sibling.join("secret.txt");
        fs::write(&target, "secret").expect("file should be writable");
        let fence = Fence::new([root]);
        let error = fence
            .resolve_read(&target)
            .expect_err("containment compares components, not characters");
        assert_eq!(error, FenceError::OutsideRoots);
    }

    #[test]
    fn reports_a_missing_read_target_as_not_found() {
        let root = TempRoot::new("missing-read");
        let fence = Fence::new([root.path.clone()]);
        let error = fence
            .resolve_read(&root.path.join("absent.txt"))
            .expect_err("a read needs an existing target");
        assert_eq!(error, FenceError::NotFound);
    }

    #[test]
    fn allows_writing_a_new_file_beside_an_existing_parent() {
        let root = TempRoot::new("write-new");
        let fence = Fence::new([root.path.clone()]);
        let target = root.path.join("fresh.txt");
        assert_eq!(
            fence
                .resolve_write(&target)
                .expect("a new file inside a root should be writable"),
            target
        );
    }

    #[test]
    fn rejects_a_write_whose_parent_directory_is_missing() {
        let root = TempRoot::new("write-deep");
        let fence = Fence::new([root.path.clone()]);
        let error = fence
            .resolve_write(&root.path.join("absent").join("fresh.txt"))
            .expect_err("this host creates files, not directory trees");
        assert_eq!(error, FenceError::NotFound);
    }

    #[test]
    fn rejects_a_write_that_escapes_through_its_parent() {
        let root = TempRoot::new("write-escape");
        let neighbour = TempRoot::new("write-escape-target");
        let fence = Fence::new([root.path.clone()]);
        let escaping = root
            .path
            .join("..")
            .join(neighbour.path.file_name().expect("temp dir has a name"))
            .join("planted.txt");
        let error = fence
            .resolve_write(&escaping)
            .expect_err("the parent is canonicalized before containment");
        assert_eq!(error, FenceError::OutsideRoots);
    }

    #[test]
    fn no_rejection_message_reveals_the_requested_path() {
        // The run trace carries these strings, so they are a redaction surface.
        let secret = "acp-fence-do-not-leak-this-component";
        for error in [
            FenceError::NoRootsGranted,
            FenceError::NotAbsolute,
            FenceError::NotFound,
            FenceError::OutsideRoots,
            FenceError::NoParentDirectory,
            FenceError::NotAPlainName,
        ] {
            let rendered = error.to_string();
            assert!(
                !rendered.contains(secret) && !rendered.contains('/') && !rendered.contains('\\'),
                "{} must not carry path data, got {rendered:?}",
                error.code()
            );
        }
    }

    #[cfg(unix)]
    #[test]
    fn rejects_reading_through_a_symlink_that_leaves_the_root() {
        let root = TempRoot::new("symlink-read");
        let neighbour = TempRoot::new("symlink-read-target");
        let secret = neighbour.path.join("secret.txt");
        fs::write(&secret, "secret").expect("file should be writable");
        let link = root.path.join("escape.txt");
        std::os::unix::fs::symlink(&secret, &link).expect("symlink should be creatable");
        let fence = Fence::new([root.path.clone()]);
        let error = fence
            .resolve_read(&link)
            .expect_err("a link inside the root must be judged by where it leads");
        assert_eq!(error, FenceError::OutsideRoots);
    }

    #[cfg(unix)]
    #[test]
    fn rejects_writing_through_a_symlink_that_leaves_the_root() {
        let root = TempRoot::new("symlink-write");
        let neighbour = TempRoot::new("symlink-write-target");
        let victim = neighbour.path.join("victim.txt");
        fs::write(&victim, "original").expect("file should be writable");
        let link = root.path.join("escape.txt");
        std::os::unix::fs::symlink(&victim, &link).expect("symlink should be creatable");
        let fence = Fence::new([root.path.clone()]);
        let error = fence
            .resolve_write(&link)
            .expect_err("writing through an escaping link must not be treated as contained");
        assert_eq!(error, FenceError::OutsideRoots);
        assert_eq!(
            fs::read_to_string(&victim).expect("victim should still be readable"),
            "original",
            "the rejected write must not have reached the target"
        );
    }

    #[cfg(unix)]
    #[test]
    fn allows_a_symlink_that_stays_inside_the_root() {
        let root = TempRoot::new("symlink-inside");
        let real = root.path.join("real.txt");
        fs::write(&real, "content").expect("file should be writable");
        let link = root.path.join("alias.txt");
        std::os::unix::fs::symlink(&real, &link).expect("symlink should be creatable");
        let fence = Fence::new([root.path.clone()]);
        assert_eq!(
            fence
                .resolve_read(&link)
                .expect("a contained link resolves to its contained target"),
            real
        );
    }
}
