import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

/**
 * 启动时建好车辆表（生产库 synchronize 关闭）。
 * 与 gps-device.schema.ts 同一套做法：幂等 DDL + 建完校验，校验不过就不启动。
 */
export const VEHICLE_DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS vehicles (
      id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      plate                   VARCHAR(32) NOT NULL UNIQUE,
      display_plate           VARCHAR(32) NOT NULL,
      label                   VARCHAR(128),
      ruc_licence_no          VARCHAR(64),
      ruc_start_km            DECIMAL(12, 2),
      ruc_end_km              DECIMAL(12, 2),
      ruc_purchased_at        TIMESTAMPTZ,
      ruc_alert_level         INT NOT NULL DEFAULT 0,
      odometer_km             DECIMAL(12, 2),
      odometer_calibrated_km  DECIMAL(12, 2),
      odometer_calibrated_at  TIMESTAMPTZ,
      last_device_odo_km      DECIMAL(12, 2),
      odometer_updated_at     TIMESTAMPTZ,
      odo_snapshot_km         DECIMAL(12, 2),
      odo_snapshot_at         TIMESTAMPTZ,
      enabled                 BOOLEAN NOT NULL DEFAULT TRUE,
      created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,
  `ALTER TABLE vehicles ENABLE ROW LEVEL SECURITY`,
];

@Injectable()
export class RucSchemaGuard implements OnModuleInit {
  private readonly logger = new Logger('RucSchema');

  constructor(@InjectDataSource() private dataSource: DataSource) {}

  async onModuleInit(): Promise<void> {
    await this.ensureSchema();
  }

  async ensureSchema(): Promise<void> {
    const failures: string[] = [];
    for (const statement of VEHICLE_DDL) {
      try {
        await this.dataSource.query(statement);
      } catch (e: any) {
        failures.push(e?.message || String(e));
      }
    }

    const [{ ok }] = await this.dataSource.query(
      `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'vehicles') AS ok`,
    );
    if (!ok) {
      throw new Error(
        'vehicles table is missing and could not be created — run database/migrations/2026-09-21_vehicles_ruc.sql. '
        + `Details: ${failures.join(' | ') || 'no error reported'}`,
      );
    }
    if (failures.length) {
      this.logger.warn(`schema statements reported errors but the schema is valid: ${failures.join(' | ')}`);
    }
    this.logger.log('vehicles schema verified');
  }
}
