#!/bin/sh
# Builds totzillad against an already built FileZilla engine (MSYS2 UCRT64 or Linux).
# Usage: daemon/build.sh FZ_SRC FZ_BUILD OUT_DIR [VERSION]
#   FZ_SRC    extracted FileZilla source tree
#   FZ_BUILD  FileZilla build directory (contains src/engine/.libs)
set -eu

fz_src=$1
fz_build=$2
out=$3
version=${4:-0.0.0-dev}
here=$(cd "$(dirname "$0")" && pwd)

mkdir -p "$out"
${CXX:-g++} -std=c++17 -O2 -Wall -Wextra \
	-DTOTZILLAD_VERSION="\"$version\"" \
	-I"$fz_src/src/include" \
	$(pkg-config --cflags libfilezilla libfzssh-client nlohmann_json) \
	"$here/src/main.cpp" "$here/src/daemon.cpp" "$here/src/trust.cpp" \
	-o "$out/totzillad$( [ "${OS:-}" = Windows_NT ] && echo .exe )" \
	-L"$fz_build/src/engine/.libs" -lfzclient-private \
	$(pkg-config --libs libfilezilla libfzssh-client) \
	-pthread
