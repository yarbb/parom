// M0b spike: drive the FileZilla engine from a console program.
// Connects over SFTP, lists a directory and optionally uploads one file,
// then re-lists the target directory to check the uploaded size.
//
// Copyright (C) TOTzilla contributors
// SPDX-License-Identifier: GPL-3.0-or-later

#include "FileZillaEngine.h"
#include "directorylisting.h"
#include "engine_context.h"
#include "engine_options.h"

#include <libfilezilla/aio/reader.hpp>
#include <libfilezilla/local_filesys.hpp>
#include <libfilezilla/string.hpp>

#include <chrono>
#include <condition_variable>
#include <cstdlib>
#include <iostream>
#include <memory>
#include <mutex>
#include <string>
#include <vector>

namespace {

// The engine reads its settings through COptionsBase. Defaults are filled in
// lazily from the engine's option registry, so nothing needs to be loaded.
class SpikeOptions final : public COptionsBase
{
protected:
	// Change notifications are only needed by a UI; can_notify_ stays false.
	void notify_changed() override {}
};

// Only used for servers with ENCODING_CUSTOM, which the spike never sets.
class Utf8Encoding final : public CustomEncodingConverterBase
{
public:
	std::wstring toLocal(std::wstring const&, char const* buffer, size_t len) const override
	{
		return fz::to_wstring_from_utf8(std::string_view(buffer, len));
	}

	std::string toServer(std::wstring const&, wchar_t const* buffer, size_t len) const override
	{
		return fz::to_utf8(std::wstring_view(buffer, len));
	}
};

struct SpikeHandle final : public ServerHandleData
{
};

struct Args
{
	std::wstring host;
	unsigned int port{22};
	std::wstring user;
	std::wstring password; // from the TOTZILLA_PASSWORD environment variable
	std::wstring keyfile;
	std::wstring list_path; // empty: the login directory
	std::wstring upload_file;
	std::wstring upload_dir; // empty: the listed directory
	bool trust_hostkey{};
	int timeout{60};
};

void print(std::wstring const& s)
{
	std::cout << fz::to_utf8(s) << std::endl;
}

char const* log_prefix(logmsg::type t)
{
	switch (t) {
	case logmsg::error:
		return "[error] ";
	case logmsg::command:
		return "[command] ";
	case logmsg::reply:
		return "[reply] ";
	case logmsg::status:
		return "[status] ";
	default:
		return "[debug] ";
	}
}

class Session final
{
public:
	Session(CFileZillaEngineContext& context, Args const& args)
		: args_(args)
		, engine_(context, [this](CFileZillaEngine*) { signal(); })
	{
	}

	// Executes a command and waits for its final reply code.
	int run(CCommand const& command)
	{
		int res = engine_.Execute(command);
		if (res != FZ_REPLY_WOULDBLOCK) {
			drain(res);
			return res;
		}

		auto const deadline = std::chrono::steady_clock::now() + std::chrono::seconds(args_.timeout + 30);
		bool canceled = false;
		while (true) {
			if (!wait(deadline) && !canceled) {
				std::cout << "[spike] operation timed out, canceling" << std::endl;
				engine_.Cancel();
				canceled = true;
			}
			int reply{};
			if (drain(reply)) {
				return reply;
			}
			if (canceled && std::chrono::steady_clock::now() > deadline + std::chrono::seconds(10)) {
				return FZ_REPLY_TIMEOUT;
			}
		}
	}

	CFileZillaEngine& engine() { return engine_; }
	CServerPath const& last_listing_path() const { return last_listing_path_; }

private:
	void signal()
	{
		{
			std::lock_guard<std::mutex> l(mutex_);
			pending_ = true;
		}
		cv_.notify_one();
	}

	bool wait(std::chrono::steady_clock::time_point deadline)
	{
		std::unique_lock<std::mutex> l(mutex_);
		bool const signaled = cv_.wait_until(l, deadline, [this] { return pending_; });
		pending_ = false;
		return signaled;
	}

	// Processes all pending notifications. Returns true once the current
	// operation has finished, with its reply code in reply.
	bool drain(int& reply)
	{
		bool done = false;
		while (auto n = engine_.GetNextNotification()) {
			switch (n->GetID()) {
			case nId_logmsg: {
				auto const& msg = static_cast<CLogmsgNotification const&>(*n);
				std::cout << log_prefix(msg.msgType) << fz::to_utf8(msg.msg) << std::endl;
				break;
			}
			case nId_operation: {
				auto const& op = static_cast<COperationNotification const&>(*n);
				reply = op.replyCode_;
				done = true;
				break;
			}
			case nId_listing: {
				auto const& listing = static_cast<CDirectoryListingNotification const&>(*n);
				if (listing.Primary() && !listing.Failed()) {
					last_listing_path_ = listing.GetPath();
				}
				break;
			}
			case nId_sftp_encryption: {
				auto const& enc = static_cast<CSftpEncryptionNotification const&>(*n);
				std::cout << "[spike] host key fingerprint: " << enc.hostkey_fingerprint_ << std::endl;
				break;
			}
			case nId_asyncrequest: {
				std::unique_ptr<CAsyncRequestNotification> req(static_cast<CAsyncRequestNotification*>(n.release()));
				answer(*req);
				engine_.SetAsyncRequestReply(std::move(req));
				break;
			}
			default:
				break;
			}
		}
		return done;
	}

	void answer(CAsyncRequestNotification& req)
	{
		switch (req.GetRequestID()) {
		case reqId_hostkey: {
			auto& r = static_cast<CHostKeyNotification&>(req);
			r.trust_ = args_.trust_hostkey;
			if (!r.trust_) {
				std::cout << "[spike] unknown host key rejected; pass --trust-hostkey to accept it" << std::endl;
			}
			break;
		}
		case reqId_fileexists: {
			auto& r = static_cast<CFileExistsNotification&>(req);
			r.overwriteAction = CFileExistsNotification::overwrite;
			break;
		}
		case reqId_password: {
			auto& r = static_cast<PasswordRequest&>(req);
			r.password_ = args_.password;
			break;
		}
		case reqId_interactiveLogin: {
			auto& r = static_cast<CInteractiveLoginNotification&>(req);
			r.responses_ = std::vector<std::string>(r.prompts_.size(), fz::to_utf8(args_.password));
			break;
		}
		default:
			// Everything else (certificates, insecure FTP, OTP, key passphrases)
			// is declined: the defaults of the request objects mean "no".
			std::cout << "[spike] declined async request " << static_cast<int>(req.GetRequestID()) << std::endl;
			break;
		}
	}

	Args const& args_;

	std::mutex mutex_;
	std::condition_variable cv_;
	bool pending_{};

	CServerPath last_listing_path_;

	// Last member: its callback uses the members above.
	CFileZillaEngine engine_;
};

void usage()
{
	std::cerr <<
		"Usage: fzspike --host HOST --user USER [options]\n"
		"  --port N            SFTP port (default 22)\n"
		"  --key FILE          private key file (otherwise password auth)\n"
		"  --list PATH         directory to list (default: login directory)\n"
		"  --upload FILE       local file to upload\n"
		"  --to DIR            remote directory for the upload (default: listed directory)\n"
		"  --trust-hostkey     accept the server's host key\n"
		"  --timeout SECONDS   engine timeout (default 60)\n"
		"The password is read from the TOTZILLA_PASSWORD environment variable.\n";
}

bool parse_args(int argc, char** argv, Args& args)
{
	for (int i = 1; i < argc; ++i) {
		std::string const a = argv[i];
		auto value = [&](std::wstring& out) {
			if (i + 1 >= argc) {
				return false;
			}
			out = fz::to_wstring(std::string(argv[++i]));
			return true;
		};
		std::wstring v;
		if (a == "--host") {
			if (!value(args.host)) return false;
		}
		else if (a == "--user") {
			if (!value(args.user)) return false;
		}
		else if (a == "--port") {
			if (!value(v)) return false;
			args.port = fz::to_integral<unsigned int>(v);
		}
		else if (a == "--key") {
			if (!value(args.keyfile)) return false;
		}
		else if (a == "--list") {
			if (!value(args.list_path)) return false;
		}
		else if (a == "--upload") {
			if (!value(args.upload_file)) return false;
		}
		else if (a == "--to") {
			if (!value(args.upload_dir)) return false;
		}
		else if (a == "--timeout") {
			if (!value(v)) return false;
			args.timeout = fz::to_integral<int>(v, 60);
		}
		else if (a == "--trust-hostkey") {
			args.trust_hostkey = true;
		}
		else {
			return false;
		}
	}
	if (char const* pw = std::getenv("TOTZILLA_PASSWORD")) {
		args.password = fz::to_wstring(std::string(pw));
	}
	return !args.host.empty() && !args.user.empty() && args.port > 0 && args.port < 65536;
}

std::wstring base_name(std::wstring const& path)
{
	auto const pos = path.find_last_of(L"/\\");
	return pos == std::wstring::npos ? path : path.substr(pos + 1);
}

bool print_listing(CFileZillaEngine& engine, CServerPath const& path)
{
	CDirectoryListing listing;
	if (engine.CacheLookup(path, listing) != FZ_REPLY_OK) {
		print(L"[spike] listing not in cache: " + path.GetPath());
		return false;
	}
	print(L"[spike] listing of " + path.GetPath() + L" (" + std::to_wstring(listing.size()) + L" entries)");
	for (size_t i = 0; i < listing.size(); ++i) {
		auto const& e = listing[i];
		print(std::wstring(e.is_dir() ? L"d " : L"- ") + std::to_wstring(e.size) + L"\t" + e.name);
	}
	return true;
}

int run(Args const& args)
{
	SpikeOptions options;
	options.set(OPTION_TIMEOUT, args.timeout);
	options.set(OPTION_RECONNECTCOUNT, 0);
	Utf8Encoding encoding;
	CFileZillaEngineContext context(options, encoding);
	Session session(context, args);

	CServer server(SFTP, UNIX, args.host, args.port);
	server.SetUser(args.user);
	Credentials credentials;
	if (!args.keyfile.empty()) {
		credentials.logonType_ = LogonType::key;
		credentials.keyFile_ = args.keyfile;
	}
	else {
		credentials.logonType_ = LogonType::normal;
		credentials.SetPass(args.password);
	}
	auto handle = std::make_shared<SpikeHandle>();

	int res = session.run(CConnectCommand(server, handle, credentials, false));
	if (res != FZ_REPLY_OK) {
		std::cout << "[spike] connect failed, reply 0x" << std::hex << res << std::endl;
		return 1;
	}
	std::cout << "[spike] connected" << std::endl;

	res = args.list_path.empty()
		? session.run(CListCommand(LIST_FLAG_REFRESH))
		: session.run(CListCommand(CServerPath(args.list_path), std::wstring(), LIST_FLAG_REFRESH));
	if (res != FZ_REPLY_OK || session.last_listing_path().empty()) {
		std::cout << "[spike] list failed, reply 0x" << std::hex << res << std::endl;
		return 1;
	}
	CServerPath const listed = session.last_listing_path();
	if (!print_listing(session.engine(), listed)) {
		return 1;
	}

	if (!args.upload_file.empty()) {
		CServerPath const dir = args.upload_dir.empty() ? listed : CServerPath(args.upload_dir);
		std::wstring const name = base_name(args.upload_file);
		int64_t const local_size = fz::local_filesys::get_size(fz::to_native(args.upload_file));
		if (local_size < 0) {
			print(L"[spike] cannot read local file " + args.upload_file);
			return 1;
		}

		res = session.run(CFileTransferCommand(fz::file_reader_factory(args.upload_file, context.GetThreadPool()),
			dir, name, transfer_flags::none));
		if (res != FZ_REPLY_OK) {
			std::cout << "[spike] upload failed, reply 0x" << std::hex << res << std::endl;
			return 1;
		}

		res = session.run(CListCommand(dir, std::wstring(), LIST_FLAG_REFRESH));
		CDirectoryListing listing;
		if (res != FZ_REPLY_OK || session.engine().CacheLookup(dir, listing) != FZ_REPLY_OK) {
			std::cout << "[spike] re-list after upload failed" << std::endl;
			return 1;
		}
		size_t const idx = listing.FindFile_CmpCase(name);
		if (idx == static_cast<size_t>(-1) || listing[idx].size != local_size) {
			print(L"[spike] uploaded file missing or size differs: " + name);
			return 1;
		}
		print(L"[spike] upload verified: " + dir.FormatFilename(name) + L" (" + std::to_wstring(local_size) + L" bytes)");
	}

	session.run(CDisconnectCommand());
	std::cout << "[spike] done" << std::endl;
	return 0;
}

} // namespace

int main(int argc, char** argv)
{
	Args args;
	if (!parse_args(argc, argv, args)) {
		usage();
		return 2;
	}
	return run(args);
}
