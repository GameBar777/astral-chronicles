#!/bin/bash
set -e
export ASTRAL_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ASTRAL_ROOT"
exec node --import tsx --input-type=module <<'JS'
import { accessSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const root = process.env.ASTRAL_ROOT;
const candidates = [root + '/node_modules/pngjs', '/tmp/pngt/node_modules/pngjs'];
let png;
for (const c of candidates) { try { accessSync(c + '/package.json'); png = pathToFileURL(c + '/lib/png.js').href; break; } catch {} }
if (!png) { console.error('pngjs not found — npm i -D pngjs'); process.exit(2); }
let src = readFileSync(root + '/scripts/test-look.mjs', 'utf8');
src = src.replace("from 'pngjs'", 'from ' + JSON.stringify(png));
src = src.replace("from '../client/src/art/lookcore.ts'", 'from ' + JSON.stringify(root + '/client/src/art/lookcore.ts'));
src = src.replace("from '../client/src/art/placeholderArt.ts'", 'from ' + JSON.stringify(root + '/client/src/art/placeholderArt.ts'));
mkdirSync('/tmp/astral-look-test', { recursive: true });
writeFileSync('/tmp/astral-look-test/test.mjs', src);
await import('file:///tmp/astral-look-test/test.mjs');
JS
