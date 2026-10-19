# 部署说明

> 这份文档在 2026-09-23 重写过。此前的版本是 GBK 文本被当成 UTF-8 存过一次，
> 94 处汉字和换行丢失，内容也还停留在 Ubuntu + PM2 + Nginx 的方案上，
> 和现在实际的跑法（Railway + Supabase + Electron 桌面端）对不上。

## 现在实际是怎么跑的

```
          Electron 桌面端 (ECT ERP.exe)          司机手机 App (Expo)
          file:// 加载本地 dist                   Origin 为空
                    │                                   │
                    └───────────── HTTPS ───────────────┘
                                   │
                    backend-production-ff66.up.railway.app
                                   │
                    ┌──────────────┴──────────────┐
                    │  Railway 上的一个 service    │
                    │  HTTP  : 容器内 8080         │
                    │  JT808 : 容器内 5023         │
                    └──────────────┬──────────────┘
                                   │
                   Supabase Postgres + Supabase Storage

车载 GPS 定位器 ──TCP──▶ iriguchi.proxy.rlwy.net:18239 ──▶ 容器内 5023
```

一个 service 同时提供 HTTP API 和 JT808 TCP 网关，**两个端口必须不同**
（细节和踩过的坑见 [gps-device-jt808.md](gps-device-jt808.md) §3）。

## 1. 后端（Railway）

服务已连到 GitHub 仓库 `duqianyong5-creator/EXCELLENT-CONSTRUCTION-ERP` 的 `main` 分支，
**推代码即自动部署**，不需要手工上传。

构建用的是**仓库根目录的 `Dockerfile`**（不是 `backend/Dockerfile`）。
因为服务没有设置 Root Directory，构建上下文就是仓库根目录；
只有 `backend/Dockerfile` 的话，构建器会看到一个多项目的目录树直接失败。
`backend/Dockerfile` 保留给 `docker-compose` 本地用。

镜像里固定了两件事，不依赖面板配置：

| 固定项 | 为什么 |
|---|---|
| `ENV NODE_ENV=production` | 少这一个变量，TypeORM `synchronize` 就会按实体改写生产库表结构（会删列） |
| `ENV TZ=Pacific/Auckland`（并装 `tzdata`） | 容器默认 UTC，会让「当日任务」按 UTC 零点切天、每天早上的 RUC 提醒落到当地晚上 9 点。alpine 不自带时区库，只设 `TZ` 会静默退回 UTC |

### 环境变量

在 Railway → 服务 → Variables 里设置。**值不要写进仓库、也不要贴进聊天记录。**

| 变量 | 说明 |
|---|---|
| `NODE_ENV` | `production`（镜像里也有，双保险） |
| `PORT` | HTTP 端口。**必须显式设置**，取服务域名的 target port（本项目 `8080`）。加了 TCP Proxy 之后 Railway 会把 `PORT` 顶成 TCP 目标端口，HTTP 服务就会和 JT808 网关抢端口 → `EADDRINUSE` → 整个后端崩溃重启、API 全线 502 |
| `JT808_PORT` | 定位器网关端口，`5023`。不设则网关不启动 |
| `JT808_DEVICE_TZ_OFFSET_HOURS` | 可选。设备上报时间的时区，默认 `8` |
| `DB_HOST` / `DB_PORT` / `DB_USER` / `DB_PASSWORD` / `DB_NAME` | Supabase Postgres 连接信息 |
| `JWT_SECRET` | 必填，没有默认值，缺失直接启动失败 |
| `JWT_EXPIRES_IN` | 如 `7d` |
| `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` | 工完照片上传用。不配会退回本地磁盘存储（容器重启即丢） |
| `FRONTEND_URL` | 可选，逗号分隔。只影响 CORS。当前客户端是 Electron（`Origin: null`）和手机端（无 Origin），都直接放行，所以现在没设 |

### 数据库

启动时会自动跑幂等 DDL 补齐 `gps_devices`、`vehicles` 表和 `gps_logs.source` 列，
**不需要先手工执行 SQL**。全新的库用 `database/database.sql` 初始化一次。

DDL 执行失败时服务会**拒绝启动**（fail-closed），Railway 会保留上一个版本继续服务 ——
这是故意的：宁可不发新版本，也不要带着残缺的表结构上线。
日志里会写明缺哪张表，到 Supabase SQL Editor 手工跑一次 `database/migrations/` 下对应的脚本即可。

### 启动日志应该长这样

```
[LaunchHygiene] （没有 SECURITY 开头的行 —— 有的话说明还在用默认口令）
[RucSchema]        vehicles schema verified
[JT808]            JT808 gateway listening on 0.0.0.0:5023
[GpsDeviceSchema]  gps_devices / gps_logs.source schema verified
[NestApplication]  Nest application successfully started
[Bootstrap]        Local: http://localhost:8080
```

时间戳应该是新西兰时间。出现 `EADDRINUSE` 见上面 `PORT` 那一行。

## 2. 桌面端（Windows）

```bash
cd frontend
npm ci
npm run dist:win
```

产物：
- `frontend/release/ECT ERP Setup 1.0.0.exe` —— 发给用户的安装包
- `frontend/release/win-unpacked/ECT ERP.exe` —— 免安装，用来快速验证

打包前**必须关掉正在运行的 ECT ERP**，否则 `win-unpacked` 里的文件被占用，
electron-builder 会在打包阶段失败（报 `ERR_ELECTRON_BUILDER_CANNOT_EXECUTE`，
信息里看不出是文件锁）。

后端地址写在 `frontend/.env.production` 的 `VITE_API_URL`，是公开地址，可以提交。

**不要用浏览器打开 `npm run preview` 的页面来测试线上后端** —— 生产 CORS 只放行
Electron（`Origin: null`）和手机端，浏览器会被挡掉，看起来就像"页面打得开但点了没反应"。
要在浏览器里调，用：

```bash
VITE_PROXY_TARGET=https://backend-production-ff66.up.railway.app npm run dev
```

开发服务器会在服务端代理 `/api`，同源访问，不受 CORS 限制。

## 3. 司机端（Android / iOS）

```bash
cd driver-app
npx expo export --platform android   # 只验证能否打出 bundle
```

后端地址在 `driver-app/src/api/index.ts` 的 `DEFAULT_BASE_URL`，
App 内「服务器地址」可以覆盖它用于本地联调。

## 4. 本地开发

数据库仍然用 Supabase（没有本地 Postgres）。

```bash
# 后端
cd backend && npm ci
cp .env.example .env     # 填好后
npm run start:dev

# 网页端（走 Vite 代理连本机后端）
cd frontend && npm ci && npm run dev
```

`docker-compose.yml` 里的后端用 `backend/Dockerfile`（context 是 `./backend`），
和 Railway 用的根 `Dockerfile` 互不影响。

## 5. CI

`.github/workflows/ci.yml` 在每次 push 和 PR 上跑：

- 后端：`tsc --noEmit` + 全部 jest 测试
- 网页端：`tsc --noEmit` + `npm run build`
- 司机端：`tsc --noEmit`
- 构建一次 Railway 实际使用的根 `Dockerfile`

## 6. 上线检查清单

- [ ] **改掉 admin 的默认密码**（系统设置 → 修改密码）。没改的话每次启动日志都有 `SECURITY:` 告警
- [ ] `PORT` 和 `JT808_PORT` 是两个不同的值，且 `PORT` 与服务域名的 target port 一致
- [ ] `JWT_SECRET` 是随机长字符串，不是示例值
- [ ] 启动日志里三行 schema / gateway 都出现了，且没有 `EADDRINUSE`
- [ ] 数据库账号不是 Supabase 的超级用户
- [ ] 定位器厂家拿到的是**域名** `iriguchi.proxy.rlwy.net:18239`，不是 IP（IP 会变）

## 7. 已知的待办

| 事项 | 现状 |
|---|---|
| 工完照片的存储桶是公开的 | URL 是 UUID 猜不到，但一旦外泄就永久可看。改私有需要签名 URL + 迁移已存的地址，见 [gps-device-jt808.md](gps-device-jt808.md) §7 |
| 没有 helmet / 安全响应头 | 桌面端走 `file://` 影响有限，但值得加 |
| `docs/API.md` 未随近期改动更新 | 错误响应现在带 `code` 字段，语言由 `X-Lang` 请求头决定 |
