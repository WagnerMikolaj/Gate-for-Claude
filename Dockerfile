FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && mkdir /app/data && chown node:node /app/data
COPY --chown=node:node src ./src
COPY --chown=node:node public ./public
USER node
ENV NODE_ENV=production GATE_HOST=0.0.0.0 GATE_PORT=8080 NODE_USE_ENV_PROXY=1
EXPOSE 8080
CMD ["node", "src/main.mjs"]
