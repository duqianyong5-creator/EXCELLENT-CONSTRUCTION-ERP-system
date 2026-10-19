import * as fs from 'fs';
import * as path from 'path';
import { Logger } from '@nestjs/common';
import { GpsAnomalySchemaGuard, GPS_ANOMALY_DDL, NEW_ANOMALY_VALUES } from './gps-anomaly.schema';
import { AnomalyType } from './gps-anomaly.entity';

/**
 * 按 SQL 文本响应而不是按调用顺序，DDL 增减时测试不会跟着碎掉。
 */
function guardWith(opts: {
  enumLabels?: string[];
  dataType?: string;
  columnsOk?: boolean;
  driverNullable?: boolean;
  noColumn?: boolean;
  ddlFails?: boolean | number;
} = {}) {
  const {
    enumLabels = ['gps_disconnect', ...NEW_ANOMALY_VALUES],
    dataType = 'USER-DEFINED',
    columnsOk = true,
    driverNullable = true,
    noColumn = false,
    ddlFails = false,
  } = opts;
  let ddlCalls = 0;
  const query = jest.fn(async (sql: string) => {
    if (sql.includes('data_type, udt_name')) return noColumn ? [] : [{ data_type: dataType, udt_name: 'anomaly_type' }];
    if (sql.includes('pg_enum')) return enumLabels.map((label) => ({ label }));
    // 顺序要紧：is_nullable 的查询也包含 information_schema.columns，得先匹配它
    if (sql.includes('is_nullable')) return [{ is_nullable: driverNullable ? 'YES' : 'NO' }];
    if (sql.includes('information_schema.columns')) return [{ ok: columnsOk }];
    ddlCalls++;
    const shouldFail = ddlFails === true || (typeof ddlFails === 'number' && ddlCalls === ddlFails);
    if (shouldFail) throw new Error('permission denied');
    return undefined;
  });
  return { guard: new GpsAnomalySchemaGuard({ query } as any), query };
}

describe('GpsAnomalySchemaGuard', () => {
  beforeAll(() => { Logger.overrideLogger(false); });

  it('refuses to boot while driver_id is still NOT NULL', async () => {
    // 这条 ALTER 要排他锁、只给 5 秒，表忙时最容易超时失败。
    // 失败了还放行启动的话，第一条停着的车的断电报警就会撞 NOT NULL 无声丢失。
    const { guard } = guardWith({ driverNullable: false });
    await expect(guard.onModuleInit()).rejects.toThrow(/driver_id is still NOT NULL/);
  });

  it('runs every DDL statement and then verifies the result', async () => {
    const { guard, query } = guardWith();
    await guard.ensureSchema();
    const executed = query.mock.calls.map((c) => c[0]);
    for (const ddl of GPS_ANOMALY_DDL) expect(executed).toContain(ddl);
  });

  it('keeps going after one statement fails, as long as the schema ends up valid', async () => {
    const { guard, query } = guardWith({ ddlFails: 1 });
    await expect(guard.ensureSchema()).resolves.toBeUndefined();
    expect(query.mock.calls.map((c) => c[0])).toContain(
      GPS_ANOMALY_DDL.find((s) => s.includes('device_no')),
    );
  });

  it('REFUSES TO START when an enum value is missing (alarms would silently fail to insert)', async () => {
    const { guard } = guardWith({ ddlFails: true, enumLabels: ['gps_disconnect', 'shock'] });
    await expect(guard.ensureSchema())
      .rejects.toThrow(/missing enum value\(s\)[\s\S]*power_cut[\s\S]*2026-09-23_device_alarms_geofences\.sql/);
  });

  it('refuses to start when device_no / vehicle_plate / geofence_id are missing', async () => {
    const { guard } = guardWith({ columnsOk: false });
    await expect(guard.ensureSchema()).rejects.toThrow(/device_no \/ vehicle_plate \/ geofence_id/);
  });

  it('onModuleInit propagates the failure so the deploy fails instead of booting broken', async () => {
    const { guard } = guardWith({ columnsOk: false });
    await expect(guard.onModuleInit()).rejects.toThrow();
  });

  it('accepts a database whose column was migrated to varchar (nothing to add there)', async () => {
    // 有人把枚举换成 varchar + check 的话，这里不该再去找 pg_enum、更不该拦着启动
    const { guard, query } = guardWith({ dataType: 'character varying', enumLabels: [] });
    await expect(guard.ensureSchema()).resolves.toBeUndefined();
    expect(query.mock.calls.map((c) => c[0]).some((s) => String(s).includes('pg_enum'))).toBe(false);
  });

  it('reports the missing values when the table itself is absent', async () => {
    const { guard } = guardWith({ noColumn: true });
    await expect(guard.ensureSchema()).rejects.toThrow(/missing enum value/);
  });
});

describe('GPS_ANOMALY_DDL handles the ALTER TYPE transaction rules', () => {
  const enumStatements = GPS_ANOMALY_DDL.filter((s) => s.includes('ALTER TYPE'));

  it('adds every new AnomalyType the device alarms use', () => {
    for (const value of [AnomalyType.SHOCK, AnomalyType.POWER_CUT, AnomalyType.GEOFENCE_ENTER, AnomalyType.GEOFENCE_LEAVE]) {
      expect(NEW_ANOMALY_VALUES).toContain(String(value));
      expect(enumStatements.some((s) => s.includes(`'${value}'`))).toBe(true);
    }
  });

  it('uses one statement per value so each gets its own auto-commit transaction', () => {
    // 一条语句加多个值的话，前一个值的提交点和后一个搅在一起，
    // 而且一个值失败会把整批带走。
    expect(enumStatements).toHaveLength(NEW_ANOMALY_VALUES.length);
    for (const s of enumStatements) {
      expect((s.match(/ALTER TYPE/g) || [])).toHaveLength(1);
    }
  });

  it('uses ADD VALUE IF NOT EXISTS so it can run on every boot', () => {
    for (const s of enumStatements) expect(s).toMatch(/ADD VALUE IF NOT EXISTS/);
  });

  it('looks the enum type name up instead of hard-coding it', () => {
    // 老库和新库建出来的类型名不一定一样
    for (const s of enumStatements) {
      expect(s).toContain('udt_name');
      expect(s).toMatch(/format\('ALTER TYPE %I ADD VALUE IF NOT EXISTS %L'/);
    }
  });

  it('never casts a literal to the enum type (that is what breaks in-transaction)', () => {
    // 'shock'::anomaly_type 在刚加完值的同一个事务里会报 unsafe use of new value
    for (const s of GPS_ANOMALY_DDL) expect(s).not.toMatch(/::\s*anomaly_type/);
  });

  it('keeps the column-adding statements idempotent (they run on every boot)', () => {
    for (const statement of GPS_ANOMALY_DDL) {
      if (/^\s*(CREATE TABLE|CREATE INDEX|ALTER TABLE \w+ ADD COLUMN)/i.test(statement)) {
        expect(statement).toMatch(/IF NOT EXISTS/i);
      }
    }
  });

  it('sets the lock timeout in the same statement as the ALTER (pool hands out other connections)', () => {
    const alter = GPS_ANOMALY_DDL.find((s) => s.includes('DROP NOT NULL')) as string;
    expect(alter).toMatch(/lock_timeout/);
  });
});

describe('GPS_ANOMALY_DDL stays in sync with the SQL migration', () => {
  const migration = fs.readFileSync(
    path.join(__dirname, '../../../database/migrations/2026-09-23_device_alarms_geofences.sql'),
    'utf8',
  );

  it('adds the same enum values', () => {
    for (const value of NEW_ANOMALY_VALUES) expect(migration).toContain(`'${value}'`);
  });

  it('adds the same columns and index, and drops the same NOT NULL', () => {
    for (const col of ['device_no', 'vehicle_plate', 'geofence_id']) expect(migration).toContain(col);
    expect(migration).toContain('idx_gps_anomalies_open_device');
    expect(migration).toContain('ALTER COLUMN driver_id DROP NOT NULL');
  });

  it('creates the geofences table the entity needs', () => {
    for (const col of ['center_lat', 'center_lng', 'radius_m', 'alert_on_enter', 'alert_on_leave']) {
      expect(migration).toContain(col);
    }
  });
});
