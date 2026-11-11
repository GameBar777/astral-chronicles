#!/usr/bin/env bash
# Starts local PostgreSQL (binaries from @embedded-postgres, installed to $PG_BIN)
set -e; cd "$(dirname "$0")/.."
PG_BIN=${PG_BIN:-/workspace/.tools/astral-pg/bin}; PG_PORT=${PG_PORT:-5433}
"$PG_BIN/pg_ctl" -D .pgdata status >/dev/null 2>&1 && { echo "already running"; exit 0; }
chmod 700 .pgdata; for d in pg_notify pg_serial pg_snapshots pg_stat_tmp pg_replslot pg_tblspc pg_twophase pg_commit_ts pg_dynshmem pg_logical/snapshots pg_logical/mappings pg_stat pg_subtrans pg_multixact/members pg_multixact/offsets pg_wal/archive_status pg_wal/summaries pg_xact; do mkdir -p .pgdata/$d; done; rm -f .pgdata/postmaster.pid
"$PG_BIN/pg_ctl" -D .pgdata -o "-p $PG_PORT -k /tmp" -l .pgdata/server.log -w start
