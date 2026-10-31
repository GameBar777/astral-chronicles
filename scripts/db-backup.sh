#!/usr/bin/env bash
# Backup: scripts/db-backup.sh  -> backups/astral-<ts>.dump
# Restore: pg_restore -h 127.0.0.1 -p 5433 -U astral -d astral --clean backups/<file>.dump
set -e; cd "$(dirname "$0")/.."; mkdir -p backups
pg_dump -Fc -h 127.0.0.1 -p "${PG_PORT:-5433}" -U astral astral -f "backups/astral-$(date +%Y%m%d-%H%M%S).dump"
