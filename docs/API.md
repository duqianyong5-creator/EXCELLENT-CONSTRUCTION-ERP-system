# 货车调度管理系统 API 文档

Base URL: `http://localhost:3000`  
认证方式：Bearer Token（JWT�?
---

## 认证模块 /auth

| 方法 | 路径 | 描述 | 权限 |
|------|------|------|------|
| POST | /auth/login | 登录 | 公开 |
| POST | /auth/register | 注册申请 | 公开 |
| GET  | /auth/me | 获取当前用户 | 已登�?|

### POST /auth/login
```json
// Request
{
  "identifier": "admin@trucksystem.com",
  "password": "your-password"
}

// Response
{
  "access_token": "eyJhbGciOiJIUzI1...",
  "user": {
    "id": "uuid",
    "username": "admin",
    "email": "admin@trucksystem.com",
    "role": "admin",
    "fullName": "系统管理�?,
    "language": "zh"
  }
}
```

### POST /auth/register
```json
// Request
{
  "username": "driver001",
  "email": "driver@example.com",
  "password": "Password123!",
  "role": "driver",
  "fullName": "张三",
  "phone": "13800138000"
}
// Response: { "message": "注册成功，等待管理员审核", "userId": "uuid" }
```

---

## 用户管理 /users

| 方法 | 路径 | 描述 | 权限 |
|------|------|------|------|
| GET | /users | 用户列表 | Admin/Dispatcher |
| GET | /users/pending | 待审核用�?| Admin/Dispatcher |
| GET | /users/drivers | 活跃司机列表 | Admin/Dispatcher |
| GET | /users/clients | 活跃客户列表 | Admin/Dispatcher |
| GET | /users/:id | 用户详情 | Admin/Dispatcher |
| POST | /users | 创建用户 | Admin |
| PATCH | /users/:id/approve | 审批通过 | Admin/Dispatcher |
| PATCH | /users/:id/reject | 拒绝申请 | Admin/Dispatcher |
| PATCH | /users/:id/disable | 禁用账户 | Admin |
| PATCH | /users/:id/enable | 启用账户 | Admin |
| PATCH | /users/:id/role | 修改角色 | Admin |
| PATCH | /users/profile | 更新个人资料 | 已登�?|
| PATCH | /users/change-password | 修改密码 | 已登�?|

---

## 任务管理 /tasks

| 方法 | 路径 | 描述 | 权限 |
|------|------|------|------|
| GET | /tasks | 任务列表（按角色过滤�?| 已登�?|
| GET | /tasks/today | 今日任务 | Driver |
| GET | /tasks/stats | 统计数据 | Admin/Dispatcher |
| GET | /tasks/:id | 任务详情 | 已登�?|
| POST | /tasks | 创建任务 | Admin/Dispatcher |
| PATCH | /tasks/:id | 编辑任务 | Admin/Dispatcher |
| PATCH | /tasks/:id/assign | 分配司机 | Admin/Dispatcher |
| POST | /tasks/:id/start | 开始任�?| Driver |
| POST | /tasks/:id/complete | 完成任务（含图片上传�?| Driver |
| PATCH | /tasks/:id/cancel | 取消任务 | Admin/Dispatcher |

### POST /tasks（创建任务）
```json
{
  "title": "广州→深圳货�?,
  "clientId": "uuid",
  "driverId": "uuid",
  "startLocation": "广州白云区仓�?,
  "endLocation": "深圳罗湖区客户仓",
  "startLat": 23.1292,
  "startLng": 113.2644,
  "endLat": 22.5481,
  "endLng": 114.0579,
  "cargo": "电子元件",
  "cargoWeight": 2.5,
  "scheduledAt": "2024-03-15T08:00:00Z",
  "notes": "注意轻拿轻放"
}
```

### POST /tasks/:id/complete（multipart/form-data�?```
Field: notes (text)
Field: images (file, 最�?�?
```

---

## GPS 追踪 /gps

| 方法 | 路径 | 描述 | 权限 |
|------|------|------|------|
| POST | /gps/upload | 上传GPS坐标 | Driver |
| GET | /gps/track/:taskId | 任务GPS轨迹 | 已登�?|
| GET | /gps/positions | 所有司机最新位�?| Admin/Dispatcher |
| GET | /gps/driver/:driverId/position | 指定司机位置 | 已登�?|

### POST /gps/upload（每10秒调用一次）
```json
{
  "taskId": "uuid",
  "latitude": 22.5481,
  "longitude": 114.0579,
  "speed": 60.5,
  "heading": 180.0,
  "accuracy": 5.0
}
// Response
{
  "log": { "id": 1, "latitude": 22.5481, ... },
  "anomalies": []  // �?["speed_anomaly", "teleport"]
}
```

---

## 工时记录 /work-records

| 方法 | 路径 | 描述 | 权限 |
|------|------|------|------|
| GET | /work-records | 工时列表 | 已登录（Driver只看自己�?|
| GET | /work-records/task/:taskId | 按任务查�?| 已登�?|
| GET | /work-records/:id | 详情 | 已登�?|

---

## 工时调整 /adjustments

| 方法 | 路径 | 描述 | 权限 |
|------|------|------|------|
| POST | /adjustments | 调整工时 | Admin/Dispatcher |
| POST | /adjustments/set-final | 手动设置最终工�?| Admin/Dispatcher |
| GET | /adjustments/logs | 调整日志 | Admin/Dispatcher |

### POST /adjustments
```json
{
  "workRecordId": "uuid",
  "driverId": "uuid",
  "taskId": "uuid",
  "addedMinutes": 30,   // �?60
  "reason": "交通延�?
}
```

---

## 通知 /notifications

| 方法 | 路径 | 描述 | 权限 |
|------|------|------|------|
| GET | /notifications | 我的通知 | 已登�?|
| GET | /notifications/unread-count | 未读数量 | 已登�?|
| PATCH | /notifications/:id/read | 标记已读 | 已登�?|
| PATCH | /notifications/read-all | 全部已读 | 已登�?|

---

## WebSocket 事件

连接地址：`ws://localhost:3000`  
连接参数：`auth: { token: "Bearer_token" }`

### 服务�?�?客户�?
| 事件 | 数据 | 描述 |
|------|------|------|
| `notification` | `{ title, content, type, meta }` | 新通知推�?|
| `gps:update` | `{ driverId, latitude, longitude, speed, timestamp }` | GPS位置更新 |

### 客户�?�?服务�?
| 事件 | 描述 |
|------|------|
| `ping` | 心跳检�?|

---

## 工时计算逻辑

```
system_duration = end_time - start_time（分钟）
gps_duration    = GPS有效轨迹时长（排除超时断连）
adjustment_time = 手动叠加时间�?30min / +60min / 自定义）
final_duration  = system_duration + adjustment_time
                  （或管理员手动覆盖）
```

## GPS 防作弊规则
| 规则 | 阈值 | 异常类型 |
|------|------|------|
| GPS 超时 | > 60秒无上报 | gps_disconnect |
| 速度异常 | > 140 km/h | speed_anomaly |
| 瞬移检测 | 距离 > 10km 且超过合理速度1.5倍 | teleport |
| 静止报警 | 在「多久不动报警」时长内位移 < 50m（可在系统设置调整） | stationary |

---

## 异常管理 /anomalies
| 方法 | 路径 | 描述 | 权限 |
|------|------|------|------|
| GET | /anomalies | 全部异常记录 | Admin / Dispatcher |
| GET | /anomalies/unresolved | 未处理异常 | Admin / Dispatcher |
| PATCH | /anomalies/:id/resolve | 标记已处理 | Admin / Dispatcher |
| PATCH | /anomalies/:id/ignore | 忽略报警（结案） | Admin / Dispatcher |
| PATCH | /anomalies/:id/snooze | 延时报警，body `{ minutes }`，延后后若仍未移动再次报警 | Admin / Dispatcher |

静止报警会自动升级：首次报警后等待「延时报警间隔」，仍未移动则二次、三次报警，直到「最多报警次数」。司机恢复移动后自动结案。

---

## 公告 /announcements
| 方法 | 路径 | 描述 | 权限 |
|------|------|------|------|
| GET | /announcements/feed | 按当前用户角色拉取生效公告 | 已登录（任意角色） |
| GET | /announcements | 全部公告（管理端） | Admin / Dispatcher |
| POST | /announcements | 发布公告，body `{ title, content, targetRole: all\|client\|driver }` | Admin / Dispatcher |
| PATCH | /announcements/:id/active | 启用/停用，body `{ active }` | Admin / Dispatcher |
| DELETE | /announcements/:id | 删除公告 | Admin / Dispatcher |

App（司机端/客户端）登录后调用 `/announcements/feed`，按角色弹出公告。

---

## 系统设置 /system-settings
| 方法 | 路径 | 描述 | 权限 |
|------|------|------|------|
| GET | /system-settings | 读取全部设置（`clear_data_password` 已脱敏，仅返回 `clear_data_password_set` 标志） | Admin |
| PUT | /system-settings | 更新设置（仅白名单键生效） | Admin |
| POST | /system-settings/clear-data | 清空业务数据，body `{ password }`，需匹配清空数据密码 | Admin |

可配置键：`clear_data_password`、`gps_stationary_minutes`、`gps_alarm_repeat`、`gps_alarm_delay_minutes`。
清空数据会 `TRUNCATE` 任务/工时/调整/GPS/异常/通知/公告（用户账号保留），操作写入审计日志。

> 注：账户审核通过后的「通知用户」邮件，由前端 `mailto:` 调起管理员本机邮箱客户端发送，**服务器不发邮件、无需 SMTP**。
