//! GitHub REST API and sign-in. The token stays on this side: the UI asks
//! for API calls by path and never sees it.

use serde::Serialize;
use serde_json::{json, Value};
use std::sync::OnceLock;
use std::time::Duration;

const API: &str = "https://api.github.com";

/// Client ID of the GitHub App behind "Sign in with browser" (device flow).
/// Public by design: the device flow needs no client secret.
pub const CLIENT_ID: &str = "Iv23liuRYyudt5NAllF1";

/// Credential store key of the signed-in token.
pub const TOKEN_KEY: &str = "github:token";

static AGENT: OnceLock<ureq::Agent> = OnceLock::new();

/// `user_agent` is only used by the first call (GitHub requires one).
fn agent(user_agent: &str) -> &'static ureq::Agent {
    AGENT.get_or_init(|| {
        ureq::AgentBuilder::new()
            .timeout_connect(Duration::from_secs(15))
            .timeout(Duration::from_secs(60))
            .user_agent(user_agent)
            .build()
    })
}

fn body_of(resp: ureq::Response) -> Value {
    let text = resp.into_string().unwrap_or_default();
    if text.trim().is_empty() {
        Value::Null
    } else {
        serde_json::from_str(&text).unwrap_or(Value::String(text))
    }
}

/// An API error. `status` is 0 when the request did not reach GitHub.
#[derive(Debug)]
pub struct ApiError {
    pub status: u16,
    pub message: String,
}

impl ApiError {
    fn text(self) -> String {
        if self.status == 0 {
            self.message
        } else {
            format!("{} ({})", self.message, self.status)
        }
    }
}

impl From<ApiError> for String {
    fn from(e: ApiError) -> String {
        e.text()
    }
}

fn status_error(code: u16, resp: ureq::Response) -> ApiError {
    let body = body_of(resp);
    let message = body.get("message").and_then(Value::as_str).unwrap_or("GitHub request failed").to_owned();
    ApiError { status: code, message }
}

/// One REST call: `path` is relative to api.github.com and must start with "/".
/// `html` asks for Markdown fields rendered by GitHub as well (`body_html`).
pub fn api(user_agent: &str, token: &str, method: &str, path: &str, body: Option<Value>, html: bool) -> Result<Value, ApiError> {
    if !path.starts_with('/') || path.contains("://") {
        return Err(ApiError { status: 0, message: format!("bad API path: {path}") });
    }
    let req = agent(user_agent)
        .request(method, &format!("{API}{path}"))
        .set("Authorization", &format!("Bearer {token}"))
        .set("Accept", if html { "application/vnd.github.full+json" } else { "application/vnd.github+json" })
        .set("X-GitHub-Api-Version", "2022-11-28");
    let result = match body {
        Some(b) => req.send_json(b),
        None => req.call(),
    };
    match result {
        Ok(resp) => Ok(body_of(resp)),
        Err(ureq::Error::Status(code, resp)) => Err(status_error(code, resp)),
        Err(e) => Err(ApiError { status: 0, message: e.to_string() }),
    }
}

#[derive(Serialize)]
pub struct DeviceCode {
    device_code: String,
    user_code: String,
    verification_uri: String,
    expires_in: u64,
    interval: u64,
}

fn post_form(user_agent: &str, url: &str, form: &[(&str, &str)]) -> Result<Value, String> {
    match agent(user_agent).post(url).set("Accept", "application/json").send_form(form) {
        Ok(resp) => Ok(body_of(resp)),
        Err(ureq::Error::Status(code, resp)) => Err(status_error(code, resp).text()),
        Err(e) => Err(e.to_string()),
    }
}

/// Step 1 of the device flow: a code for the user to enter on github.com.
pub fn device_start(user_agent: &str) -> Result<DeviceCode, String> {
    if CLIENT_ID.is_empty() {
        return Err("Sign in with browser is not set up in this build".into());
    }
    let v = post_form(user_agent, "https://github.com/login/device/code", &[("client_id", CLIENT_ID)])?;
    let s = |k: &str| v.get(k).and_then(Value::as_str).map(str::to_owned);
    let n = |k: &str, d: u64| v.get(k).and_then(Value::as_u64).unwrap_or(d);
    Ok(DeviceCode {
        device_code: s("device_code").ok_or("GitHub sent no device code")?,
        user_code: s("user_code").ok_or("GitHub sent no user code")?,
        verification_uri: s("verification_uri").unwrap_or_else(|| "https://github.com/login/device".into()),
        expires_in: n("expires_in", 900),
        interval: n("interval", 5),
    })
}

/// Step 2: one poll. Ok(Some(token)) once the user approved; Ok(None) while
/// pending. Errors carry GitHub's code ("slow_down", "expired_token",
/// "access_denied") so the UI can react.
pub fn device_poll(user_agent: &str, device_code: &str) -> Result<Option<String>, String> {
    let v = post_form(
        user_agent,
        "https://github.com/login/oauth/access_token",
        &[
            ("client_id", CLIENT_ID),
            ("device_code", device_code),
            ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
        ],
    )?;
    if let Some(token) = v.get("access_token").and_then(Value::as_str) {
        return Ok(Some(token.to_owned()));
    }
    match v.get("error").and_then(Value::as_str) {
        Some("authorization_pending") | None => Ok(None),
        Some(code) => Err(code.to_owned()),
    }
}

/// The signed-in user, trimmed to what the UI shows.
pub fn user(user_agent: &str, token: &str) -> Result<Value, ApiError> {
    let u = api(user_agent, token, "GET", "/user", None, false)?;
    Ok(json!({
        "login": u.get("login"),
        "id": u.get("id"),
        "name": u.get("name"),
        "avatar_url": u.get("avatar_url"),
    }))
}
