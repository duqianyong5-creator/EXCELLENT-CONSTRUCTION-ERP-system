-- ============================================================
-- 车载 JT808 GPS 定位器接入（2026-09-14）
-- 生产库（synchronize 关闭）请在 Supabase SQL Editor 执行本文件；
-- 开发库由 TypeORM synchronize 自动建表，无需手动执行。
-- 可重复执行（幂等）。
-- ============================================================

-- gps_logs 增加来源：'app' 手机 App | 'device' 车载定位器
ALTER TABLE gps_logs ADD COLUMN IF NOT EXISTS source VARCHAR(16) NOT NULL DEFAULT 'app';

-- 定位器登记表：设备号 ↔ 车牌；司机接单时填写的车牌与之匹配，位置点即归属该司机/任务
-- gen_random_uuid() 是 PG13+ 内置函数，与后端启动时自动执行的 DDL 保持一致
CREATE TABLE IF NOT EXISTS gps_devices (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_no       VARCHAR(32) NOT NULL UNIQUE,   -- 归一化设备号（纯数字、无前导 0）
    vehicle_plate   VARCHAR(32),
    name            VARCHAR(128),
    enabled         BOOLEAN NOT NULL DEFAULT TRUE,
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
