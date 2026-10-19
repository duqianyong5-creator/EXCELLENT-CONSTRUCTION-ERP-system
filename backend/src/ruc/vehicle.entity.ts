import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index,
} from 'typeorm';

/**
 * 车辆档案。以车牌为主键身份，和定位器、司机接单时填写的车牌是同一个口径。
 * 这里承载 RUC（新西兰路税）许可与里程估算。
 */
@Entity('vehicles')
export class Vehicle {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** 归一化车牌（大写、去空格连字符），用于匹配 */
  @Index({ unique: true })
  @Column({ length: 32 })
  plate: string;

  /** 录入时的原始车牌，界面显示用 */
  @Column({ name: 'display_plate', length: 32 })
  displayPlate: string;

  @Column({ length: 128, nullable: true })
  label: string;

  // ---------- RUC 许可 ----------

  @Column({ name: 'ruc_licence_no', length: 64, nullable: true })
  rucLicenceNo: string;

  /** 许可起始里程读数（公里） */
  @Column({ name: 'ruc_start_km', type: 'decimal', precision: 12, scale: 2, nullable: true })
  rucStartKm: number;

  /** 许可覆盖到的里程读数（公里）——跑过这个数之前必须续买 */
  @Column({ name: 'ruc_end_km', type: 'decimal', precision: 12, scale: 2, nullable: true })
  rucEndKm: number;

  @Column({ name: 'ruc_purchased_at', type: 'timestamptz', nullable: true })
  rucPurchasedAt: Date;

  /** 已经就当前许可提醒到第几级，避免每天重复推送同一条 */
  @Column({ name: 'ruc_alert_level', type: 'int', default: 0 })
  rucAlertLevel: number;

  // ---------- 里程估算 ----------

  /** 当前估算的里程读数（公里）。法定依据是车上 hubodometer，这里只是估算。 */
  @Column({ name: 'odometer_km', type: 'decimal', precision: 12, scale: 2, nullable: true })
  odometerKm: number;

  /** 上次人工校准填入的真实读数 */
  @Column({ name: 'odometer_calibrated_km', type: 'decimal', precision: 12, scale: 2, nullable: true })
  odometerCalibratedKm: number;

  @Column({ name: 'odometer_calibrated_at', type: 'timestamptz', nullable: true })
  odometerCalibratedAt: Date;

  /** 定位器自身里程计的上次读数，用来算增量 */
  @Column({ name: 'last_device_odo_km', type: 'decimal', precision: 12, scale: 2, nullable: true })
  lastDeviceOdoKm: number;

  @Column({ name: 'odometer_updated_at', type: 'timestamptz', nullable: true })
  odometerUpdatedAt: Date;

  // ---------- 日均里程（用于预估还能跑几天） ----------

  @Column({ name: 'odo_snapshot_km', type: 'decimal', precision: 12, scale: 2, nullable: true })
  odoSnapshotKm: number;

  @Column({ name: 'odo_snapshot_at', type: 'timestamptz', nullable: true })
  odoSnapshotAt: Date;

  @Column({ default: true })
  enabled: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
