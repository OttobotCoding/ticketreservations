# ---- Build the React frontend ----
FROM node:22-alpine AS client-build
WORKDIR /app/client
COPY client/package.json ./
RUN npm install --ignore-scripts --no-audit --no-fund
COPY client/ ./
RUN npm run build

# ---- Build the TypeScript server ----
FROM node:22-alpine AS server-build
WORKDIR /app/server
COPY server/package.json ./
RUN npm install --ignore-scripts --no-audit --no-fund
COPY server/ ./
RUN npm run build && npm prune --omit=dev

# ---- Runtime image ----
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV DB_URL=file:/app/data/broncos.db
COPY --from=server-build /app/server/node_modules server/node_modules
COPY --from=server-build /app/server/dist server/dist
COPY --from=server-build /app/server/package.json server/package.json
COPY --from=client-build /app/client/dist client/dist
VOLUME /app/data
EXPOSE 3001
CMD ["node", "server/dist/index.js"]
