#!/usr/bin/env bash
# Starts local PostgreSQL (binaries from @embedded-postgres, installed to $PG_BIN)
set -e; cd "$(dirname "$0")/.."
PG_BIN=${PG_BIN:-/opt/astral-pg/bin}; PG_PORT=${PG_PORT:-5433}
"$PG_BIN/pg_ctl" -D .pgdata status >/dev/null 2>&1 && { echo "already running"; exit 0; }
"$PG_BIN/pg_ctl" -D .pgdata -o "-p $PG_PORT -k /tmp" -l .pgdata/server.log -w start
