#!/usr/bin/env bash
# Dockerfile-equivalent production build + compose-like env run.
# This does NOT run Docker/compose (no container runtime on the dev box — see docs/PROD_VERIFY.md).
# Usage: bash scripts/verify-prod.sh
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
ST=${ST:-/tmp/astral-prod-image}
PORT=${SERVER_PORT:-2599}
DB_URL=${DATABASE_URL_PROD:-postgres://astralprod:prod_verify_ok_9@127.0.0.1:5433/astral_prodcheck}

echo "== npm run build (same as image build stage) =="
(cd "$ROOT" && npm run build)

echo "== stage runtime tree (same files as the final image COPY) =="
rm -rf "$ST"
mkdir -p "$ST/packages/shared" "$ST/server" "$ST/client"
cp "$ROOT/package.json" "$ROOT/package-lock.json" "$ST/"
cp "$ROOT/packages/shared/package.json" "$ST/packages/shared/"
cp -a "$ROOT/packages/shared/dist" "$ST/packages/shared/"
cp "$ROOT/server/package.json" "$ST/server/"
cp -a "$ROOT/server/dist" "$ST/server/"
cp -a "$ROOT/server/migrations" "$ST/server/"
cp -a "$ROOT/assets" "$ST/assets"
cp "$ROOT/client/package.json" "$ST/client/"
cp -a "$ROOT/client/dist" "$ST/client/"

echo "== npm ci --omit=dev (same as image runtime install) =="
(cd "$ST" && npm ci --omit=dev --workspace @astral/server --workspace @astral/shared --include-workspace-root)

cat > "$ST/.env" <<ENV
DATABASE_URL=$DB_URL
NODE_ENV=production
SERVER_PORT=$PORT
ALLOWED_ORIGINS=http://127.0.0.1:$PORT
TRUST_PROXY=1
CLIENT_DIST=$ST/client/dist
BCRYPT_ROUNDS=12
ENV

echo "== refuse default DB password in production =="
(cd "$ST" && NODE_ENV=production DATABASE_URL='postgres://astral:astral_dev_pw@127.0.0.1:5433/astral' \
  node -e 'import("./server/dist/config.js").then(()=>{console.error("should have refused"); process.exit(1)}).catch(e=>{console.log("refused:", e.message);})')

echo "== migrate + server (compose CMD equivalent) =="
(cd "$ST" && node server/dist/db/migrate.js)
echo "start the server with:  (cd $ST && node server/dist/index.js)"
echo "then curl http://127.0.0.1:$PORT/api/status  and  http://127.0.0.1:$PORT/"
