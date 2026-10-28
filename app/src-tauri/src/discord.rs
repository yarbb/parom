//! Optional Discord Rich Presence (off by default; Preferences → Interface).
//!
//! Discord listens on a local pipe (Windows) or socket (Linux, macOS) named
//! `discord-ipc-N`; frames are an opcode and a length (u32, little endian)
//! followed by JSON. Nothing goes over the network from here, and the UI
//! decides what is shown (no server addresses; see lib/discord.svelte.ts).
//!
//! A background thread owns the connection: it connects when Discord runs,
//! sends the newest activity at most every 4 s (Discord's rate limit is
//! 5 updates per 20 s) and clears it when presence is turned off.

use serde_json::{json, Value};
use std::io::{Read, Write};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

/// The Parom application on the Discord developer portal (public ID).
const CLIENT_ID: &str = "1564976020744966304";

const OP_HANDSHAKE: u32 = 0;
const OP_FRAME: u32 = 1;

#[derive(Default)]
struct Wanted {
    /// None: show nothing (presence off, or cleared).
    activity: Option<Value>,
    /// Bumped on every change, so the thread knows what it already sent.
    version: u64,
}

#[derive(Clone, Default)]
pub struct Presence {
    wanted: Arc<(Mutex<Wanted>, Condvar)>,
}

impl Presence {
    /// Sets (or with None clears) what Discord shows.
    pub fn set(&self, activity: Option<Value>) {
        let (lock, wake) = &*self.wanted;
        let mut w = lock.lock().unwrap();
        if w.activity != activity {
            w.activity = activity;
            w.version += 1;
            wake.notify_one();
        }
    }

    pub fn start(&self) {
        let wanted = self.wanted.clone();
        std::thread::spawn(move || run(wanted));
    }
}

fn run(wanted: Arc<(Mutex<Wanted>, Condvar)>) {
    let (lock, wake) = &*wanted;
    let mut conn: Option<Conn> = None;
    let mut sent: u64 = 0;
    let mut last_send = Instant::now() - Duration::from_secs(60);
    let mut last_try = Instant::now() - Duration::from_secs(60);
    loop {
        let (activity, version) = {
            let mut w = lock.lock().unwrap();
            while w.version == sent {
                w = wake.wait(w).unwrap();
            }
            (w.activity.clone(), w.version)
        };
        if version == sent {
            continue;
        }
        // Rate limit: the newest activity wins, sent at most every 4 s.
        let wait = Duration::from_secs(4).saturating_sub(last_send.elapsed());
        if !wait.is_zero() {
            std::thread::sleep(wait);
            continue;
        }
        if conn.is_none() {
            if activity.is_none() {
                // Nothing shown and nothing to clear.
                sent = version;
                continue;
            }
            let pause = Duration::from_secs(15).saturating_sub(last_try.elapsed());
            if !pause.is_zero() {
                std::thread::sleep(pause);
                continue;
            }
            last_try = Instant::now();
            conn = Conn::open();
            if conn.is_none() {
                continue; // Discord is not running; try again later.
            }
        }
        let c = conn.as_mut().unwrap();
        let args = match &activity {
            Some(a) => json!({ "pid": std::process::id(), "activity": a }),
            None => json!({ "pid": std::process::id() }),
        };
        let frame = json!({ "cmd": "SET_ACTIVITY", "args": args, "nonce": version.to_string() });
        last_send = Instant::now();
        if c.request(OP_FRAME, &frame).is_ok() {
            sent = version;
        } else {
            conn = None; // Discord closed; reconnect on the next change.
        }
    }
}

#[cfg(windows)]
type Pipe = std::fs::File;
#[cfg(unix)]
type Pipe = std::os::unix::net::UnixStream;

struct Conn {
    pipe: Pipe,
}

impl Conn {
    fn open() -> Option<Conn> {
        for n in 0..10 {
            if let Some(pipe) = connect(n) {
                let mut conn = Conn { pipe };
                if conn.request(OP_HANDSHAKE, &json!({ "v": 1, "client_id": CLIENT_ID })).is_ok() {
                    return Some(conn);
                }
            }
        }
        None
    }

    /// Sends a frame and reads Discord's answer (it answers every frame).
    /// One thread does both: a pipe opened for plain blocking I/O on Windows
    /// would hold a write back while another thread waits in a read.
    fn request(&mut self, op: u32, body: &Value) -> std::io::Result<()> {
        let data = body.to_string().into_bytes();
        let mut buf = Vec::with_capacity(8 + data.len());
        buf.extend_from_slice(&op.to_le_bytes());
        buf.extend_from_slice(&(data.len() as u32).to_le_bytes());
        buf.extend_from_slice(&data);
        self.pipe.write_all(&buf)?;
        self.pipe.flush()?;
        let mut head = [0u8; 8];
        self.pipe.read_exact(&mut head)?;
        let reply_op = u32::from_le_bytes([head[0], head[1], head[2], head[3]]);
        let len = u32::from_le_bytes([head[4], head[5], head[6], head[7]]) as usize;
        let mut reply = vec![0u8; len.min(1 << 20)];
        self.pipe.read_exact(&mut reply)?;
        // Opcode 2: Discord closes the connection (unknown application, ...).
        if reply_op == 2 {
            return Err(std::io::Error::other(String::from_utf8_lossy(&reply).into_owned()));
        }
        Ok(())
    }
}

#[cfg(windows)]
fn connect(n: u32) -> Option<Pipe> {
    std::fs::OpenOptions::new().read(true).write(true).open(format!(r"\\.\pipe\discord-ipc-{n}")).ok()
}

#[cfg(unix)]
fn connect(n: u32) -> Option<Pipe> {
    let base = ["XDG_RUNTIME_DIR", "TMPDIR", "TMP", "TEMP"]
        .iter()
        .find_map(|k| std::env::var(k).ok())
        .unwrap_or_else(|| "/tmp".into());
    // Flatpak and Snap builds of Discord put the socket in a subfolder.
    for dir in ["", "app/com.discordapp.Discord/", "snap.discord/"] {
        if let Ok(s) = std::os::unix::net::UnixStream::connect(format!("{base}/{dir}discord-ipc-{n}")) {
            return Some(s);
        }
    }
    None
}
