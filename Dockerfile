# syntax=docker/dockerfile:1

FROM node:22-alpine AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN npm run build

# 마이그레이션 전용 Prisma CLI. standalone 출력에는 CLI 가 없어서 배포 절차가
# `prisma migrate deploy` 를 돌릴 수 없었다(2026-09-08 점검 H1). package.json 과
# 같은 버전을 alpine 안에서 설치해 musl 용 schema engine 을 받는다.
FROM node:22-alpine AS migrator
WORKDIR /opt/fold-migrate
COPY package.json ./
RUN version="$(node -p "require('./package.json').devDependencies.prisma")" \
    && rm package.json \
    && npm install --no-audit --no-fund --no-package-lock "prisma@${version}"

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000

RUN addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 nextjs

COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# `docker compose run --rm migrate` 가 이 디렉터리에서 `prisma migrate deploy` 를
# 실행한다. app 의 /api/health 도 같은 migrations 목록과 DB 를 대조한다.
COPY --from=migrator --chown=nextjs:nodejs /opt/fold-migrate/node_modules /opt/fold-migrate/node_modules
COPY --chown=nextjs:nodejs prisma/schema.prisma /opt/fold-migrate/prisma/schema.prisma
COPY --chown=nextjs:nodejs prisma/migrations /opt/fold-migrate/prisma/migrations
COPY --chown=nextjs:nodejs deploy/prisma.config.ts /opt/fold-migrate/prisma.config.ts
ENV PRISMA_MIGRATIONS_DIR=/opt/fold-migrate/prisma/migrations \
    CHECKPOINT_DISABLE=1

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "server.js"]
