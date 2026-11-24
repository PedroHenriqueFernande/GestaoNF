FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
COPY backend/database/package.json backend/database/package.json
COPY frontend/package.json frontend/package.json
COPY packages/permissions/package.json packages/permissions/package.json
RUN npm ci --workspace frontend --workspace packages/permissions --include-workspace-root=false
COPY packages/permissions packages/permissions
COPY frontend frontend
WORKDIR /app/frontend
EXPOSE 3001
CMD ["npm", "run", "dev"]
