FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
COPY backend/database/package.json backend/database/package.json
COPY frontend/package.json frontend/package.json
RUN npm ci --workspace frontend --include-workspace-root=false
COPY frontend frontend
WORKDIR /app/frontend
EXPOSE 3001
CMD ["npm", "run", "dev"]
