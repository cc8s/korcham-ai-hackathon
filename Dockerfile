# 백엔드 배포 이미지 (Railway). 레포 루트에서 빌드한다: 서버가 ../scenarios 를 읽기 때문에
# Root Directory 를 server 로 두면 scenarios/ 가 빌드에 안 들어간다.
# Node 20 + better-sqlite3 12.x (13.x 는 Node 22+ 전용)
FROM node:20-bookworm-slim AS build
WORKDIR /app/server
# better-sqlite3 미리 빌드된 바이너리를 못 받을 때를 대비한 빌드 도구
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY server/package.json server/package-lock.json ./
RUN npm ci
COPY server/tsconfig.json ./
COPY server/src ./src
RUN npm run build && npm prune --omit=dev

FROM node:20-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app/server
COPY --from=build /app/server/node_modules ./node_modules
COPY --from=build /app/server/dist ./dist
COPY server/package.json ./
COPY scenarios /app/scenarios
# DB 는 Railway volume (DB_PATH=/data/oreum.db). volume 없이 띄우면 재배포마다 기록이 사라짐
CMD ["node", "dist/index.js"]
