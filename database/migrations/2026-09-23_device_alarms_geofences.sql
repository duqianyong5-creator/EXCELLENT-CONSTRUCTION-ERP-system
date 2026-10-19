-- ============================================================
-- 车载定位器报警（震动 / 断电）与圆形电子围栏
--
-- 后端启动时的 GpsAnomalySchemaGuard / GpsDeviceSchemaGuard 会执行等价的幂等 DDL，
-- 这份脚本是给「先跑 SQL 再部署」的人用的，两条路径必须建出完全一样的结构。
-- 整份脚本可以重复执行。
-- ============================================================

-- 报警类型：补充新值（2026-09-28 追加 device_offline：接车电的定位器突然消失）。
-- ALTER TYPE ... ADD VALUE 在 PG 12 之前不能出现在事务块里，PG 12 起可以，
-- 但新值不能在同一个事务里被使用 —— 所以这里一个值一条语句、且不在本脚本里 INSERT 这些值。
-- 枚举类型名不写死：老库/新库建出来的名字不一定相同，从列定义反查。
DO $$
DECLARE enum_type text; v text;
BEGIN
  SELECT udt_name INTO enum_type
  FROM information_schema.columns
  WHERE table_name = 'gps_anomalies' AND column_name = 'anomaly_type';
  IF enum_type IS NOT NULL AND EXISTS (SELECT 1 FROM pg_type WHERE typname = enum_type AND typtype = 'e') THEN
    FOREACH v IN ARRAY ARRAY['shock', 'power_cut', 'geofence_enter', 'geofence_leave', 'device_offline'] LOOP
      EXECUTE format('ALTER TYPE %I ADD VALUE IF NOT EXISTS %L', enum_type, v);
    END LOOP;
  END IF;
END $$;

-- 定位器报警在车辆没有进行中任务时也会发生（半夜撬车就是这种），那时没有司机可挂。
-- driver_id 保持 NOT NULL 的话，这类报警会在 INSERT 时失败、报警再一次静默消失。
ALTER TABLE gps_anomalies ALTER COLUMN driver_id DROP NOT NULL;

-- 没有司机时，靠这两列才知道是哪台车
ALTER TABLE gps_anomalies ADD COLUMN IF NOT EXISTS device_no     VARCHAR(32);
ALTER TABLE gps_anomalies ADD COLUMN IF NOT EXISTS vehicle_plate VARCHAR(32);
ALTER TABLE gps_anomalies ADD COLUMN IF NOT EXISTS geofence_id   UUID;

-- 去重查的就是「这台设备这类报警还有没有未结案的」
CREATE INDEX IF NOT EXISTS idx_gps_anomalies_open_device
  ON gps_anomalies(device_no, anomaly_type) WHERE resolved = FALSE;

-- ============================================================
-- 圆形电子围栏
--
-- 厂家协议 V1.54 没有 0x8600「设置圆形区域」（全文与附录A消息对照表都没有），
-- 所以围栏不下发到设备，由后端拿每个定位点自己比。
-- ============================================================
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
