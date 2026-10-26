// totzillad: wraps the FileZilla engine and serves JSON-RPC 2.0 over stdio.
// See daemon/PROTOCOL.md for the methods and events.
//
// Copyright (C) TOTzilla contributors
// SPDX-License-Identifier: GPL-3.0-or-later

#include "daemon.h"
#include "trust.h"

#include "FileZillaEngine.h"
#include "directorylisting.h"
#include "engine_context.h"
#include "engine_options.h"

#include <fzssh/pubkey.hpp>
#include <libfilezilla/aio/reader.hpp>
#include <libfilezilla/aio/writer.hpp>
#include <libfilezilla/local_filesys.hpp>
#include <libfilezilla/string.hpp>
#include <libfilezilla/time.hpp>

#include <nlohmann/json.hpp>

#include <algorithm>
#include <atomic>
#include <chrono>
#include <condition_variable>
#include <deque>
#include <fstream>
#include <map>
#include <mutex>
#include <optional>
#include <set>
#include <thread>
#include <vector>


namespace totzillad {

namespace {

using json = nlohmann::json;

int constexpr protocol_version = 1;

// JSON-RPC error codes. -32000..-32099 are ours.
int constexpr parse_error = -32700;
int constexpr invalid_request = -32600;
int constexpr method_not_found = -32601;
int constexpr invalid_params = -32602;
int constexpr engine_error = -32000;
int constexpr unknown_session = -32001;
int constexpr unknown_request = -32002;
int constexpr session_closing = -32003;
int constexpr store_error = -32004;

struct RpcError
{
	int code;
	std::string message;
	json data{};
};

// The engine reads settings through COptionsBase; defaults are filled in
// lazily from the engine's option registry.
class Options final : public COptionsBase
{
protected:
	// Change notifications are only needed by a UI; can_notify_ stays false.
	void notify_changed() override {}
};

// Only used for servers with ENCODING_CUSTOM, which the daemon never sets.
class Utf8Encoding final : public CustomEncodingConverterBase
{
public:
	std::wstring toLocal(std::wstring const&, char const* buffer, size_t len) const override
	{
		return fz::to_wstring_from_utf8(buffer, len);
	}

	std::string toServer(std::wstring const&, wchar_t const* buffer, size_t len) const override
	{
		return fz::to_utf8(std::wstring_view(buffer, len));
	}
};

struct SessionHandle final : public ServerHandleData
{
};

std::string u8(std::wstring const& s)
{
	return fz::to_utf8(s);
}

std::wstring wide(std::string const& s)
{
	return fz::to_wstring_from_utf8(s);
}

// Parameter helpers. All throw RpcError(invalid_params) on bad input.
json const* find(json const& params, char const* key)
{
	auto it = params.find(key);
	if (it == params.end() || it->is_null()) {
		return nullptr;
	}
	return &*it;
}

std::string get_string(json const& params, char const* key)
{
	auto v = find(params, key);
	if (!v || !v->is_string()) {
		throw RpcError{invalid_params, std::string("Missing string parameter: ") + key};
	}
	return v->get<std::string>();
}

std::string get_string(json const& params, char const* key, std::string const& def)
{
	auto v = find(params, key);
	if (!v) {
		return def;
	}
	if (!v->is_string()) {
		throw RpcError{invalid_params, std::string("Parameter must be a string: ") + key};
	}
	return v->get<std::string>();
}

int64_t get_int(json const& params, char const* key, int64_t def)
{
	auto v = find(params, key);
	if (!v) {
		return def;
	}
	if (!v->is_number_integer()) {
		throw RpcError{invalid_params, std::string("Parameter must be an integer: ") + key};
	}
	return v->get<int64_t>();
}

bool get_bool(json const& params, char const* key, bool def)
{
	auto v = find(params, key);
	if (!v) {
		return def;
	}
	if (!v->is_boolean()) {
		throw RpcError{invalid_params, std::string("Parameter must be a boolean: ") + key};
	}
	return v->get<bool>();
}

CServerPath get_path(json const& params, char const* key)
{
	CServerPath path(wide(get_string(params, key)));
	if (path.empty()) {
		throw RpcError{invalid_params, std::string("Invalid server path: ") + key};
	}
	return path;
}

std::string get_name(json const& params, char const* key)
{
	auto name = get_string(params, key);
	if (name.empty() || name.find('/') != std::string::npos) {
		throw RpcError{invalid_params, std::string("Invalid file name: ") + key};
	}
	return name;
}

CFileExistsNotification::OverwriteAction overwrite_action(std::string const& name)
{
	static std::map<std::string, CFileExistsNotification::OverwriteAction> const actions{
		{"overwrite", CFileExistsNotification::overwrite},
		{"overwrite_newer", CFileExistsNotification::overwriteNewer},
		{"overwrite_size", CFileExistsNotification::overwriteSize},
		{"overwrite_size_or_newer", CFileExistsNotification::overwriteSizeOrNewer},
		{"resume", CFileExistsNotification::resume},
		{"rename", CFileExistsNotification::rename},
		{"skip", CFileExistsNotification::skip},
	};
	auto it = actions.find(name);
	if (it == actions.end()) {
		throw RpcError{invalid_params, "Unknown file exists action: " + name};
	}
	return it->second;
}

std::wstring base_name(std::wstring const& path)
{
	auto const pos = path.find_last_of(L"/\\");
	return pos == std::wstring::npos ? path : path.substr(pos + 1);
}

ServerProtocol protocol_from_name(std::string const& name)
{
	if (name == "sftp") {
		return SFTP;
	}
	if (name == "ftp") {
		return FTP;
	}
	if (name == "ftps") {
		return FTPS;
	}
	if (name == "ftpes") {
		return FTPES;
	}
	if (name == "ftp-insecure") {
		return INSECURE_FTP;
	}
	return UNKNOWN;
}

json reply_flags(int reply)
{
	json flags = json::array();
	auto check = [&](int flag, char const* name) {
		if ((reply & flag) == flag) {
			flags.push_back(name);
		}
	};
	check(FZ_REPLY_CRITICALERROR, "critical");
	check(FZ_REPLY_CANCELED, "canceled");
	check(FZ_REPLY_SYNTAXERROR, "syntax");
	check(FZ_REPLY_NOTCONNECTED, "not_connected");
	check(FZ_REPLY_DISCONNECTED, "disconnected");
	check(FZ_REPLY_INTERNALERROR, "internal");
	check(FZ_REPLY_BUSY, "busy");
	check(FZ_REPLY_ALREADYCONNECTED, "already_connected");
	check(FZ_REPLY_PASSWORDFAILED, "password_failed");
	check(FZ_REPLY_TIMEOUT, "timeout");
	check(FZ_REPLY_NOTSUPPORTED, "not_supported");
	check(FZ_REPLY_WRITEFAILED, "write_failed");
	check(FZ_REPLY_LINKNOTDIR, "link_not_dir");
	return flags;
}

void require_ok(int reply)
{
	if (reply != FZ_REPLY_OK) {
		throw RpcError{engine_error, "Operation failed", json{{"reply", reply}, {"flags", reply_flags(reply)}}};
	}
}

json entry_json(CDirentry const& e)
{
	json j{
		{"name", u8(e.name)},
		{"size", e.size},
		{"dir", e.is_dir()},
		{"link", e.is_link()},
	};
	if (e.has_date()) {
		j["time"] = e.time.format(e.has_time() ? "%Y-%m-%dT%H:%M:%SZ" : "%Y-%m-%d", fz::datetime::utc);
	}
	if (!e.permissions->empty()) {
		j["perms"] = u8(*e.permissions);
	}
	if (!e.ownerGroup->empty()) {
		j["owner"] = u8(*e.ownerGroup);
	}
	if (e.is_link() && e.target) {
		j["target"] = u8(*e.target);
	}
	return j;
}

/// SHA-256 fingerprint of the server's own certificate, or "" without one.
std::string leaf_fingerprint(fz::tls_session_info const& info)
{
	auto const& certs = info.get_peer_certificates();
	return certs.empty() ? std::string() : certs.front().get_fingerprint_sha256();
}

char const* log_level(logmsg::type t)
{
	switch (t) {
	case logmsg::error:
		return "error";
	case logmsg::command:
		return "command";
	case logmsg::reply:
		return "reply";
	case logmsg::status:
		return "status";
	case logmsg::listing:
		return "listing";
	default:
		return "debug";
	}
}

struct Session;

struct Pending
{
	json id; // null: no response is sent
	std::unique_ptr<CCommand> command;
	std::function<void(Session&)> before;
	std::function<json(Session&, int reply)> done;
	bool close_after{};
	bool close_on_error{};

	// File transfers: progress is reported while running; a preset answer
	// for "file exists" skips asking the client.
	bool transfer{};
	std::optional<CFileExistsNotification::OverwriteAction> exists_action;
	/// The "file exists" answer means nothing is transferred.
	bool skipped{};
};

/// Whether an answer to "file exists" skips the file, following the engine's
/// rules (ControlSocket::SetFileExistsAction): unknown times or sizes transfer.
bool will_skip(CFileExistsNotification const& n)
{
	auto const& source = n.download ? n.remoteTime : n.localTime;
	auto const& target = n.download ? n.localTime : n.remoteTime;
	auto const sourceSize = n.download ? n.remoteSize : n.localSize;
	auto const targetSize = n.download ? n.localSize : n.remoteSize;
	bool const knownTimes = !source.empty() && !target.empty();
	bool const newer = !knownTimes || source.compare(target) > 0;
	bool const sameSize = sourceSize >= 0 && sourceSize == targetSize;
	switch (n.overwriteAction) {
	case CFileExistsNotification::skip:
		return true;
	case CFileExistsNotification::overwriteNewer:
		return !newer;
	case CFileExistsNotification::overwriteSize:
		return sameSize;
	case CFileExistsNotification::overwriteSizeOrNewer:
		return sameSize && !newer;
	default:
		return false;
	}
}

Pending make_pending(json const& id, std::unique_ptr<CCommand> command)
{
	Pending p;
	p.id = id;
	p.command = std::move(command);
	return p;
}

struct Session
{
	int id{};
	std::shared_ptr<SessionHandle> handle{std::make_shared<SessionHandle>()};
	std::deque<Pending> queue;
	std::optional<Pending> current;
	bool running{};
	bool closing{};
	CServerPath last_listing;
	int next_request{1};
	std::map<int, std::unique_ptr<CAsyncRequestNotification>> requests;
	/// Certificates the user trusted in this session, by leaf fingerprint.
	std::set<std::string> trusted_certs;
	/// Minimum time between the end of one command and the start of the next,
	/// for hosts that rate-limit requests ("pace_ms" in session.open).
	std::chrono::milliseconds pace{0};
	std::chrono::steady_clock::time_point last_done{};
	/// A paced command is waiting for its turn.
	bool waiting{};

	// Last member: destroyed first, before the state its callback relies on.
	std::unique_ptr<CFileZillaEngine> engine;
};

}

class Daemon::Impl final
{
public:
	explicit Impl(Output& out)
		: out_(out)
		, context_(options_, encoding_)
	{
		options_.set(OPTION_RECONNECTCOUNT, 0);
		// FTP servers drop idle control connections; NOOPs keep them open.
		options_.set(OPTION_FTP_SENDKEEPALIVE, 1);
	}

	~Impl()
	{
		sessions_.clear();
	}

	void post(std::function<void()> task)
	{
		{
			std::lock_guard<std::mutex> l(mutex_);
			tasks_.push_back(std::move(task));
		}
		cv_.notify_one();
	}

	void post_stop()
	{
		post([this] { stop_ = true; });
	}

	void run()
	{
		// Transfer progress is polled, as the engine only reports it on request.
		std::thread ticker([this] {
			while (!ticker_stop_) {
				std::this_thread::sleep_for(std::chrono::milliseconds(200));
				post([this] { poll_transfers(); });
			}
		});

		while (!stop_) {
			std::function<void()> task;
			{
				std::unique_lock<std::mutex> l(mutex_);
				cv_.wait(l, [this] { return !tasks_.empty(); });
				task = std::move(tasks_.front());
				tasks_.pop_front();
			}
			task();
		}
		ticker_stop_ = true;
		ticker.join();

		// Disconnect cleanly while the dispatcher still runs on this thread.
		sessions_.clear();
	}

	void handle_line(std::string const& line)
	{
		if (line.empty()) {
			return;
		}

		json msg;
		try {
			msg = json::parse(line);
		}
		catch (json::parse_error const&) {
			send_error(nullptr, parse_error, "Parse error");
			return;
		}

		json id = msg.is_object() && msg.contains("id") ? msg["id"] : json();
		if (!msg.is_object() || msg.value("jsonrpc", std::string()) != "2.0" ||
			!msg.contains("method") || !msg["method"].is_string())
		{
			send_error(id, invalid_request, "Invalid request");
			return;
		}

		json params = msg.contains("params") ? msg["params"] : json::object();
		if (!params.is_object()) {
			send_error(id, invalid_params, "Params must be an object");
			return;
		}

		try {
			dispatch(msg["method"].get<std::string>(), id, params);
		}
		catch (RpcError const& e) {
			send_error(id, e.code, e.message, e.data);
		}
		catch (json::exception const& e) {
			send_error(id, invalid_params, e.what());
		}
	}

private:
	void send(json const& msg)
	{
		out_.write_line(msg.dump(-1, ' ', false, json::error_handler_t::replace));
	}

	void send_result(json const& id, json const& result)
	{
		if (!id.is_null()) {
			send(json{{"jsonrpc", "2.0"}, {"id", id}, {"result", result}});
		}
	}

	void send_error(json const& id, int code, std::string const& message, json const& data = json())
	{
		json err{{"code", code}, {"message", message}};
		if (!data.is_null()) {
			err["data"] = data;
		}
		send(json{{"jsonrpc", "2.0"}, {"id", id}, {"error", err}});
	}

	void emit(char const* method, json params)
	{
		send(json{{"jsonrpc", "2.0"}, {"method", method}, {"params", std::move(params)}});
	}

	Session& session(json const& params)
	{
		auto const id = get_int(params, "session", 0);
		auto it = sessions_.find(static_cast<int>(id));
		if (it == sessions_.end()) {
			throw RpcError{unknown_session, "Unknown session"};
		}
		return *it->second;
	}

	void dispatch(std::string const& method, json const& id, json const& params)
	{
		if (method == "daemon.hello") {
			send_result(id, json{
				{"name", "totzillad"},
				{"version", TOTZILLAD_VERSION},
				{"engine", "FileZilla 3.71.1"},
				{"protocol", protocol_version},
			});
		}
		else if (method == "daemon.init") {
			// The data folder comes over JSON (UTF-8) rather than argv, whose
			// encoding on Windows cannot carry every user name.
			auto const dir = get_string(params, "data_dir");
			if (dir.empty()) {
				throw RpcError{invalid_params, "data_dir must not be empty"};
			}
			std::filesystem::path const path(wide(dir));
			std::error_code ec;
			std::filesystem::create_directories(path, ec);
			if (ec) {
				throw RpcError{invalid_params, "Cannot create data_dir: " + ec.message()};
			}
			trust_.open(path / "trust.json");
			data_dir_ = path;
			send_result(id, json::object());
		}
		else if (method == "trust.list") {
			json entries = json::array();
			for (auto const& [key, fingerprint] : trust_.entries()) {
				// key is "<kind>:<host>:<port>"; hosts may contain ':' (IPv6).
				auto const first = key.find(':');
				auto const last = key.rfind(':');
				if (first == std::string::npos || last <= first) {
					continue; // Not written by us; ignore.
				}
				entries.push_back(json{
					{"key", key},
					{"kind", key.substr(0, first)},
					{"host", key.substr(first + 1, last - first - 1)},
					{"port", fz::to_integral<int>(key.substr(last + 1), 0)},
					{"fingerprint", fingerprint},
				});
			}
			send_result(id, json{{"entries", std::move(entries)}});
		}
		else if (method == "trust.forget") {
			if (!trust_.remove(get_string(params, "key"))) {
				throw RpcError{invalid_params, "Unknown trust entry"};
			}
			send_result(id, json::object());
		}
		else if (method == "store.get") {
			auto const file = store_file(params);
			json value;
			std::error_code ec;
			if (std::filesystem::exists(file, ec)) {
				std::ifstream in(file, std::ios::binary);
				try {
					value = json::parse(in);
				}
				catch (json::exception const&) {
					throw RpcError{store_error, "Stored document is damaged: " + get_string(params, "name")};
				}
			}
			send_result(id, json{{"value", value}});
		}
		else if (method == "store.set") {
			auto const file = store_file(params);
			auto v = params.find("value");
			if (v == params.end()) {
				throw RpcError{invalid_params, "Missing parameter: value"};
			}
			auto tmp = file;
			tmp += ".tmp";
			{
				std::ofstream out(tmp, std::ios::binary | std::ios::trunc);
				out << v->dump(2) << '\n';
				if (!out) {
					throw RpcError{store_error, "Cannot write " + get_string(params, "name")};
				}
			}
			std::error_code ec;
			std::filesystem::rename(tmp, file, ec);
			if (ec) {
				throw RpcError{store_error, "Cannot save " + get_string(params, "name") + ": " + ec.message()};
			}
			send_result(id, json::object());
		}
		else if (method == "daemon.shutdown") {
			send_result(id, json::object());
			stop_ = true;
		}
		else if (method == "session.open") {
			open_session(id, params);
		}
		else if (method == "session.close") {
			auto& s = session(params);
			Pending p = make_pending(id, std::make_unique<CDisconnectCommand>());
			p.done = [](Session&, int) { return json::object(); };
			p.close_after = true;
			enqueue(s, std::move(p));
		}
		else if (method == "session.cancel") {
			auto& s = session(params);
			s.engine->Cancel();
			send_result(id, json::object());
		}
		else if (method == "session.cancel_request") {
			cancel_request(id, params);
		}
		else if (method == "remote.list") {
			list(id, params);
		}
		else if (method == "remote.mkdir") {
			auto& s = session(params);
			simple(s, id, std::make_unique<CMkdirCommand>(get_path(params, "path"), transfer_flags::none));
		}
		else if (method == "remote.delete") {
			auto& s = session(params);
			std::vector<std::wstring> names;
			auto v = find(params, "names");
			if (!v || !v->is_array() || v->empty()) {
				throw RpcError{invalid_params, "Missing array parameter: names"};
			}
			for (auto const& n : *v) {
				if (!n.is_string() || n.get<std::string>().empty()) {
					throw RpcError{invalid_params, "names must be non-empty strings"};
				}
				names.push_back(wide(n.get<std::string>()));
			}
			simple(s, id, std::make_unique<CDeleteCommand>(get_path(params, "path"), std::move(names)));
		}
		else if (method == "remote.rmdir") {
			auto& s = session(params);
			simple(s, id, std::make_unique<CRemoveDirCommand>(get_path(params, "path"), wide(get_name(params, "name"))));
		}
		else if (method == "remote.rename") {
			auto& s = session(params);
			simple(s, id, std::make_unique<CRenameCommand>(
				get_path(params, "from_path"), wide(get_name(params, "from_name")),
				get_path(params, "to_path"), wide(get_name(params, "to_name"))));
		}
		else if (method == "remote.chmod") {
			auto& s = session(params);
			simple(s, id, std::make_unique<CChmodCommand>(
				get_path(params, "path"), wide(get_name(params, "name")), wide(get_string(params, "mode"))));
		}
		else if (method == "transfer.upload") {
			upload(id, params);
		}
		else if (method == "transfer.download") {
			download(id, params);
		}
		else if (method == "request.reply") {
			reply_request(id, params);
		}
		else {
			throw RpcError{method_not_found, "Method not found: " + method};
		}
	}

	/// <data_dir>/<name>.json for store.get / store.set; names are [a-z0-9_-].
	std::filesystem::path store_file(json const& params) const
	{
		if (data_dir_.empty()) {
			throw RpcError{store_error, "Call daemon.init first"};
		}
		auto const name = get_string(params, "name");
		bool const ok = !name.empty() && name.size() <= 40 &&
			std::all_of(name.begin(), name.end(), [](char c) { return (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '_' || c == '-'; });
		if (!ok || name == "trust") {
			throw RpcError{invalid_params, "Invalid store name"};
		}
		return data_dir_ / (name + ".json");
	}

	void open_session(json const& id, json const& params)
	{
		auto const protocol = protocol_from_name(get_string(params, "protocol", "sftp"));
		if (protocol == UNKNOWN) {
			throw RpcError{invalid_params, "Unsupported protocol"};
		}
		auto const host = get_string(params, "host");
		auto const port = get_int(params, "port", CServer::GetDefaultPort(protocol));
		if (port < 1 || port > 65535) {
			throw RpcError{invalid_params, "Invalid port"};
		}

		CServer server(protocol, UNIX, wide(host), static_cast<unsigned int>(port));
		if (!server.SetHost(wide(host), static_cast<unsigned int>(port))) {
			throw RpcError{invalid_params, "Invalid host"};
		}
		auto const user = get_string(params, "user", "");
		server.SetUser(wide(user));

		Credentials credentials;
		auto const keyfile = get_string(params, "keyfile", "");
		if (!keyfile.empty()) {
			credentials.logonType_ = LogonType::key;
			credentials.keyFile_ = wide(keyfile);
		}
		else if (user.empty() && protocol != SFTP) {
			credentials.logonType_ = LogonType::anonymous;
		}
		else {
			credentials.logonType_ = LogonType::normal;
			credentials.SetPass(wide(get_string(params, "password", "")));
		}

		auto const pace = get_int(params, "pace_ms", 0);
		if (pace < 0 || pace > 10000) {
			throw RpcError{invalid_params, "pace_ms must be between 0 and 10000"};
		}
		auto const timeout = get_int(params, "timeout", 0);
		if (timeout > 0) {
			// Engine-wide setting; the last session to set it wins.
			options_.set(OPTION_TIMEOUT, static_cast<int>(timeout));
		}

		int const sid = next_session_++;
		auto s = std::make_unique<Session>();
		s->id = sid;
		s->pace = std::chrono::milliseconds(pace);
		s->engine = std::make_unique<CFileZillaEngine>(context_, [this, sid](CFileZillaEngine*) {
			post([this, sid] { drain(sid); });
		});

		Pending p = make_pending(id, std::make_unique<CConnectCommand>(server, s->handle, credentials, false));
		p.done = [](Session& s, int reply) {
			require_ok(reply);
			return json{{"session", s.id}};
		};
		p.close_on_error = true;

		auto& ref = *s;
		sessions_.emplace(sid, std::move(s));
		enqueue(ref, std::move(p));
	}

	void list(json const& id, json const& params)
	{
		auto& s = session(params);
		int const flags = get_bool(params, "refresh", true) ? LIST_FLAG_REFRESH : 0;
		std::unique_ptr<CListCommand> cmd;
		if (find(params, "path")) {
			cmd = std::make_unique<CListCommand>(get_path(params, "path"), std::wstring(), flags);
		}
		else {
			cmd = std::make_unique<CListCommand>(flags);
		}

		Pending p = make_pending(id, std::move(cmd));
		p.before = [](Session& s) { s.last_listing.clear(); };
		p.done = [](Session& s, int reply) {
			require_ok(reply);
			CDirectoryListing listing;
			if (s.last_listing.empty() || s.engine->CacheLookup(s.last_listing, listing) != FZ_REPLY_OK) {
				throw RpcError{engine_error, "Listing not available"};
			}
			json entries = json::array();
			for (size_t i = 0; i < listing.size(); ++i) {
				entries.push_back(entry_json(listing[i]));
			}
			return json{{"path", u8(s.last_listing.GetPath())}, {"entries", std::move(entries)}};
		};
		enqueue(s, std::move(p));
	}

	/// Cancels one earlier request by its JSON-RPC id: the running command is
	/// aborted by the engine, a queued one is dropped before it starts. Either
	/// way that request then fails with flag "canceled".
	void cancel_request(json const& id, json const& params)
	{
		auto& s = session(params);
		auto it = params.find("id");
		if (it == params.end() || it->is_null()) {
			throw RpcError{invalid_params, "Missing parameter: id"};
		}
		json const& target = *it;

		if (s.current && s.current->id == target) {
			s.engine->Cancel();
			send_result(id, json{{"state", "running"}});
			return;
		}
		for (auto q = s.queue.begin(); q != s.queue.end(); ++q) {
			if (q->id == target) {
				json const dropped = q->id;
				s.queue.erase(q);
				send_error(dropped, engine_error, "Operation canceled",
					json{{"reply", FZ_REPLY_CANCELED}, {"flags", reply_flags(FZ_REPLY_CANCELED)}});
				send_result(id, json{{"state", "queued"}});
				return;
			}
		}
		throw RpcError{unknown_request, "No such running or queued request"};
	}

	std::optional<CFileExistsNotification::OverwriteAction> exists_param(json const& params)
	{
		auto const name = get_string(params, "exists", "ask");
		if (name == "ask") {
			return std::nullopt;
		}
		auto const action = overwrite_action(name);
		if (action == CFileExistsNotification::rename) {
			throw RpcError{invalid_params, "exists: rename needs a name; answer the request instead"};
		}
		return action;
	}

	void upload(json const& id, json const& params)
	{
		auto& s = session(params);
		auto const local = wide(get_string(params, "local"));
		int64_t const size = fz::local_filesys::get_size(fz::to_native(local));
		if (size < 0) {
			throw RpcError{invalid_params, "Local file not found"};
		}
		auto const remote_path = get_path(params, "remote_path");
		auto const name = find(params, "remote_name") ? wide(get_name(params, "remote_name")) : base_name(local);

		auto cmd = std::make_unique<CFileTransferCommand>(fz::file_reader_factory(local, context_.GetThreadPool()),
			remote_path, name, transfer_flags::none);
		if (!cmd->valid()) {
			throw RpcError{invalid_params, "Invalid transfer parameters"};
		}
		Pending p = make_pending(id, std::move(cmd));
		p.transfer = true;
		p.exists_action = exists_param(params);
		p.done = [size](Session&, int reply) {
			require_ok(reply);
			return json{{"size", size}};
		};
		enqueue(s, std::move(p));
	}

	void download(json const& id, json const& params)
	{
		auto& s = session(params);
		auto const local = wide(get_string(params, "local"));
		if (local.empty() || base_name(local).empty()) {
			throw RpcError{invalid_params, "Invalid local file name"};
		}

		auto cmd = std::make_unique<CFileTransferCommand>(fz::file_writer_factory(local, context_.GetThreadPool()),
			get_path(params, "remote_path"), wide(get_name(params, "remote_name")), transfer_flags::download);
		if (!cmd->valid()) {
			throw RpcError{invalid_params, "Invalid transfer parameters"};
		}
		Pending p = make_pending(id, std::move(cmd));
		p.transfer = true;
		p.exists_action = exists_param(params);
		p.done = [local](Session&, int reply) {
			require_ok(reply);
			return json{{"size", fz::local_filesys::get_size(fz::to_native(local))}};
		};
		enqueue(s, std::move(p));
	}

	void poll_transfers()
	{
		for (auto& entry : sessions_) {
			auto& s = *entry.second;
			if (s.running && s.current && s.current->transfer) {
				bool changed{};
				auto const status = s.engine->GetTransferStatus(changed);
				if (changed) {
					report_progress(s, status);
				}
			}
		}
	}

	void report_progress(Session& s, CTransferStatus const& status)
	{
		if (!s.current || !s.current->transfer || status.empty()) {
			return;
		}
		emit("transfer.progress", json{
			{"session", s.id},
			{"id", s.current->id},
			{"offset", status.currentOffset},
			{"start", status.startOffset},
			{"total", status.totalSize},
		});
	}

	void simple(Session& s, json const& id, std::unique_ptr<CCommand> cmd)
	{
		if (!cmd->valid()) {
			throw RpcError{invalid_params, "Invalid command parameters"};
		}
		Pending p = make_pending(id, std::move(cmd));
		p.done = [](Session&, int reply) {
			require_ok(reply);
			return json::object();
		};
		enqueue(s, std::move(p));
	}

	void enqueue(Session& s, Pending p)
	{
		if (s.closing) {
			throw RpcError{session_closing, "Session is closing"};
		}
		s.queue.push_back(std::move(p));
		start_next(s);
	}

	void start_next(Session& s)
	{
		while (!s.running && !s.current && !s.waiting && !s.queue.empty()) {
			if (s.pace.count() > 0) {
				auto const due = s.last_done + s.pace;
				auto const now = std::chrono::steady_clock::now();
				if (now < due) {
					s.waiting = true;
					int const sid = s.id;
					std::thread([this, sid, wait = due - now] {
						std::this_thread::sleep_for(wait);
						post([this, sid] {
							auto it = sessions_.find(sid);
							if (it != sessions_.end()) {
								it->second->waiting = false;
								start_next(*it->second);
							}
						});
					}).detach();
					return;
				}
			}
			s.current = std::move(s.queue.front());
			s.queue.pop_front();
			if (s.current->before) {
				s.current->before(s);
			}
			int const res = s.engine->Execute(*s.current->command);
			if (res == FZ_REPLY_WOULDBLOCK) {
				s.running = true;
				return;
			}
			if (finish(s, res)) {
				return;
			}
		}
	}

	// Answers the current command. Returns true if the session is being closed.
	bool finish(Session& s, int reply)
	{
		s.last_done = std::chrono::steady_clock::now();
		Pending p = std::move(*s.current);
		s.current.reset();
		s.running = false;

		try {
			json result = p.done(s, reply);
			if (p.transfer && result.is_object()) {
				result["skipped"] = p.skipped;
			}
			send_result(p.id, result);
		}
		catch (RpcError const& e) {
			send_error(p.id, e.code, e.message, e.data);
		}

		if ((reply & FZ_REPLY_DISCONNECTED) == FZ_REPLY_DISCONNECTED && !p.close_after) {
			emit("session.disconnected", json{{"session", s.id}});
		}

		if (p.close_after || (reply != FZ_REPLY_OK && p.close_on_error)) {
			s.closing = true;
			int const sid = s.id;
			post([this, sid] { close_session(sid); });
			return true;
		}
		return false;
	}

	void close_session(int sid)
	{
		auto it = sessions_.find(sid);
		if (it == sessions_.end()) {
			return;
		}
		for (auto& p : it->second->queue) {
			send_error(p.id, session_closing, "Session closed");
		}
		sessions_.erase(it);
		emit("session.closed", json{{"session", sid}});
	}

	void drain(int sid)
	{
		auto it = sessions_.find(sid);
		if (it == sessions_.end()) {
			return;
		}
		auto& s = *it->second;

		while (auto n = s.engine->GetNextNotification()) {
			switch (n->GetID()) {
			case nId_logmsg: {
				auto const& msg = static_cast<CLogmsgNotification const&>(*n);
				emit("log", json{{"session", sid}, {"level", log_level(msg.msgType)}, {"message", u8(msg.msg)}});
				break;
			}
			case nId_operation: {
				auto const& op = static_cast<COperationNotification const&>(*n);
				if (s.current && s.running) {
					if (finish(s, op.replyCode_)) {
						return;
					}
					start_next(s);
				}
				break;
			}
			case nId_transferstatus: {
				auto const& ts = static_cast<CTransferStatusNotification const&>(*n);
				report_progress(s, ts.GetStatus());
				break;
			}
			case nId_listing: {
				auto const& listing = static_cast<CDirectoryListingNotification const&>(*n);
				if (listing.Primary() && !listing.Failed()) {
					s.last_listing = listing.GetPath();
				}
				break;
			}
			case nId_asyncrequest: {
				std::unique_ptr<CAsyncRequestNotification> req(static_cast<CAsyncRequestNotification*>(n.release()));
				if (req->GetRequestID() == reqId_fileexists && s.current && s.current->exists_action) {
					auto& fe = static_cast<CFileExistsNotification&>(*req);
					fe.overwriteAction = *s.current->exists_action;
					s.current->skipped = will_skip(fe);
					s.engine->SetAsyncRequestReply(std::move(req));
					break;
				}
				// Known host keys and certificates need no question. A stored
				// fingerprint that no longer matches is reported as "changed".
				std::optional<std::string> previous;
				if (req->GetRequestID() == reqId_insecure_connection) {
					// "Do not ask again for this server" was chosen before.
					auto& r = static_cast<CInsecureConnectionNotification&>(*req);
					if (trust_.get(TrustStore::key("plain", u8(r.server_.GetHost()), r.server_.GetPort())) == std::string("allow")) {
						r.allow_ = true;
						s.engine->SetAsyncRequestReply(std::move(req));
						break;
					}
				}
				if (req->GetRequestID() == reqId_hostkey) {
					auto& r = static_cast<CHostKeyNotification&>(*req);
					auto const fingerprint = r.hostkey_ ? r.hostkey_->fingerprint() : std::string();
					previous = trust_.get(TrustStore::key("ssh", u8(r.server_.GetHost()), r.server_.GetPort()));
					if (previous && !fingerprint.empty() && *previous == fingerprint) {
						r.trust_ = true;
						s.engine->SetAsyncRequestReply(std::move(req));
						break;
					}
				}
				if (req->GetRequestID() == reqId_certificate) {
					// Also trusted: what the OS trusts for this host name, and what
					// the user trusted earlier in this session.
					auto& cert = static_cast<CCertificateNotification&>(*req);
					auto const& info = cert.info_;
					bool const os_trusted = info.system_trust() && !info.mismatched_hostname();
					auto const fingerprint = leaf_fingerprint(info);
					previous = trust_.get(TrustStore::key("tls", info.get_host(), info.get_port()));
					bool const known = !fingerprint.empty() && (s.trusted_certs.count(fingerprint) || previous == fingerprint);
					if (os_trusted || known) {
						cert.trusted_ = true;
						s.engine->SetAsyncRequestReply(std::move(req));
						break;
					}
				}
				json ev = describe_request(*req);
				if (ev.is_object() && (req->GetRequestID() == reqId_hostkey || req->GetRequestID() == reqId_certificate)) {
					ev["changed"] = previous.has_value();
					if (previous) {
						ev["previous"] = *previous;
					}
				}
				if (ev.is_object() && s.current) {
					ev["id"] = s.current->id;
				}
				if (ev.is_null()) {
					// Not supported yet: the request's defaults decline it.
					s.engine->SetAsyncRequestReply(std::move(req));
					break;
				}
				int const rid = s.next_request++;
				ev["session"] = sid;
				ev["request"] = rid;
				s.requests[rid] = std::move(req);
				emit("request", std::move(ev));
				break;
			}
			default:
				break;
			}
		}
	}

	json describe_request(CAsyncRequestNotification& req)
	{
		switch (req.GetRequestID()) {
		case reqId_hostkey: {
			auto& r = static_cast<CHostKeyNotification&>(req);
			json ev{
				{"type", "hostkey"},
				{"host", u8(r.server_.GetHost())},
				{"port", r.server_.GetPort()},
			};
			if (r.hostkey_) {
				ev["fingerprint"] = r.hostkey_->fingerprint(); // "SHA256:<base64>"
				ev["key"] = r.hostkey_->openssh_pubkey();
			}
			return ev;
		}
		case reqId_fileexists: {
			auto& r = static_cast<CFileExistsNotification&>(req);
			return json{
				{"type", "file_exists"},
				{"download", r.download},
				{"local_file", u8(r.localFile)},
				{"local_size", r.localSize},
				{"remote_path", u8(r.remotePath.GetPath())},
				{"remote_file", u8(r.remoteFile)},
				{"remote_size", r.remoteSize},
			};
		}
		case reqId_password:
			return json{{"type", "password"}};
		case reqId_interactiveLogin: {
			auto& r = static_cast<CInteractiveLoginNotification&>(req);
			json prompts = json::array();
			for (auto const& p : r.prompts_) {
				prompts.push_back(json{{"prompt", p.prompt_}, {"echo", p.echo_}});
			}
			return json{{"type", "interactive"}, {"name", r.name_}, {"instruction", r.instruction_}, {"prompts", prompts}};
		}
		case reqId_keyfile_password: {
			auto& r = static_cast<KeyfilePasswordRequest&>(req);
			return json{{"type", "keyfile_password"}, {"file", r.file_}, {"fingerprint", r.fingerprint_}, {"repeated", r.repeated_}};
		}
		case reqId_otp:
			return json{{"type", "otp"}};
		case reqId_insecure_connection: {
			auto& r = static_cast<CInsecureConnectionNotification&>(req);
			return json{{"type", "insecure_connection"}, {"host", u8(r.server_.GetHost())}, {"port", r.server_.GetPort()}};
		}
		case reqId_certificate: {
			auto const& info = static_cast<CCertificateNotification&>(req).info_;
			json certs = json::array();
			for (auto const& c : info.get_certificates()) {
				json names = json::array();
				for (auto const& n : c.get_alt_subject_names()) {
					names.push_back(n.name);
				}
				certs.push_back(json{
					{"subject", c.get_subject()},
					{"issuer", c.get_issuer()},
					{"alt_names", std::move(names)},
					{"fingerprint_sha256", c.get_fingerprint_sha256()},
					{"serial", c.get_serial()},
					{"valid_from", c.get_activation_time().format("%Y-%m-%dT%H:%M:%SZ", fz::datetime::utc)},
					{"valid_until", c.get_expiration_time().format("%Y-%m-%dT%H:%M:%SZ", fz::datetime::utc)},
					{"key", c.get_pubkey_algorithm() + " " + std::to_string(c.get_pubkey_bits())},
					{"signature", c.get_signature_algorithm()},
					{"self_signed", c.self_signed()},
				});
			}
			return json{
				{"type", "certificate"},
				{"host", info.get_host()},
				{"port", info.get_port()},
				{"tls", info.get_protocol()},
				{"cipher", info.get_session_cipher()},
				{"system_trust", info.system_trust()},
				{"hostname_mismatch", info.mismatched_hostname()},
				{"weak_algorithms", info.get_algorithm_warnings() != 0},
				{"certificates", std::move(certs)},
			};
		}
		case reqId_tls_no_resumption: {
			auto& r = static_cast<FtpTlsNoResumptionNotification&>(req);
			return json{{"type", "tls_no_resumption"}, {"host", u8(r.server_.GetHost())}, {"port", r.server_.GetPort()}};
		}
		default:
			return json();
		}
	}

	void reply_request(json const& id, json const& params)
	{
		auto& s = session(params);
		auto it = s.requests.find(static_cast<int>(get_int(params, "request", 0)));
		if (it == s.requests.end()) {
			throw RpcError{unknown_request, "Unknown request"};
		}
		auto& req = *it->second;

		switch (req.GetRequestID()) {
		case reqId_hostkey: {
			auto& r = static_cast<CHostKeyNotification&>(req);
			r.trust_ = get_bool(params, "trust", false);
			if (r.trust_ && get_bool(params, "remember", false) && r.hostkey_) {
				trust_.set(TrustStore::key("ssh", u8(r.server_.GetHost()), r.server_.GetPort()), r.hostkey_->fingerprint());
			}
			break;
		}
		case reqId_fileexists: {
			auto& r = static_cast<CFileExistsNotification&>(req);
			r.overwriteAction = overwrite_action(get_string(params, "action", "skip"));
			if (r.overwriteAction == CFileExistsNotification::rename) {
				r.newName = wide(get_name(params, "new_name"));
			}
			if (s.current) {
				s.current->skipped = will_skip(r);
			}
			break;
		}
		case reqId_password: {
			auto& r = static_cast<PasswordRequest&>(req);
			if (find(params, "password")) {
				r.password_ = wide(get_string(params, "password"));
			}
			break;
		}
		case reqId_interactiveLogin: {
			auto& r = static_cast<CInteractiveLoginNotification&>(req);
			if (auto v = find(params, "responses")) {
				r.responses_ = v->get<std::vector<std::string>>();
			}
			break;
		}
		case reqId_keyfile_password: {
			auto& r = static_cast<KeyfilePasswordRequest&>(req);
			if (find(params, "password")) {
				r.password_ = get_string(params, "password");
			}
			break;
		}
		case reqId_otp:
			static_cast<OtpRequest&>(req).otp_ = get_string(params, "otp", "");
			break;
		case reqId_insecure_connection: {
			auto& r = static_cast<CInsecureConnectionNotification&>(req);
			r.allow_ = get_bool(params, "allow", false);
			if (r.allow_ && get_bool(params, "remember", false)) {
				trust_.set(TrustStore::key("plain", u8(r.server_.GetHost()), r.server_.GetPort()), "allow");
			}
			break;
		}
		case reqId_certificate: {
			auto& r = static_cast<CCertificateNotification&>(req);
			r.trusted_ = get_bool(params, "trust", false);
			if (r.trusted_) {
				auto const fingerprint = leaf_fingerprint(r.info_);
				s.trusted_certs.insert(fingerprint);
				if (get_bool(params, "remember", false) && !fingerprint.empty()) {
					trust_.set(TrustStore::key("tls", r.info_.get_host(), r.info_.get_port()), fingerprint);
				}
			}
			break;
		}
		case reqId_tls_no_resumption:
			static_cast<FtpTlsNoResumptionNotification&>(req).allow_ = get_bool(params, "allow", false);
			break;
		default:
			break;
		}

		auto owned = std::move(it->second);
		s.requests.erase(it);
		s.engine->SetAsyncRequestReply(std::move(owned));
		send_result(id, json::object());
	}

	Output& out_;

	std::mutex mutex_;
	std::condition_variable cv_;
	std::deque<std::function<void()>> tasks_;
	bool stop_{};
	std::atomic<bool> ticker_stop_{};

	Options options_;
	Utf8Encoding encoding_;
	CFileZillaEngineContext context_;
	TrustStore trust_;
	std::filesystem::path data_dir_;

	int next_session_{1};
	std::map<int, std::unique_ptr<Session>> sessions_;
};

Daemon::Daemon(Output& out)
	: impl_(std::make_unique<Impl>(out))
{
}

Daemon::~Daemon() = default;

void Daemon::post_line(std::string line)
{
	auto* impl = impl_.get();
	impl->post([impl, line = std::move(line)] { impl->handle_line(line); });
}

void Daemon::post_stop()
{
	impl_->post_stop();
}

void Daemon::run()
{
	impl_->run();
}

}
