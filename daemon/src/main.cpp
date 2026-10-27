// paromd entry point: JSON-RPC 2.0, one message per line on stdin/stdout.
// Diagnostics go to stderr; stdout carries protocol messages only.
//
// Copyright (C) Parom contributors
// SPDX-License-Identifier: GPL-3.0-or-later

#include "daemon.h"

#include <cstdlib>
#include <iostream>
#include <mutex>
#include <string>
#include <thread>

namespace {

class StdoutOutput final : public paromd::Output
{
public:
	void write_line(std::string const& line) override
	{
		std::lock_guard<std::mutex> l(mutex_);
		std::cout << line << '\n';
		std::cout.flush();
	}

private:
	std::mutex mutex_;
};

}

int main(int argc, char** argv)
{
	for (int i = 1; i < argc; ++i) {
		std::string const arg = argv[i];
		if (arg == "--version") {
			std::cout << "paromd " PAROMD_VERSION "\n";
			return 0;
		}
		std::cerr << "Usage: paromd [--version]\n"
			"Speaks JSON-RPC 2.0 over stdin/stdout, one message per line.\n";
		return 2;
	}

	std::ios::sync_with_stdio(false);

	StdoutOutput out;
	paromd::Daemon daemon(out);

	// Reads requests until EOF; the client closing stdin shuts the daemon down.
	std::thread reader([&daemon] {
		std::string line;
		while (std::getline(std::cin, line)) {
			if (!line.empty() && line.back() == '\r') {
				line.pop_back();
			}
			daemon.post_line(std::move(line));
		}
		daemon.post_stop();
	});
	reader.detach();

	daemon.run();

	// The reader thread may still be blocked in getline and cannot be woken
	// portably, so skip destructors that would race with it. Sessions are
	// already closed by run().
	std::cout.flush();
	std::_Exit(0);
}
