FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
COPY backend/database/package.json backend/database/package.json
COPY frontend/package.json frontend/package.json
RUN npm ci --workspace backend --workspace backend/database --include-workspace-root=false
COPY backend backend
WORKDIR /app/backend
CMD ["sh", "-c", "npm run db:migrate --prefix database && npm run start"]
