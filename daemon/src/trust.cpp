// Copyright (C) TOTzilla contributors
// SPDX-License-Identifier: GPL-3.0-or-later

#include "trust.h"

#include <nlohmann/json.hpp>

#include <algorithm>
#include <cctype>
#include <fstream>
#include <iostream>

namespace totzillad {

using json = nlohmann::json;

void TrustStore::open(std::filesystem::path file)
{
	file_ = std::move(file);
	entries_.clear();
	std::error_code ec;
	if (!std::filesystem::exists(file_, ec)) {
		return;
	}
	try {
		std::ifstream in(file_, std::ios::binary);
		json const doc = json::parse(in);
		for (auto const& [k, v] : doc.at("entries").items()) {
			if (v.is_string()) {
				entries_[k] = v.get<std::string>();
			}
		}
	}
	catch (std::exception const& e) {
		// A damaged file only means questions get asked again.
		std::cerr << "totzillad: ignoring unreadable trust store: " << e.what() << '\n';
	}
}

std::string TrustStore::key(std::string const& kind, std::string const& host, unsigned int port)
{
	std::string h = host;
	std::transform(h.begin(), h.end(), h.begin(), [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
	return kind + ":" + h + ":" + std::to_string(port);
}

std::optional<std::string> TrustStore::get(std::string const& key) const
{
	auto it = entries_.find(key);
	if (it == entries_.end()) {
		return std::nullopt;
	}
	return it->second;
}

void TrustStore::set(std::string const& key, std::string const& fingerprint)
{
	entries_[key] = fingerprint;
	save();
}

bool TrustStore::remove(std::string const& key)
{
	if (!entries_.erase(key)) {
		return false;
	}
	save();
	return true;
}

void TrustStore::save() const
{
	if (file_.empty()) {
		return;
	}
	try {
		std::filesystem::create_directories(file_.parent_path());
		auto tmp = file_;
		tmp += ".tmp";
		{
			std::ofstream out(tmp, std::ios::binary | std::ios::trunc);
			out << json{{"version", 1}, {"entries", entries_}}.dump(2) << '\n';
			if (!out) {
				throw std::runtime_error("write failed");
			}
		}
		std::filesystem::rename(tmp, file_);
	}
	catch (std::exception const& e) {
		std::cerr << "totzillad: cannot save trust store: " << e.what() << '\n';
	}
}

}
