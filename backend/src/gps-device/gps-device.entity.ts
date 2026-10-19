import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index,
} from 'typeorm';

/**
 * 车载 GPS 定位器（JT808 终端）登记表。
 * 设备通过「设备号」识别（协议头里的终端手机号 BCD，设备上印的 11 位号），
 * 通过「车牌」与司机接单时填写的车牌匹配到进行中任务，位置点即归属该司机/任务。
 */
@Entity('gps_devices')
export class GpsDevice {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** 归一化后的设备号（仅数字、无前导 0） */
  @Index({ unique: true })
  @Column({ name: 'device_no', length: 32 })
  deviceNo: string;

  @Column({ name: 'vehicle_plate', length: 32, nullable: true })
  vehiclePlate: string;

  @Column({ length: 128, nullable: true })
  name: string;

  @Column({ default: true })
  enabled: boolean;

  /**
   * SIM 卡 ICCID（20 位，中国移动的卡会带字母）。设备上报（0x1107 / 0x0107 / 定位附加 0xEB）时自动填，
   * 也允许管理员手填——换了本地卡之后才知道哪张卡装在哪台设备、哪辆车上。
   */
  @Column({ length: 32, nullable: true })
  iccid: string;

  // 统一用 timestamptz，与 database/migrations 里的建表语句一致；
  // 否则开发环境的 synchronize 会把列改成不带时区的 timestamp，两边时间差一个时区。
  @Column({ name: 'last_seen_at', type: 'timestamptz', nullable: true })
  lastSeenAt: Date;

  @Column({ name: 'last_latitude', type: 'decimal', precision: 10, scale: 7, nullable: true })
  lastLatitude: number;

  @Column({ name: 'last_longitude', type: 'decimal', precision: 10, scale: 7, nullable: true })
  lastLongitude: number;

  @Column({ name: 'last_speed', type: 'decimal', precision: 6, scale: 2, nullable: true })
  lastSpeed: number;

  @Column({ name: 'last_fix_at', type: 'timestamptz', nullable: true })
  lastFixAt: Date;

  @Column({ name: 'battery_percent', type: 'int', nullable: true })
  batteryPercent: number;

  @Column({ name: 'external_power', type: 'boolean', nullable: true })
  externalPower: boolean;

  @Column({ name: 'signal_percent', type: 'int', nullable: true })
  signalPercent: number;

  @Column({ name: 'last_task_id', nullable: true })
  lastTaskId: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
