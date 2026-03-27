FROM node:22-bookworm-slim AS build

WORKDIR /app

RUN corepack enable && apt-get update && apt-get install -y --no-install-recommends \
  python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json ./
COPY pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build && pnpm prune --prod

FROM node:22-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/package.json ./
COPY --from=build /app/pnpm-lock.yaml* ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
RUN mkdir -p ./data && chown -R node:node /app
USER node

EXPOSE 3000

CMD ["node", "dist/index.js"]
