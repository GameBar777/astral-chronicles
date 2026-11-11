#!/usr/bin/env bash
# Re-creates the local dev environment after a box reset (node_modules, PG binaries, empty PG dirs).
set -e; cd "$(dirname "$0")/.."
PG_BIN_ROOT=${PG_ROOT:-/workspace/.tools/astral-pg}
if [ ! -x "$PG_BIN_ROOT/bin/postgres" ]; then
  mkdir -p /tmp/epg && cd /tmp/epg && rm -rf package *.tgz
  npm pack @embedded-postgres/linux-x64@17.5.0-beta.15 >/dev/null 2>&1 && tar xzf *.tgz
  mkdir -p "$PG_BIN_ROOT" && cp -r package/native/* "$PG_BIN_ROOT/"
  node -e 'const l=require(process.argv[1]+"/pg-symlinks.json"),fs=require("fs"),p=require("path");for(const s of l){try{fs.symlinkSync(p.basename(s.source),p.join(process.argv[1],s.target.replace(/^native\//,"")))}catch{}}' "$PG_BIN_ROOT"
  chmod +x "$PG_BIN_ROOT"/bin/*; cd - >/dev/null
fi
[ -d node_modules ] || npm ci --no-audit --no-fund >/dev/null 2>&1
