//! Small file and process helpers for server sync: app folders, marker and
//! history files, backups, and the optional post-sync command.

use serde::Serialize;
use std::fs;
use std::io::Write;
use std::path::Path;
use std::process::Command;

/// Upper limit for files read with `read_small` (the marker is ~300 bytes).
const SMALL_FILE_LIMIT: u64 = 1024 * 1024;

pub fn read_small(path: &str) -> Result<String, String> {
    let meta = fs::metadata(path).map_err(|e| format!("{path}: {e}"))?;
    if meta.len() > SMALL_FILE_LIMIT {
        return Err(format!("{path}: file too large"));
    }
    fs::read_to_string(path).map_err(|e| format!("{path}: {e}"))
}

pub fn write_small(path: &str, content: &str) -> Result<(), String> {
    if let Some(dir) = Path::new(path).parent() {
        fs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    }
    fs::write(path, content).map_err(|e| format!("{path}: {e}"))
}

pub fn append_line(path: &str, line: &str) -> Result<(), String> {
    if let Some(dir) = Path::new(path).parent() {
        fs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    }
    let mut f = fs::OpenOptions::new().create(true).append(true).open(path).map_err(|e| format!("{path}: {e}"))?;
    writeln!(f, "{line}").map_err(|e| format!("{path}: {e}"))
}

/// Compares a downloaded server file with the local one: "missing" (no
/// local file), "same" or "different" (content, byte for byte).
pub fn compare_files(downloaded: &str, local: &str) -> Result<&'static str, String> {
    if !Path::new(local).is_file() {
        return Ok("missing");
    }
    let (a, b) = (fs::metadata(downloaded), fs::metadata(local));
    if let (Ok(a), Ok(b)) = (&a, &b) {
        if a.len() != b.len() {
            return Ok("different");
        }
    }
    let a = fs::read(downloaded).map_err(|e| format!("{downloaded}: {e}"))?;
    let b = fs::read(local).map_err(|e| format!("{local}: {e}"))?;
    Ok(if a == b { "same" } else { "different" })
}

/// Copies a file, creating the target's folders (server files taken into the
/// local repository folder).
pub fn copy_file(from: &str, to: &str) -> Result<(), String> {
    if let Some(dir) = Path::new(to).parent() {
        fs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    }
    fs::copy(from, to).map(|_| ()).map_err(|e| format!("{to}: {e}"))
}

/// Removes one of the app's own backup folders (the user confirmed it).
pub fn remove_dir(path: &str) -> Result<(), String> {
    fs::remove_dir_all(path).map_err(|e| format!("{path}: {e}"))
}

/// Total size of the files below `path`, for the backups list.
pub fn dir_size(path: &str) -> u64 {
    fn walk(p: &Path) -> u64 {
        let Ok(read) = fs::read_dir(p) else { return 0 };
        read.flatten()
            .map(|e| match e.file_type() {
                Ok(t) if t.is_dir() => walk(&e.path()),
                Ok(t) if t.is_file() => e.metadata().map(|m| m.len()).unwrap_or(0),
                _ => 0,
            })
            .sum()
    }
    walk(Path::new(path))
}

/// "user on computer", written into the marker as `who` until GitHub sign-in exists.
pub fn machine_name() -> String {
    let user = std::env::var(if cfg!(windows) { "USERNAME" } else { "USER" }).unwrap_or_default();
    let host = std::env::var(if cfg!(windows) { "COMPUTERNAME" } else { "HOSTNAME" }).unwrap_or_default();
    match (user.is_empty(), host.is_empty()) {
        (false, false) => format!("{user}@{host}"),
        (false, true) => user,
        (true, false) => host,
        (true, true) => "unknown".into(),
    }
}

#[derive(Serialize)]
pub struct CommandResult {
    code: Option<i32>,
    /// The last few KB of stdout and stderr.
    output: String,
}

/// Runs a shell command on this computer (the post-sync step, e.g. calling a
/// hosting panel's restart API with curl).
pub fn run_command(command: &str, cwd: Option<&str>) -> Result<CommandResult, String> {
    let mut cmd = if cfg!(windows) {
        let mut c = Command::new("cmd");
        c.args(["/C", command]);
        c
    } else {
        let mut c = Command::new("sh");
        c.args(["-c", command]);
        c
    };
    if let Some(dir) = cwd.filter(|d| !d.is_empty()) {
        cmd.current_dir(dir);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let out = cmd.output().map_err(|e| e.to_string())?;
    let mut text = String::from_utf8_lossy(&out.stdout).into_owned();
    text.push_str(&String::from_utf8_lossy(&out.stderr));
    let tail = text.char_indices().rev().nth(4000).map(|(i, _)| text[i..].to_string()).unwrap_or(text);
    Ok(CommandResult { code: out.status.code(), output: tail })
}
