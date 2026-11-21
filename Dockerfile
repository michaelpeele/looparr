FROM node:20-alpine

WORKDIR /app

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    CONFIG_PATH=/app/data/config.json

COPY package*.json ./
RUN npm ci --omit=dev

COPY server.js ./
COPY src ./src
COPY public ./public
COPY scripts ./scripts

RUN mkdir -p /app/data

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/state').then(r => { if (!r.ok) process.exit(1); }).catch(() => process.exit(1))"

CMD ["node", "server.js"]
