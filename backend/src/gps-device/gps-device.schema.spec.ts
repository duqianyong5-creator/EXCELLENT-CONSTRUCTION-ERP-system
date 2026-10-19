import * as fs from 'fs';
import * as path from 'path';
import { Logger } from '@nestjs/common';
import { getMetadataArgsStorage } from 'typeorm';
import { GpsDeviceSchemaGuard, GPS_DEVICE_DDL } from './gps-device.schema';
import { GpsDevice } from './gps-device.entity';
import { Geofence } from './geofence.entity';

/**
 * 按 SQL 文本响应，而不是按调用顺序：DDL 语句增减时测试不会跟着碎掉。
 */
function guardWith(opts: {
  columnOk?: boolean; iccidOk?: boolean; tableOk?: boolean; geofencesOk?: boolean; ddlFails?: boolean | number;
} = {}) {
  const { columnOk = true, iccidOk = true, tableOk = true, geofencesOk = true, ddlFails = false } = opts;
  let ddlCalls = 0;
  const query = jest.fn(async (sql: string) => {
    if (sql.includes("column_name = 'iccid'")) return [{ ok: iccidOk }];
    if (sql.includes('information_schema.columns')) return [{ ok: columnOk }];
    if (sql.includes("table_name = 'geofences'")) return [{ ok: geofencesOk }];
    if (sql.includes('information_schema.tables')) return [{ ok: tableOk }];
    ddlCalls++;
    const shouldFail = ddlFails === true || (typeof ddlFails === 'number' && ddlCalls === ddlFails);
    if (shouldFail) throw new Error('permission denied');
    return undefined;
  });
  return { guard: new GpsDeviceSchemaGuard({ query } as any), query };
}

describe('GpsDeviceSchemaGuard', () => {
  beforeAll(() => { Logger.overrideLogger(false); });

  it('runs every DDL statement and then verifies the result', async () => {
    const { guard, query } = guardWith();
    await guard.ensureSchema();
    const executed = query.mock.calls.map((c) => c[0]);
    for (const ddl of GPS_DEVICE_DDL) expect(executed).toContain(ddl);
    expect(executed.filter((s) => s.includes('information_schema'))).toHaveLength(4);
  });

  it('refuses to start when gps_devices.iccid is missing (the entity already selects it)', async () => {
    const { guard } = guardWith({ iccidOk: false });
    await expect(guard.ensureSchema()).rejects.toThrow(/gps_devices\.iccid/);
  });

  it('sets the lock timeout on the iccid ALTER too', () => {
    const alter = GPS_DEVICE_DDL.find((s) => s.includes('ADD COLUMN IF NOT EXISTS iccid')) as string;
    expect(alter).toMatch(/^SET lock_timeout = '5s'; ALTER/);
  });

  it('sets the lock timeout in the same statement as the ALTER (pool hands out other connections)', () => {
    const alter = GPS_DEVICE_DDL.find((s) => s.includes('ALTER TABLE gps_logs')) as string;
    expect(alter).toMatch(/lock_timeout/);
    // 单独一条 SET 会被分到别的连接上，等于没设
    expect(GPS_DEVICE_DDL.some((s) => /^\s*SET lock_timeout[^;]*$/.test(s))).toBe(false);
  });

  it('enables row level security on gps_devices, matching the SQL migration', () => {
    expect(GPS_DEVICE_DDL.some((s) => /gps_devices ENABLE ROW LEVEL SECURITY/.test(s))).toBe(true);
  });

  it('enables row level security on geofences too', () => {
    expect(GPS_DEVICE_DDL.some((s) => /geofences ENABLE ROW LEVEL SECURITY/.test(s))).toBe(true);
  });

  it('creates every column the Geofence entity maps (drift guard)', () => {
    const createFences = GPS_DEVICE_DDL.find((s) => s.includes('CREATE TABLE IF NOT EXISTS geofences')) as string;
    const columns = getMetadataArgsStorage().columns
      .filter((c) => c.target === Geofence)
      .map((c) => c.options.name || c.propertyName);
    expect(columns.length).toBeGreaterThan(8);
    for (const name of columns) expect(createFences).toContain(name);
  });

  it('keeps going after one statement fails, as long as the schema ends up valid', async () => {
    const { guard, query } = guardWith({ ddlFails: 1 });
    await expect(guard.ensureSchema()).resolves.toBeUndefined();
    // 第一条失败不应该跳过后面的建表
    expect(query.mock.calls.map((c) => c[0])).toContain(
      GPS_DEVICE_DDL.find((s) => s.includes('CREATE TABLE IF NOT EXISTS gps_devices')),
    );
  });

  it('REFUSES TO START when gps_logs.source is missing (otherwise every GPS upload breaks silently)', async () => {
    const { guard } = guardWith({ ddlFails: true, columnOk: false });
    await expect(guard.ensureSchema()).rejects.toThrow(/gps_logs\.source is missing[\s\S]*2026-09-14_gps_devices\.sql/);
  });

  it('refuses to start when the gps_devices table is missing', async () => {
    const { guard } = guardWith({ tableOk: false });
    await expect(guard.ensureSchema()).rejects.toThrow(/gps_devices table is missing/);
  });

  it('refuses to start when the geofences table is missing (every fix would fail the fence check)', async () => {
    const { guard } = guardWith({ geofencesOk: false });
    await expect(guard.ensureSchema())
      .rejects.toThrow(/geofences table is missing[\s\S]*2026-09-23_device_alarms_geofences\.sql/);
  });

  it('onModuleInit propagates the failure so the deploy fails instead of booting broken', async () => {
    const { guard } = guardWith({ columnOk: false });
    await expect(guard.onModuleInit()).rejects.toThrow();
  });
});

describe('GPS_DEVICE_DDL matches the code and the SQL migration', () => {
  const createTable = GPS_DEVICE_DDL.find((s) => s.includes('CREATE TABLE IF NOT EXISTS gps_devices')) as string;
  // 列是分两次加的：建表那份 + 2026-10-19 补 iccid 那份，两份加起来要覆盖实体的每一列
  const migration = ['2026-09-14_gps_devices.sql', '2026-10-19_gps_devices_iccid.sql']
    .map((f) => fs.readFileSync(path.join(__dirname, '../../../database/migrations', f), 'utf8'))
    .join('\n');

  it('creates every column the GpsDevice entity maps (drift guard)', () => {
    // 实体加了列却忘了改建表语句 => 生产上每个设备查询都 500，设备页直接空白
    const columns = getMetadataArgsStorage().columns
      .filter((c) => c.target === GpsDevice)
      .map((c) => c.options.name || c.propertyName);
    expect(columns.length).toBeGreaterThan(10);
    for (const name of columns) {
      expect(createTable).toContain(name);
    }
  });

  it('keeps every statement idempotent (it runs on every boot)', () => {
    for (const statement of GPS_DEVICE_DDL) {
      if (/^\s*(CREATE TABLE|CREATE INDEX|ALTER TABLE \w+ ADD COLUMN)/i.test(statement)) {
        expect(statement).toMatch(/IF NOT EXISTS/i);
      }
    }
  });

  it('the fresh-install database.sql also lists every entity column', () => {
    // 老库走迁移脚本，新库走 database.sql：两条路都得有这些列
    const fresh = fs.readFileSync(path.join(__dirname, '../../../database/database.sql'), 'utf8');
    const columns = getMetadataArgsStorage().columns
      .filter((c) => c.target === GpsDevice)
      .map((c) => c.options.name || c.propertyName);
    for (const name of columns) expect(fresh).toContain(name);
  });

  it('stays in sync with database/migrations (same table, columns and index)', () => {
    const columns = getMetadataArgsStorage().columns
      .filter((c) => c.target === GpsDevice)
      .map((c) => c.options.name || c.propertyName);
    for (const name of columns) expect(migration).toContain(name);
    expect(migration).toContain('idx_gps_devices_plate');
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS source");
    // 两条路径必须用同一个 uuid 默认值，否则老实例上会有一条建不出来
    const uuidFn = /gen_random_uuid\(\)/;
    expect(createTable).toMatch(uuidFn);
    expect(migration).toMatch(uuidFn);
  });
});
