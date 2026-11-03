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

/// File system roots: drive letters on Windows, "/" elsewhere. Each letter is
/// checked on its own thread: a mapped network drive whose server is asleep or
/// gone can take seconds to answer, so a letter still busy after a short wait
/// is listed anyway (missing letters answer at once).
pub fn roots() -> Vec<String> {
    if !cfg!(windows) {
        return vec!["/".into()];
    }
    let (tx, rx) = std::sync::mpsc::channel();
    for c in b'A'..=b'Z' {
        let tx = tx.clone();
        std::thread::spawn(move || {
            let _ = tx.send((c, Path::new(&format!("{}:\\", c as char)).is_dir()));
        });
    }
    drop(tx);
    let deadline = std::time::Instant::now() + std::time::Duration::from_millis(300);
    let mut answered = [None::<bool>; 26];
    while let Some(left) = deadline.checked_duration_since(std::time::Instant::now()) {
        match rx.recv_timeout(left) {
            Ok((c, ok)) => answered[(c - b'A') as usize] = Some(ok),
            Err(_) => break,
        }
    }
    (b'A'..=b'Z')
        .filter(|c| answered[(c - b'A') as usize] != Some(false))
        .map(|c| format!("{}:\\", c as char))
        .collect()
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
pub fn rename(from: &str, to: &str) -> Result<(), String> {
    if Path::new(to).exists() {
        return Err(format!("{to}: already exists"));
    }
    fs::rename(from, to).map_err(|e| format!("{from}: {e}"))
}

/// Moves files and folders to the system trash (Recycle Bin), never deletes outright.
pub fn trash(paths: &[String]) -> Result<(), String> {
    trash::delete_all(paths).map_err(|e| e.to_string())
}
/// A free name in `dir` for `name`: "name (2).ext", "name (3).ext", ...
fn free_name(dir: &Path, name: &str) -> PathBuf {
    let (stem, ext) = match name.rfind('.') {
        Some(i) if i > 0 => (&name[..i], &name[i..]),
        _ => (name, ""),
    };
    (2..)
        .map(|n| dir.join(format!("{stem} ({n}){ext}")))
        .find(|p| !p.exists())
        .expect("a free name")
}

fn copy_tree(from: &Path, to: &Path) -> Result<(), String> {
    if from.is_dir() {
        fs::create_dir_all(to).map_err(|e| format!("{}: {e}", to.display()))?;
        for entry in fs::read_dir(from).map_err(|e| format!("{}: {e}", from.display()))? {
            let entry = entry.map_err(|e| format!("{}: {e}", from.display()))?;
            copy_tree(&entry.path(), &to.join(entry.file_name()))?;
        }
        Ok(())
    } else {
        fs::copy(from, to).map(|_| ()).map_err(|e| format!("{}: {e}", from.display()))
    }
}

/// Copies files and folders into `dir` (files dropped from the system file
/// manager). Names already there: "overwrite" (folders merge), "skip" or
/// "rename" (a free "name (2)"). Returns how many were copied.
pub fn copy_into(paths: &[String], dir: &str, exists: &str) -> Result<usize, String> {
    let target = Path::new(dir);
    let mut copied = 0;
    for p in paths {
        let from = Path::new(p);
        let Some(name) = from.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        if from.parent() == Some(target) {
            // Dropped where it already is.
            continue;
        }
        if from.is_dir() && target.starts_with(from) {
            return Err(format!("{p}: cannot copy a folder into itself"));
        }
        let mut to = target.join(name);
        if to.exists() {
            match exists {
                "skip" => continue,
                "rename" => to = free_name(target, name),
                _ => {}
            }
        }
        copy_tree(from, &to)?;
        copied += 1;
    }
    Ok(copied)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("parom-copy-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn roots_answer_quickly() {
        let started = std::time::Instant::now();
        let r = roots();
        assert!(started.elapsed() < std::time::Duration::from_secs(2));
        assert!(r.iter().any(|x| Path::new(x).is_dir()));
    }

    #[test]
    fn copies_files_and_folders_with_each_answer() {
        let src = tmp("src");
        let dst = tmp("dst");
        fs::write(src.join("a.txt"), "new").unwrap();
        fs::create_dir_all(src.join("f/g")).unwrap();
        fs::write(src.join("f/g/b.txt"), "b").unwrap();
        fs::write(dst.join("a.txt"), "old").unwrap();
        let paths = vec![src.join("a.txt").to_string_lossy().into_owned(), src.join("f").to_string_lossy().into_owned()];
        let d = dst.to_string_lossy().into_owned();

        assert_eq!(copy_into(&paths, &d, "skip").unwrap(), 1);
        assert_eq!(fs::read_to_string(dst.join("a.txt")).unwrap(), "old");
        assert_eq!(fs::read_to_string(dst.join("f/g/b.txt")).unwrap(), "b");

        assert_eq!(copy_into(&paths[..1], &d, "rename").unwrap(), 1);
        assert_eq!(fs::read_to_string(dst.join("a (2).txt")).unwrap(), "new");

        assert_eq!(copy_into(&paths[..1], &d, "overwrite").unwrap(), 1);
        assert_eq!(fs::read_to_string(dst.join("a.txt")).unwrap(), "new");

        let inside = src.join("f").to_string_lossy().into_owned();
        assert!(copy_into(&paths[1..], &inside, "overwrite").is_err());
        let _ = fs::remove_dir_all(&src);
        let _ = fs::remove_dir_all(&dst);
    }
}
