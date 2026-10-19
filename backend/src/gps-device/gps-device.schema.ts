import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

/**
 * 启动时自检并补齐车载定位器相关的表结构。
 *
 * 生产库 synchronize 是关闭的：如果先部署新代码、后执行 SQL 迁移，
 * gps_logs 少一个 source 列会让所有 GPS 上报与轨迹查询直接报错（地图全黑）。
 * 这里用幂等 DDL 在服务启动、开始对外提供接口之前补齐，消除上线顺序风险。
 * 已经执行过 database/migrations 的库，这些语句都是空操作。
 */
export const GPS_DEVICE_DDL: string[] = [
  // ALTER 需要 ACCESS EXCLUSIVE 锁：加超时，避免有长查询时把启动卡死。
  // lock_timeout 必须和 ALTER 在同一条语句里发出去——连接池会把两次 query 分到不同连接上，
  // 单独发一条 SET 是设给了别的连接，等于没设。
  `SET lock_timeout = '5s'; ALTER TABLE gps_logs ADD COLUMN IF NOT EXISTS source VARCHAR(16) NOT NULL DEFAULT 'app'`,
  `CREATE TABLE IF NOT EXISTS gps_devices (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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
   )`,
  `CREATE INDEX IF NOT EXISTS idx_gps_devices_plate ON gps_devices(vehicle_plate)`,
  // 2026-10-19 追加：SIM 卡 ICCID。老库的表已经建好了，CREATE TABLE IF NOT EXISTS 不会补列。
  // 同样要带 lock_timeout：滚动部署时旧实例还在每帧 UPDATE 这张表，ALTER 等锁不能把启动卡死
  `SET lock_timeout = '5s'; ALTER TABLE gps_devices ADD COLUMN IF NOT EXISTS iccid VARCHAR(32)`,
  // 与 database/migrations 里的脚本保持一致：两条路径不能建出安全属性不同的表
  `ALTER TABLE gps_devices ENABLE ROW LEVEL SECURITY`,
  // 圆形电子围栏。设备端不支持 0x8600，围栏由平台侧逐点判定（见 geofence.service.ts）
  `CREATE TABLE IF NOT EXISTS geofences (
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
   )`,
  `CREATE INDEX IF NOT EXISTS idx_geofences_plate ON geofences(vehicle_plate)`,
  `ALTER TABLE geofences ENABLE ROW LEVEL SECURITY`,
];

@Injectable()
export class GpsDeviceSchemaGuard implements OnModuleInit {
  private readonly logger = new Logger('GpsDeviceSchema');

  constructor(@InjectDataSource() private dataSource: DataSource) {}

  async onModuleInit(): Promise<void> {
    await this.ensureSchema();
  }

  /**
   * 注意这里是「失败就不启动」：gps_logs.source 一旦缺失，连手机 App 的定位上报也会全部报错，
   * 整个车队在地图上直接消失。与其带病上线，不如让这次部署失败、让 Railway 继续跑上一个正常版本。
   */
  async ensureSchema(): Promise<void> {
    const failures: string[] = [];
    for (const statement of GPS_DEVICE_DDL) {
      try {
        await this.dataSource.query(statement);
      } catch (e: any) {
        // 某一条失败不影响后面几条：表可能已存在、只是缺索引
        failures.push(e?.message || String(e));
      }
    }

    const [{ ok }] = await this.dataSource.query(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_name = 'gps_logs' AND column_name = 'source'
       ) AS ok`,
    );
    if (!ok) {
      throw new Error(
        'gps_logs.source is missing and could not be created — run database/migrations/2026-09-14_gps_devices.sql '
        + `in the database, then redeploy. Details: ${failures.join(' | ') || 'no error reported'}`,
      );
    }

    const [{ ok: devicesOk }] = await this.dataSource.query(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.tables
         WHERE table_name = 'gps_devices'
       ) AS ok`,
    );
    if (!devicesOk) {
      throw new Error(
        'gps_devices table is missing and could not be created — run database/migrations/2026-09-14_gps_devices.sql. '
        + `Details: ${failures.join(' | ') || 'no error reported'}`,
      );
    }

    // 实体已经 select 这一列：列不在的话每一帧的 findByDeviceNo 和设备页都会 500，整个车队掉线。
    // 上面那条 ALTER 失败会被收进 failures、启动照样继续 —— 所以这里必须单独验
    const [{ ok: iccidOk }] = await this.dataSource.query(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_name = 'gps_devices' AND column_name = 'iccid'
       ) AS ok`,
    );
    if (!iccidOk) {
      throw new Error(
        'gps_devices.iccid is missing and could not be added — run database/migrations/2026-10-19_gps_devices_iccid.sql, then redeploy. '
        + `Details: ${failures.join(' | ') || 'no error reported'}`,
      );
    }

    const [{ ok: geofencesOk }] = await this.dataSource.query(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.tables
         WHERE table_name = 'geofences'
       ) AS ok`,
    );
    if (!geofencesOk) {
      // 围栏表缺失 = 每个定位点的围栏判定都会抛错。那段代码在上报路径上，
      // 抛不出去只会被吞掉、报警静默消失 —— 宁可这次部署失败。
      throw new Error(
        'geofences table is missing and could not be created — run database/migrations/2026-09-23_device_alarms_geofences.sql. '
        + `Details: ${failures.join(' | ') || 'no error reported'}`,
      );
    }

    if (failures.length) {
      this.logger.warn(`schema statements reported errors but the schema is valid: ${failures.join(' | ')}`);
    }
    this.logger.log('gps_devices / gps_logs.source / geofences schema verified');
  }
}
