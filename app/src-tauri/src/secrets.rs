//! Server passwords in the OS credential store (Windows Credential Manager,
//! macOS Keychain). Never written to disk by the app itself.

use keyring::{Entry, Error};

fn entry(service: &str, key: &str) -> Result<Entry, String> {
    Entry::new(service, key).map_err(|e| e.to_string())
}

pub fn get(service: &str, key: &str) -> Result<Option<String>, String> {
    match entry(service, key)?.get_password() {
        Ok(password) => Ok(Some(password)),
        Err(Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

pub fn set(service: &str, key: &str, password: &str) -> Result<(), String> {
    entry(service, key)?.set_password(password).map_err(|e| e.to_string())
}

pub fn delete(service: &str, key: &str) -> Result<(), String> {
    match entry(service, key)?.delete_credential() {
        Ok(()) | Err(Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}
