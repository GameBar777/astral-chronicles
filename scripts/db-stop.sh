#!/usr/bin/env bash
set -e; cd "$(dirname "$0")/.."
"${PG_BIN:-/workspace/.tools/astral-pg/bin}/pg_ctl" -D .pgdata -w stop
