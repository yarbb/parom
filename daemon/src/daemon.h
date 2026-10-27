// paromd: wraps the FileZilla engine and serves JSON-RPC 2.0 over stdio.
//
// Copyright (C) Parom contributors
// SPDX-License-Identifier: GPL-3.0-or-later

#ifndef PAROMD_DAEMON_HEADER
#define PAROMD_DAEMON_HEADER

#include <functional>
#include <memory>
#include <string>

#ifndef PAROMD_VERSION
#define PAROMD_VERSION "0.0.0-dev"
#endif

namespace paromd {

// Writes one JSON message per line. Thread-safe.
class Output
{
public:
	virtual ~Output() = default;
	virtual void write_line(std::string const& line) = 0;
};

class Daemon final
{
public:
	explicit Daemon(Output& out);
	~Daemon();

	Daemon(Daemon const&) = delete;
	Daemon& operator=(Daemon const&) = delete;

	// Queues a raw JSON-RPC line read from the client. Thread-safe.
	void post_line(std::string line);

	// Asks run() to return once queued work is done. Thread-safe.
	void post_stop();

	// Processes requests and engine notifications on the calling thread
	// until post_stop() or daemon.shutdown.
	void run();

private:
	class Impl;
	std::unique_ptr<Impl> impl_;
};

}

#endif
