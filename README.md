# 货车司机调度与管理系�?
商业级全栈调度系统，支持多角色权限、任务派发、GPS 实时追踪、工时管理、异常检测、通知�?Supabase 云数据库�?
## 技术栈

| 层级 | 技�?|
| --- | --- |
| Web 前端 | React 18 + Vite + Ant Design 5 + Redux Toolkit + i18n |
| 司机 App | Expo + React Native + Expo Router + Redux Toolkit |
| 后端 | NestJS 10 + TypeORM + Socket.io + Swagger |
| 数据�?| Supabase PostgreSQL |
| 文件存储 | Supabase Storage |
| 地图 | Google Maps / Leaflet |
| 认证 | JWT + Passport |
| 部署 | Docker + Nginx |

## 项目结构

```text
truck-system/
├── backend/                 # NestJS 后端服务
�?  └── src/
�?      ├── auth/            # 登录、注册、JWT 策略
�?      ├── users/           # 用户、角色、审�?�?      ├── tasks/           # 任务创建、分配、开始、完成、取�?�?      ├── gps/             # GPS 上报、轨迹、异常检�?�?      ├── work-records/    # 工时记录
�?      ├── adjustments/     # 工时调整和操作日�?�?      ├── notifications/   # 通知接口�?WebSocket 网关
�?      └── common/          # Guards、Decorators、Storage、Email
├── frontend/                # React Web 前端
�?  └── src/
�?      ├── pages/auth/      # 登录、注�?�?      ├── pages/admin/     # 管理�?调度员页�?�?      ├── pages/client/    # 客户订单、个人中心、通知
�?      ├── pages/driver/    # Web 端司机入口提�?�?      ├── store/           # Redux 状�?�?      ├── api/             # Axios API 封装
�?      └── hooks/           # Socket hooks
├── driver-app/              # Expo 司机移动�?�?  ├── app/                 # Expo Router 页面
�?  └── src/
�?      ├── api/             # 移动�?API 封装
�?      └── store/           # 移动�?Redux 状�?├── database/
�?  └── database.sql         # 唯一数据库初始化脚本
├── docs/                    # API 和部署文�?├── docker-compose.yml       # 后端 + 前端容器编排
└── start-dev.bat            # Windows 本地启动脚本
```

## 数据库初始化

项目数据库脚本已合并为一份：

```text
database/database.sql
```

使用步骤�?
1. 登录 [Supabase](https://supabase.com) 并创建项目�?2. 打开 **SQL Editor**�?3. 粘贴并执�?`database/database.sql`�?4. �?**Settings > Database** 复制数据库连接信息�?5. �?**Settings > API** 复制 Project URL �?`service_role` key�?
脚本会创建：

- `users`
- `tasks`
- `gps_logs`
- `gps_anomalies`
- `work_records`
- `adjustment_logs`
- `notifications`
- 相关枚举、索引、更新时间触发器、RLS 开关和默认管理员账�?
默认管理员：

| 字段 | �?|
| --- | --- |
| 邮箱 | `admin@trucksystem.com` |
| 密码 | 见 `database/database.sql` 顶部注释，**装完请立刻在「系统设置 → 修改密码」改掉** |

上线前务必修改默认密码�?
## 环境变量

后端需要在 `backend/.env` 中配置：

```env
DB_HOST=your-supabase-db-host
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=your-password
DB_NAME=postgres

SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_SERVICE_KEY=your-service-role-key
SUPABASE_STORAGE_BUCKET=truck-uploads

JWT_SECRET=replace-with-a-long-random-string
FRONTEND_URL=http://localhost:5173
PORT=3000
```

生成 `JWT_SECRET`�?
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

前端可选配�?`frontend/.env.local`�?
```env
VITE_API_URL=http://localhost:3000
VITE_GOOGLE_MAPS_KEY=your-google-maps-key
```

## 本地启动

Windows 一键启动：

```bat
start-dev.bat
```

手动启动后端�?
```bash
cd backend
npm install
npm run start:dev
```

手动启动 Web 前端�?
```bash
cd frontend
npm install
npm run dev
```

手动启动司机 App�?
```bash
cd driver-app
npm install
npm run start
```

访问地址�?
- Web 前端：http://localhost:5173
- 后端 API：http://localhost:3000
- Swagger 文档：http://localhost:3000/api/docs

## 角色权限

| 角色 | 功能 |
| --- | --- |
| Admin | 用户审核、用户管理、任务管理、工时管理、异常管理、通知管理 |
| Dispatcher | 创建和分配任务、查看用户和工时、处理调度相关流�?|
| Driver | 查看今日任务、开�?完成任务、GPS 上报、上传完工照片、查看个人信�?|
| Client | 查看自己的订单、追踪任务状态、查看通知和个人信�?|

## GPS 异常规则

| 检测项 | 阈�?| 异常类型 |
| --- | --- | --- |
| GPS 超时 | 超过 60 秒无上报 | `gps_disconnect` |
| 速度异常 | 超过 140 km/h | `speed_anomaly` |
| 瞬移检测 | 短时间内位置跳跃超过合理速度 | `teleport` |
| 静止报警 | 设定时长内位移小于 50m（自动升级二次/三次报警） | `stationary` |

> 公告、系统设置（含清空数据密码 / GPS 报警参数）、按角色公告下发等接口见 `docs/API.md`。账户审核通过通知邮件由前端 `mailto:` 调起本机邮箱发送，服务器不发邮件、无需 SMTP。

## 工时计算

```text
system_duration = end_time - start_time
gps_duration    = GPS 有效轨迹时长
final_duration  = system_duration + adjustment_time
```

管理�?调度员的工时调整会记录在 `adjustment_logs` 表中�?
## Docker 部署

在项目根目录创建 `.env`�?
```env
DB_HOST=your-supabase-db-host
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=your-password
DB_NAME=postgres
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_SERVICE_KEY=your-service-role-key
SUPABASE_STORAGE_BUCKET=truck-uploads
JWT_SECRET=replace-with-a-long-random-string
GOOGLE_MAPS_API_KEY=your-google-maps-key
```

启动�?
```bash
docker compose up -d
```

部署后访问：

```text
http://localhost
```

更多部署细节�?`docs/DEPLOY.md`�?