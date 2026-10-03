FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG VITE_ICP_NUMBER=""
ENV VITE_ICP_NUMBER=$VITE_ICP_NUMBER
RUN npm run build

FROM node:24-bookworm-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3001 DB_PATH=/app/data/poke.db
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY server ./server
COPY scripts ./scripts
RUN mkdir -p /app/data /app/backups && chown -R node:node /app
USER node
EXPOSE 3001
CMD ["node", "server/main.mjs"]
