# Railway builds from the repo root (the service has no Root Directory set), so this
# Dockerfile lives at the root and builds backend/ explicitly.
# Local development still uses backend/Dockerfile via docker-compose.yml.
FROM node:20-alpine AS builder
WORKDIR /app
COPY backend/package*.json ./
RUN npm ci
COPY backend/ ./
RUN npm run build

FROM node:20-alpine
# 锁在镜像里：少一个面板变量就会让 TypeORM synchronize 改写生产库表结构
ENV NODE_ENV=production
# 车队在新西兰。容器默认 UTC，会让「当日任务」按 UTC 零点切天（漏掉当地上午的活），
# 也会把每天早上的 RUC 提醒推到当地晚上。alpine 不自带时区库，必须装 tzdata。
RUN apk add --no-cache tzdata
ENV TZ=Pacific/Auckland
WORKDIR /app
COPY backend/package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
RUN mkdir -p /app/uploads
EXPOSE 3000
CMD ["node", "dist/main"]
