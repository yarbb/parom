// Fingerprints of SSH host keys and TLS certificates the user chose to trust
// permanently, kept in <data dir>/trust.json.
//
// Copyright (C) TOTzilla contributors
// SPDX-License-Identifier: GPL-3.0-or-later

#ifndef TOTZILLAD_TRUST_HEADER
#define TOTZILLAD_TRUST_HEADER

#include <filesystem>
#include <map>
#include <optional>
#include <string>

namespace totzillad {

class TrustStore final
{
public:
	/// Starts in memory only, until open() names a file.
	TrustStore() = default;

	/// Loads `file` if it exists; later changes are written there.
	void open(std::filesystem::path file);

	/// "ssh", "tls" or "plain" (unencrypted FTP allowed), plus host and port;
	/// host names compare case-insensitively.
	static std::string key(std::string const& kind, std::string const& host, unsigned int port);

	std::optional<std::string> get(std::string const& key) const;

	/// Stores and writes the file at once (temp file + rename).
	void set(std::string const& key, std::string const& fingerprint);

	/// Forgets one entry; returns false if it was not there.
	bool remove(std::string const& key);

	std::map<std::string, std::string> const& entries() const { return entries_; }

private:
	void save() const;

	std::filesystem::path file_;
	std::map<std::string, std::string> entries_;
};

}

#endif
