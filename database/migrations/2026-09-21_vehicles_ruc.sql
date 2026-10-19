-- ============================================================
-- 车辆档案 + 新西兰 RUC 路税提醒（2026-09-21）
-- 后端启动时会自动执行等效语句（backend/src/ruc/ruc.schema.ts）；
-- 若数据库账号没有建表权限，则在 Supabase SQL Editor 手动执行本文件。
-- 可重复执行（幂等）。
-- ============================================================

CREATE TABLE IF NOT EXISTS vehicles (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plate                   VARCHAR(32) NOT NULL UNIQUE,   -- 归一化车牌（大写、去空格连字符）
    display_plate           VARCHAR(32) NOT NULL,          -- 录入时的原始写法
    label                   VARCHAR(128),
    -- RUC 许可：按里程购买，跑过 ruc_end_km 之前必须续买
    ruc_licence_no          VARCHAR(64),
    ruc_start_km            DECIMAL(12, 2),
    ruc_end_km              DECIMAL(12, 2),
    ruc_purchased_at        TIMESTAMPTZ,
    ruc_alert_level         INT NOT NULL DEFAULT 0,        -- 已提醒到第几级，避免重复推送
    -- 里程估算（法定依据是车上 hubodometer，这里是估算值）
    odometer_km             DECIMAL(12, 2),
    odometer_calibrated_km  DECIMAL(12, 2),
    odometer_calibrated_at  TIMESTAMPTZ,
    last_device_odo_km      DECIMAL(12, 2),                -- 定位器自身里程计上次读数
    odometer_updated_at     TIMESTAMPTZ,
    odo_snapshot_km         DECIMAL(12, 2),                -- 日均里程的滚动起算点
    odo_snapshot_at         TIMESTAMPTZ,
    enabled                 BOOLEAN NOT NULL DEFAULT TRUE,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE vehicles ENABLE ROW LEVEL SECURITY;
