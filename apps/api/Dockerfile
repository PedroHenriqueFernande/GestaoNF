FROM node:24-alpine
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/database/package.json packages/database/package.json
COPY apps/api/package.json apps/api/package.json
RUN corepack pnpm install --frozen-lockfile
COPY packages/database packages/database
COPY apps/api apps/api
CMD ["sh", "-c", "corepack pnpm --filter @gestaonf/database db:migrate && corepack pnpm --filter @gestaonf/api start"]
