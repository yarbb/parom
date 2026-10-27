//! Moves data from the app's working name to the current one: data folders
//! (sites, preferences, trusted keys, backups, history, the webview's local
//! storage) and saved passwords. Copies, never deletes, so an old install
//! keeps working.

use std::fs;
use std::path::{Path, PathBuf};

/// Identifier and credential service the app used before it was renamed.
const OLD_IDENTIFIER: &str = "org.totzilla.app";
pub const OLD_SERVICE: &str = "TOTzilla";

/// Folders the platform keeps app data in (roaming and local on Windows).
fn data_bases() -> Vec<PathBuf> {
    let env = |k: &str| std::env::var_os(k).map(PathBuf::from);
    let mut out = Vec::new();
    if cfg!(windows) {
        out.extend(env("APPDATA"));
        out.extend(env("LOCALAPPDATA"));
    } else if cfg!(target_os = "macos") {
        out.extend(env("HOME").map(|h| h.join("Library/Application Support")));
    } else {
        out.extend(env("XDG_DATA_HOME").or_else(|| env("HOME").map(|h| h.join(".local/share"))));
        out.extend(env("XDG_CONFIG_HOME").or_else(|| env("HOME").map(|h| h.join(".config"))));
    }
    out.dedup();
    out
}

fn copy_dir(from: &Path, to: &Path) -> std::io::Result<()> {
    fs::create_dir_all(to)?;
    for entry in fs::read_dir(from)?.flatten() {
        let (src, dst) = (entry.path(), to.join(entry.file_name()));
        // Best effort: a locked or vanished file must not stop the rest.
        let _ = if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            copy_dir(&src, &dst)
        } else {
            fs::copy(&src, &dst).map(|_| ())
        };
    }
    Ok(())
}

/// Copies the old data folders to the new identifier's, once (only while the
/// new ones do not exist). Runs before any window, so the webview's storage
/// is in place when it starts.
pub fn data_dirs(identifier: &str) {
    if identifier == OLD_IDENTIFIER {
        return;
    }
    for base in data_bases() {
        let (old, new) = (base.join(OLD_IDENTIFIER), base.join(identifier));
        if old.is_dir() && !new.exists() {
            if let Err(e) = copy_dir(&old, &new) {
                eprintln!("could not copy {}: {e}", old.display());
            }
        }
    }
}

/// Copies saved passwords filed under the old name; returns how many.
pub fn secrets(service: &str, keys: &[String]) -> usize {
    if service == OLD_SERVICE {
        return 0;
    }
    let mut copied = 0;
    for key in keys {
        let missing = matches!(crate::secrets::get(service, key), Ok(None));
        if let (true, Ok(Some(value))) = (missing, crate::secrets::get(OLD_SERVICE, key)) {
            if crate::secrets::set(service, key, &value).is_ok() {
                copied += 1;
            }
        }
    }
    copied
}
