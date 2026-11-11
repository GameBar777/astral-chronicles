# ASTRAL CHRONICLES production image (UNVERIFIED: Docker is not available on the dev box; see docs/DEPLOY.md)
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-bookworm-slim
ENV NODE_ENV=production SERVER_PORT=2567 CLIENT_DIST=/app/client/dist
WORKDIR /app
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/packages/shared/package.json packages/shared/
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/server/package.json server/
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/server/migrations server/migrations
COPY --from=build /app/assets assets
COPY --from=build /app/client/dist client/dist
RUN npm ci --omit=dev --workspace @astral/server --workspace @astral/shared --include-workspace-root
USER node
EXPOSE 2567
# run migrations, then the server
CMD ["sh", "-c", "node server/dist/db/migrate.js && node server/dist/index.js"]
