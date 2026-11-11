# Docker / compose verification (2026-11-12 Asia/Tokyo)

## What could not be tested
`Dockerfile` and `docker-compose.yml` were **not** run as containers on this development box. Do not treat them as tested.

Reasons, in detail:

- No container runtime is installed: `docker`, `podman`, `nerdctl`, `buildah`, `runc`, `crun`, and `/var/run/docker.sock` are all absent.
- Rootless prerequisites are incomplete: `/etc/subuid` and `/etc/subgid` exist for `box`, and `unshare --user --map-root-user` works, but `newuidmap` / `newgidmap`, `fuse-overlayfs`, and `slirp4netns` are missing.
- Packages could not be installed to fill those gaps. `sudo` works, but `apt-get update` against the configured Debian mirrors fails through the box HTTP proxy at `198.18.0.1` (plain HTTP returns 500; HTTPS to the same proxy ends with `SSL unexpected eof`). Direct `curl` to `https://deb.debian.org` and to Docker Hub (`https://registry-1.docker.io/v2/`, 401 as expected for an anonymous `/v2/` ping) succeeds, so the failure is apt/proxy-specific, not a total lack of outbound HTTPS.
- A static docker/podman download would still need runc/crun and the rootless helpers above; assembling that stack was not possible with the tools present.

Therefore image build, `docker compose up`, the `postgres:17` healthcheck, compose DNS (`db:5432`), named volumes, and the image `USER node` are **unverified**.

## What was verified (Dockerfile-equivalent + compose env)
Reproduced the image contents and the compose `game` service environment without a container runtime (`scripts/verify-prod.sh`).

1. `npm run build` (shared + server `tsc`, client Vite production build). Client output includes `dist/index.html` and `dist/admin.html`.
2. Staged a runtime tree matching the final image `COPY` set under `/tmp/astral-prod-image` (package.json / lockfile, `packages/shared/dist`, `server/dist`, `server/migrations`, `assets`, `client/dist`).
3. In that tree: `npm ci --omit=dev --workspace @astral/server --workspace @astral/shared --include-workspace-root` — succeeded (202 packages).
4. Created a dedicated Postgres database `astral_prodcheck` owned by role `astralprod` (password is not the dev default; production startup refuses URLs containing `CHANGE_ME` or `astral_dev_pw` — this refusal was also executed and confirmed).
5. Compose-equivalent env: `NODE_ENV=production`, `DATABASE_URL=postgres://astralprod:…@127.0.0.1:5433/astral_prodcheck`, `SERVER_PORT=2599`, `ALLOWED_ORIGINS=http://127.0.0.1:2599`, `TRUST_PROXY=1`, `CLIENT_DIST=/tmp/astral-prod-image/client/dist`.
6. `node server/dist/db/migrate.js` applied migrations `001`–`011` on the prod-check database.
7. `node server/dist/index.js` listened on `:2599`. Checks (then the process was stopped):

| Check | Result |
|---|---|
| `GET /api/status` | 200 `{"ok":true,"maintenance":false,...}` |
| `GET /` (index.html) | 200 `text/html`, 505 bytes |
| `GET /admin.html` | 200, 5815 bytes |
| Security headers | `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, CSP, `Cache-Control: no-store` on `/api`, **HSTS** `max-age=31536000; includeSubDomains` (production only) |
| `POST /api/auth/register` | 201, `{ userId, emailed: true }` — **no** `devConfirmToken` |
| `POST /api/auth/login` before confirm | `{ error: "email_unverified" }` |
| Confirm via the dev mailbox (`server/var/mail`, no SMTP) then login | `{ token, userId }` |

Not claimed: running inside the `node:22-bookworm-slim` image, Postgres-in-compose, or a TLS proxy in front.
