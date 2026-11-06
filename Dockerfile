FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json ./
RUN npm install --omit=dev
COPY . .

FROM node:22-bookworm-slim
ENV NODE_ENV=production PORT=3000
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/* && mkdir -p /app/data/uploads && chown -R node:node /app
COPY --from=build --chown=node:node /app /app
USER node
EXPOSE 3000
CMD ["node","server.js"]
