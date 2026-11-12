# Image pour faire tourner Jarvis 24 h/24 sur un petit serveur.
# À construire depuis la racine du dépôt : docker build -f apps/jarvis/Dockerfile -t jarvis .
FROM node:22-slim
WORKDIR /app
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile --filter "@muscu/jarvis..."
# Navigateur pour les réservations (mettre BROWSER_ENABLED=false pour s'en passer)
RUN cd apps/jarvis && pnpm exec playwright install --with-deps chromium
WORKDIR /app/apps/jarvis
ENV DATA_DIR=/data
VOLUME /data
EXPOSE 8787
CMD ["pnpm", "start"]
