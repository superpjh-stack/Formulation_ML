# 고려솔더 AI 스마트공장 — 프론트엔드(Next.js 14) 이미지
#
# 빌드 컨텍스트는 **레포 루트**다 (docker-compose.yml 이 git 컨텍스트를 쓴다).
# 그래서 COPY 경로가 전부 `frontend/` 로 시작한다.
FROM node:20-slim AS deps
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

FROM node:20-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY frontend/ ./
RUN npm run build

FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1
COPY --from=build /app ./
EXPOSE 3000
# next.config.js 의 rewrites() 는 `next start` 런타임에 평가된다 →
# API_PROXY_TARGET 을 빌드 시점에 박아둘 필요가 없다.
CMD ["npm", "run", "start"]
