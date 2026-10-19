-- ============================================================
-- 货车司机调度与管理系统 - 统一数据库脚本
-- PostgreSQL 15+ / Supabase SQL Editor
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- ENUM 类型
-- ============================================================
DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('admin', 'dispatcher', 'driver', 'client');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE user_status AS ENUM ('pending', 'active', 'rejected', 'disabled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE task_status AS ENUM ('pending', 'assigned', 'in_progress', 'completed', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE anomaly_type AS ENUM ('gps_disconnect', 'speed_anomaly', 'teleport', 'time_inconsistency');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- 用户表
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username    VARCHAR(64) UNIQUE NOT NULL,
    email       VARCHAR(128) UNIQUE NOT NULL,
    password    VARCHAR(256) NOT NULL,
    role        user_role NOT NULL DEFAULT 'driver',
    status      user_status NOT NULL DEFAULT 'pending',
    full_name   VARCHAR(128),
    phone       VARCHAR(32),
    avatar_url  VARCHAR(512),
    language    VARCHAR(8) DEFAULT 'zh',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    approved_at TIMESTAMPTZ,
    approved_by UUID REFERENCES users(id)
);

-- ============================================================
-- 任务表
-- ============================================================
CREATE TABLE IF NOT EXISTS tasks (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_id       UUID NOT NULL REFERENCES users(id),
    driver_id       UUID REFERENCES users(id),
    dispatcher_id   UUID REFERENCES users(id),
    title           VARCHAR(256) NOT NULL,
    start_location  VARCHAR(512) NOT NULL,
    end_location    VARCHAR(512) NOT NULL,
    start_lat       DECIMAL(10, 7),
    start_lng       DECIMAL(10, 7),
    end_lat         DECIMAL(10, 7),
    end_lng         DECIMAL(10, 7),
    cargo           TEXT,
    cargo_weight    DECIMAL(10, 2),
    scheduled_at    TIMESTAMPTZ,
    status          task_status NOT NULL DEFAULT 'pending',
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- GPS 轨迹日志
-- ============================================================
CREATE TABLE IF NOT EXISTS gps_logs (
    id          BIGSERIAL PRIMARY KEY,
    driver_id   UUID NOT NULL REFERENCES users(id),
    task_id     UUID REFERENCES tasks(id),
    latitude    DECIMAL(10, 7) NOT NULL,
    longitude   DECIMAL(10, 7) NOT NULL,
    speed       DECIMAL(6, 2) DEFAULT 0,
    heading     DECIMAL(5, 2),
    accuracy    DECIMAL(6, 2),
    timestamp   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_anomaly  BOOLEAN DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_gps_logs_driver_task ON gps_logs(driver_id, task_id);
CREATE INDEX IF NOT EXISTS idx_gps_logs_timestamp ON gps_logs(timestamp DESC);

-- ============================================================
-- 工作记录表
-- ============================================================
CREATE TABLE IF NOT EXISTS work_records (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    driver_id         UUID NOT NULL REFERENCES users(id),
    task_id           UUID NOT NULL REFERENCES tasks(id),
    start_time        TIMESTAMPTZ,
    end_time          TIMESTAMPTZ,
    system_duration   INTEGER DEFAULT 0,
    gps_duration      INTEGER DEFAULT 0,
    final_duration    INTEGER DEFAULT 0,
    adjustment_time   INTEGER DEFAULT 0,
    image_urls        TEXT[],
    completion_notes  TEXT,
    anomaly_flag      BOOLEAN DEFAULT FALSE,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 工时调整日志
-- ============================================================
CREATE TABLE IF NOT EXISTS adjustment_logs (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    driver_id       UUID NOT NULL REFERENCES users(id),
    task_id         UUID NOT NULL REFERENCES tasks(id),
    work_record_id  UUID REFERENCES work_records(id),
    added_minutes   INTEGER NOT NULL,
    reason          TEXT,
    operator_id     UUID NOT NULL REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- GPS 异常记录
-- ============================================================
CREATE TABLE IF NOT EXISTS gps_anomalies (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    driver_id     UUID NOT NULL REFERENCES users(id),
    task_id       UUID REFERENCES tasks(id),
    anomaly_type  anomaly_type NOT NULL,
    description   TEXT,
    latitude      DECIMAL(10, 7),
    longitude     DECIMAL(10, 7),
    speed         DECIMAL(6, 2),
    detected_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved      BOOLEAN DEFAULT FALSE,
    resolved_at   TIMESTAMPTZ,
    resolved_by   UUID REFERENCES users(id)
);

-- ============================================================
-- 通知表
-- ============================================================
CREATE TABLE IF NOT EXISTS notifications (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     UUID NOT NULL REFERENCES users(id),
    title       VARCHAR(256) NOT NULL,
    content     TEXT NOT NULL,
    type        VARCHAR(64),
    is_read     BOOLEAN DEFAULT FALSE,
    meta        JSONB,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read);

-- ============================================================
-- 自动更新 updated_at
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_users_updated_at') THEN
    CREATE TRIGGER trg_users_updated_at
      BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_tasks_updated_at') THEN
    CREATE TRIGGER trg_tasks_updated_at
      BEFORE UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_work_records_updated_at') THEN
    CREATE TRIGGER trg_work_records_updated_at
      BEFORE UPDATE ON work_records FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;

-- ============================================================
-- Supabase 行级安全（Row Level Security）
-- 后端使用 service_role key 访问时会绕过 RLS。
-- 如需前端直连 Supabase，应按业务角色另行添加访问策略。
-- ============================================================
ALTER TABLE users         ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks         ENABLE ROW LEVEL SECURITY;
ALTER TABLE gps_logs      ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_records  ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 默认管理员账号
-- 邮箱: admin@trucksystem.com
-- 初始密码: admin888（下方以 bcrypt 哈希形式存储）
-- 上线前请立即修改默认密码。
-- ============================================================
INSERT INTO users (username, email, password, role, status, full_name, approved_at)
VALUES (
    'admin',
    'admin@trucksystem.com',
    '$2b$12$r2Ms3P63.DtdHMVee9b//ejvkNLVUlviWiMcqxxnnjmQBC1kIp30O',
    'admin',
    'active',
    '系统管理员',
    NOW()
) ON CONFLICT (email) DO NOTHING;


-- ============================================================
-- 操作审计日志
-- ============================================================
CREATE TABLE IF NOT EXISTS operation_logs (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    actor_id     UUID REFERENCES users(id) ON DELETE SET NULL,
    actor_name   VARCHAR(128),
    action       VARCHAR(96) NOT NULL,
    target_type  VARCHAR(64),
    target_id    VARCHAR(128),
    description  TEXT NOT NULL,
    details      JSONB,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_operation_logs_created_at ON operation_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_operation_logs_actor ON operation_logs(actor_id);
ALTER TABLE operation_logs ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 增量迁移：本期新增功能（公告 / 系统设置 / 车牌 / GPS 静止报警）
-- 整个脚本可重复执行，已存在的对象会被跳过。
-- ============================================================

-- 公告目标人群枚举
DO $$ BEGIN
  CREATE TYPE announcement_target AS ENUM ('all', 'client', 'driver');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 给用户角色补充「监控（大屏）」值（自动适配该列实际使用的枚举类型名）
DO $$
DECLARE enum_type text;
BEGIN
  SELECT udt_name INTO enum_type
  FROM information_schema.columns
  WHERE table_name = 'users' AND column_name = 'role';
  IF enum_type IS NOT NULL THEN
    EXECUTE format('ALTER TYPE %I ADD VALUE IF NOT EXISTS %L', enum_type, 'monitor');
  END IF;
END $$;

-- 给 GPS 异常类型补充「静止报警」与车载定位器报警（震动/断电/进出围栏/掉线）的值。
-- 自动适配该列实际使用的枚举类型名；一个值一条 ALTER，且本文件不 INSERT 这些值
-- （ALTER TYPE ... ADD VALUE 加进去的值不能在同一个事务里被使用）。
DO $$
DECLARE enum_type text; v text;
BEGIN
  SELECT udt_name INTO enum_type
  FROM information_schema.columns
  WHERE table_name = 'gps_anomalies' AND column_name = 'anomaly_type';
  IF enum_type IS NOT NULL THEN
    FOREACH v IN ARRAY ARRAY['stationary', 'shock', 'power_cut', 'geofence_enter', 'geofence_leave', 'device_offline'] LOOP
      EXECUTE format('ALTER TYPE %I ADD VALUE IF NOT EXISTS %L', enum_type, v);
    END LOOP;
  END IF;
END $$;

-- 车载定位器报警可能没有司机（车辆空闲时被撬），靠 device_no / vehicle_plate 定位到车
ALTER TABLE gps_anomalies ALTER COLUMN driver_id DROP NOT NULL;
ALTER TABLE gps_anomalies ADD COLUMN IF NOT EXISTS device_no     VARCHAR(32);
ALTER TABLE gps_anomalies ADD COLUMN IF NOT EXISTS vehicle_plate VARCHAR(32);
ALTER TABLE gps_anomalies ADD COLUMN IF NOT EXISTS geofence_id   UUID;
CREATE INDEX IF NOT EXISTS idx_gps_anomalies_open_device
  ON gps_anomalies(device_no, anomaly_type) WHERE resolved = FALSE;

-- 圆形电子围栏（平台侧判定；厂家固件不支持 0x8600 设置圆形区域）
CREATE TABLE IF NOT EXISTS geofences (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name           VARCHAR(128) NOT NULL,
    center_lat     DECIMAL(10, 7) NOT NULL,
    center_lng     DECIMAL(10, 7) NOT NULL,
    radius_m       INT NOT NULL,
    vehicle_plate  VARCHAR(32),
    enabled        BOOLEAN NOT NULL DEFAULT TRUE,
    alert_on_enter BOOLEAN NOT NULL DEFAULT TRUE,
    alert_on_leave BOOLEAN NOT NULL DEFAULT TRUE,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_geofences_plate ON geofences(vehicle_plate);
ALTER TABLE geofences ENABLE ROW LEVEL SECURITY;

-- 任务表：车牌 + 起点地址改为可空
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS vehicle_plate VARCHAR(32);
ALTER TABLE tasks ALTER COLUMN start_location DROP NOT NULL;

-- GPS 异常：报警升级所需字段
ALTER TABLE gps_anomalies ADD COLUMN IF NOT EXISTS alarm_count  INTEGER NOT NULL DEFAULT 1;
ALTER TABLE gps_anomalies ADD COLUMN IF NOT EXISTS snooze_until TIMESTAMPTZ;

-- 系统设置（键值表：清空数据密码、GPS 报警参数等）
CREATE TABLE IF NOT EXISTS system_settings (
    key        VARCHAR(64) PRIMARY KEY,
    value      TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 公告表
CREATE TABLE IF NOT EXISTS announcements (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title       VARCHAR(200) NOT NULL,
    content     TEXT NOT NULL,
    target_role announcement_target NOT NULL DEFAULT 'all',
    active      BOOLEAN NOT NULL DEFAULT TRUE,
    created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_announcements_active ON announcements(active, target_role);

ALTER TABLE system_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE announcements   ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 车载 JT808 GPS 定位器（设备号 ↔ 车牌）
-- ============================================================
ALTER TABLE gps_logs ADD COLUMN IF NOT EXISTS source VARCHAR(16) NOT NULL DEFAULT 'app';

CREATE TABLE IF NOT EXISTS gps_devices (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    device_no       VARCHAR(32) NOT NULL UNIQUE,
    vehicle_plate   VARCHAR(32),
    name            VARCHAR(128),
    enabled         BOOLEAN NOT NULL DEFAULT TRUE,
    iccid           VARCHAR(32),
    last_seen_at    TIMESTAMPTZ,
    last_latitude   DECIMAL(10, 7),
    last_longitude  DECIMAL(10, 7),
    last_speed      DECIMAL(6, 2),
    last_fix_at     TIMESTAMPTZ,
    battery_percent INT,
    external_power  BOOLEAN,
    signal_percent  INT,
    last_task_id    UUID,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_gps_devices_plate ON gps_devices(vehicle_plate);
ALTER TABLE gps_devices ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 验证表是否创建完成
-- ============================================================
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;
