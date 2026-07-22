# ── Cognito AI backend — imagem única (API + worker) ──
# O worker usa Puppeteer; por isso instalamos o Chromium do sistema e
# apontamos PUPPETEER_EXECUTABLE_PATH para ele (sem baixar o bundled).

FROM node:20-slim AS base
ENV PUPPETEER_SKIP_DOWNLOAD=true
WORKDIR /app

# ── Build: instala tudo, gera o Prisma Client e compila TS ──
FROM base AS build
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx prisma generate && npm run build

# ── Runner: só deps de produção + Chromium ──
FROM base AS runner
ENV NODE_ENV=production
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium \
      ca-certificates \
      fonts-liberation \
      fonts-noto-color-emoji \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
# --ignore-scripts: sem devDeps, o `prepare` (husky) não existe e quebraria o ci
# (exit 127). O Prisma Client vem copiado do estágio build, então nada a rodar aqui.
RUN npm ci --omit=dev --ignore-scripts

# Prisma Client gerado no estágio de build
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/node_modules/@prisma ./node_modules/@prisma

COPY --from=build /app/dist ./dist
COPY prisma ./prisma
COPY templates ./templates

EXPOSE 3333

# Sobrescreva o command no serviço "worker" para: node dist/workers/index.js
CMD ["node", "dist/server.js"]
