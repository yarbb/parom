//! Local file system access for the Files tab. Kept in the app (not the
//! daemon) because it needs no engine and is simplest with std.

use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

#[derive(Serialize)]
pub struct LocalEntry {
    name: String,
    /// -1 for directories.
    size: i64,
    dir: bool,
    link: bool,
    /// Milliseconds since the Unix epoch, if known.
    mtime: Option<i64>,
}

#[derive(Serialize)]
pub struct LocalListing {
    path: String,
    /// None at a file system root.
    parent: Option<String>,
    separator: String,
    entries: Vec<LocalEntry>,
}

fn mtime_ms(meta: &fs::Metadata) -> Option<i64> {
    let d = meta.modified().ok()?.duration_since(UNIX_EPOCH).ok()?;
    i64::try_from(d.as_millis()).ok()
}

pub fn list(path: &str) -> Result<LocalListing, String> {
    let dir = PathBuf::from(path);
    let read = fs::read_dir(&dir).map_err(|e| format!("{}: {e}", dir.display()))?;

    let mut entries = Vec::new();
    for item in read {
        let Ok(item) = item else { continue };
        let Ok(kind) = item.file_type() else { continue };
        // Follow links for size and type; a broken link stays a plain entry.
        let meta = fs::metadata(item.path()).or_else(|_| item.metadata());
        let (dir, size, mtime) = match &meta {
            Ok(m) => (m.is_dir(), if m.is_dir() { -1 } else { i64::try_from(m.len()).unwrap_or(i64::MAX) }, mtime_ms(m)),
            Err(_) => (false, -1, None),
        };
        entries.push(LocalEntry {
            name: item.file_name().to_string_lossy().into_owned(),
            size,
            dir,
            link: kind.is_symlink(),
            mtime,
        });
    }

    Ok(LocalListing {
        path: dir.display().to_string(),
        parent: dir.parent().map(|p| p.display().to_string()).filter(|p| !p.is_empty()),
        separator: std::path::MAIN_SEPARATOR.to_string(),
        entries,
    })
}

/// The user's home directory, falling back to the first root.
pub fn home() -> String {
    let var = if cfg!(windows) { "USERPROFILE" } else { "HOME" };
    std::env::var_os(var)
        .map(|h| PathBuf::from(h).display().to_string())
        .filter(|h| Path::new(h).is_dir())
        .unwrap_or_else(|| roots().into_iter().next().unwrap_or_else(|| "/".into()))
}

/// File system roots: drive letters on Windows, "/" elsewhere.
pub fn roots() -> Vec<String> {
    if cfg!(windows) {
        (b'A'..=b'Z')
            .map(|c| format!("{}:\\", c as char))
            .filter(|r| Path::new(r).is_dir())
            .collect()
    } else {
        vec!["/".into()]
    }
}

#[derive(Serialize, Default)]
pub struct LocalTree {
    /// Directories below the root, parents first, relative with "/".
    dirs: Vec<String>,
    /// Files below the root, relative with "/".
    files: Vec<String>,
}

/// Everything below `root` for a folder upload. Symlinked directories are
/// not followed, so link loops cannot recurse forever.
pub fn walk(root: &str) -> Result<LocalTree, String> {
    fn visit(dir: &Path, rel: &str, tree: &mut LocalTree) -> Result<(), String> {
        let read = fs::read_dir(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
        for item in read {
            let Ok(item) = item else { continue };
            let Ok(kind) = item.file_type() else { continue };
            let name = item.file_name().to_string_lossy().into_owned();
            let child = if rel.is_empty() { name } else { format!("{rel}/{name}") };
            if kind.is_dir() {
                tree.dirs.push(child.clone());
                visit(&item.path(), &child, tree)?;
            } else if kind.is_file() || (kind.is_symlink() && item.path().is_file()) {
                tree.files.push(child);
            }
        }
        Ok(())
    }
    let mut tree = LocalTree::default();
    visit(Path::new(root), "", &mut tree)?;
    Ok(tree)
}

pub fn mkdir(path: &str) -> Result<(), String> {
    fs::create_dir_all(path).map_err(|e| format!("{path}: {e}"))
}