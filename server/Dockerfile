# Nook server
FROM node:22-slim

# sharp needs these at runtime for thumbnails and blurhash.
RUN apt-get update \
  && apt-get install -y --no-install-recommends libvips42 ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy manifests first so a code change doesn't invalidate the dependency layer.
COPY package*.json ./

# --omit=dev keeps the image small. Optional deps are wanted: sharp and the
# Redis adapter both live there. mongodb-memory-server is also optional and
# will simply be unused, since production always has a real MONGODB_URI.
RUN npm install --omit=dev --no-audit --no-fund

COPY src ./src

RUN mkdir -p /app/uploads /app/data && chown -R node:node /app
USER node

ENV NODE_ENV=production
ENV PORT=4000
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://localhost:4000/api/health || exit 1

CMD ["node", "src/index.js"]
