FROM node:22-alpine
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY vendor ./vendor
COPY src ./src

ENV NODE_ENV=production
USER node

# 10001: the plugs connect here (via the DNS rewrite for homemate.orvibo.com)
# 8080: /health, used by the container healthcheck
EXPOSE 10001 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/index.js"]
