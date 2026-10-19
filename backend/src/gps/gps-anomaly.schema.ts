import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { DEVICE_ANOMALY_TYPES } from './gps-anomaly.entity';

/**
 * 启动时补齐 gps_anomalies 上「车载定位器报警」需要的结构（生产库 synchronize 关闭）。
 * 与 gps-device.schema.ts / ruc.schema.ts 同一套做法：幂等 DDL + 建完校验，校验不过就不启动。
 *
 * ── 为什么继续用 Postgres 枚举，而不是改成 varchar + check ──
 * anomaly_type 在生产库里已经是枚举列，改成 varchar 要重写整张表、还要把旧枚举类型删掉；
 * 这张表是「异常管理」页的数据源，改型失败就没得回退。而加值这件事本来就有现成解法。
 *
 * ── ALTER TYPE ... ADD VALUE 的事务限制怎么处理 ──
 * PG 12 以前这条语句根本不能出现在事务块里；PG 12 起可以，但**新值不能在同一个事务里被使用**。
 * 这里做了三件事，正好避开这两个坑：
 *  1) 每个枚举值单独一条语句。DataSource.query() 不开显式事务，一条语句 = 一个自动提交事务，
 *     语句返回时新值已经提交、后面的 INSERT 随便用。（也顺带保证一个值失败不影响其他值）
 *  2) 校验只从 pg_enum 里按**标签文本**读，绝不写 'shock'::anomaly_type 这种强制转换 ——
 *     那才是会触发 "unsafe use of new value" 的写法。
 *  3) 枚举类型名不写死：跟 database/database.sql 一样从 information_schema 里查 udt_name，
 *     老库/新库建出来的类型名不一定相同。
 */

/** 本次新增、必须存在于枚举里的值 */
export const NEW_ANOMALY_VALUES: string[] = DEVICE_ANOMALY_TYPES.map((t) => String(t));

/** 给某个枚举值生成一条自适配类型名的幂等 DDL */
function addEnumValue(value: string): string {
  return `DO $$
DECLARE enum_type text;
BEGIN
  SELECT udt_name INTO enum_type
  FROM information_schema.columns
  WHERE table_name = 'gps_anomalies' AND column_name = 'anomaly_type';
  IF enum_type IS NOT NULL AND EXISTS (SELECT 1 FROM pg_type WHERE typname = enum_type AND typtype = 'e') THEN
    EXECUTE format('ALTER TYPE %I ADD VALUE IF NOT EXISTS %L', enum_type, '${value}');
  END IF;
END $$`;
}

export const GPS_ANOMALY_DDL: string[] = [
  ...NEW_ANOMALY_VALUES.map(addEnumValue),
  // 车载报警在车辆没有进行中任务时也会发生（半夜撬车），那时没有司机可挂。
  // driver_id 保持 NOT NULL 的话，这类报警会在 INSERT 时静默失败 —— 正是这次要修的毛病。
  // ALTER 要 ACCESS EXCLUSIVE 锁：lock_timeout 必须和 ALTER 同一条语句发出去，
  // 否则连接池会把单独的 SET 分到别的连接上，等于没设。
  `SET lock_timeout = '5s'; ALTER TABLE gps_anomalies ALTER COLUMN driver_id DROP NOT NULL`,
  `ALTER TABLE gps_anomalies ADD COLUMN IF NOT EXISTS device_no VARCHAR(32)`,
  `ALTER TABLE gps_anomalies ADD COLUMN IF NOT EXISTS vehicle_plate VARCHAR(32)`,
  `ALTER TABLE gps_anomalies ADD COLUMN IF NOT EXISTS geofence_id UUID`,
  // 去重查询就是「这台设备这类报警还有没有未结案的」，给它一条部分索引
  `CREATE INDEX IF NOT EXISTS idx_gps_anomalies_open_device
     ON gps_anomalies(device_no, anomaly_type) WHERE resolved = FALSE`,
];

@Injectable()
export class GpsAnomalySchemaGuard implements OnModuleInit {
  private readonly logger = new Logger('GpsAnomalySchema');

  constructor(@InjectDataSource() private dataSource: DataSource) {}

  async onModuleInit(): Promise<void> {
    await this.ensureSchema();
  }

  /**
   * 失败就不启动：枚举少一个值，震动/断电/围栏报警会在写库时逐条抛错被吞掉，
   * 表面上一切正常、实际上报警又一次全丢了 —— 那正是这次要修的 bug，不能带着它上线。
   */
  async ensureSchema(): Promise<void> {
    const failures: string[] = [];
    for (const statement of GPS_ANOMALY_DDL) {
      try {
        await this.dataSource.query(statement);
      } catch (e: any) {
        // 某一条失败不影响后面几条：可能只是某个值早就加过了
        failures.push(e?.message || String(e));
      }
    }

    const missing = await this.missingEnumValues();
    if (missing.length) {
      throw new Error(
        `gps_anomalies.anomaly_type is missing enum value(s) ${missing.join(', ')} and they could not be added — `
        + 'run database/migrations/2026-09-23_device_alarms_geofences.sql in the database, then redeploy. '
        + `Details: ${failures.join(' | ') || 'no error reported'}`,
      );
    }

    const [{ ok: columnsOk }] = await this.dataSource.query(
      `SELECT COUNT(*) = 3 AS ok FROM information_schema.columns
       WHERE table_name = 'gps_anomalies' AND column_name IN ('device_no', 'vehicle_plate', 'geofence_id')`,
    );
    if (!columnsOk) {
      throw new Error(
        'gps_anomalies is missing device_no / vehicle_plate / geofence_id — '
        + 'run database/migrations/2026-09-23_device_alarms_geofences.sql, then redeploy. '
        + `Details: ${failures.join(' | ') || 'no error reported'}`,
      );
    }

    // driver_id 改成可空，是这次最可能失败的一条：它要拿排他锁，而且我们只给了 5 秒。
    // 表忙的时候超时，错误会被收进 failures、启动照样成功——然后第一条「车停着、
    // 没有司机」的断电报警插入就撞上 NOT NULL，记录无声丢失。那正是这次要修的 bug，
    // 所以这里必须验证、不通过就拒绝启动。
    const [nullable] = await this.dataSource.query(
      `SELECT is_nullable FROM information_schema.columns
       WHERE table_name = 'gps_anomalies' AND column_name = 'driver_id'`,
    );
    if (nullable && nullable.is_nullable !== 'YES') {
      throw new Error(
        'gps_anomalies.driver_id is still NOT NULL, so an alarm on a parked truck with no driver cannot be recorded — '
        + 'run database/migrations/2026-09-23_device_alarms_geofences.sql, then redeploy. '
        + `Details: ${failures.join(' | ') || 'no error reported'}`,
      );
    }

    if (failures.length) {
      this.logger.warn(`schema statements reported errors but the schema is valid: ${failures.join(' | ')}`);
    }
    this.logger.log('gps_anomalies device-alarm schema verified');
  }

  /**
   * 按标签文本比对 pg_enum。列已经被改成 varchar/text 的库没有枚举要维护，直接算通过。
   */
  private async missingEnumValues(): Promise<string[]> {
    const rows = await this.dataSource.query(
      `SELECT data_type, udt_name FROM information_schema.columns
       WHERE table_name = 'gps_anomalies' AND column_name = 'anomaly_type'`,
    );
    const column = rows?.[0];
    if (!column) return NEW_ANOMALY_VALUES; // 表都没有，后面的列校验也会抛，这里先报出来
    if (column.data_type !== 'USER-DEFINED') return []; // varchar + check：没有枚举要补

    const labels = await this.dataSource.query(
      `SELECT e.enumlabel AS label FROM pg_enum e
         JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = $1`,
      [column.udt_name],
    );
    const present = new Set((labels ?? []).map((r: any) => r.label));
    return NEW_ANOMALY_VALUES.filter((v) => !present.has(v));
  }
}
