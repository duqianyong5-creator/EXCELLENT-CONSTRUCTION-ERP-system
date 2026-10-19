import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index,
} from 'typeorm';

/**
 * 圆形电子围栏（平台侧判定）。
 *
 * 为什么不下发到设备：厂家协议 V1.54 没有 0x8600「设置圆形区域」（全文与附录A消息对照表都没有），
 * 详见 jt808.codec.ts 里 buildPositionQuery 后面的说明。所以围栏一律由服务端拿每个定位点去比，
 * 好处是换设备、混用不同型号都照样有效，改围栏也不用重新烧设备参数。
 */
@Entity('geofences')
export class Geofence {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 128 })
  name: string;

  @Column({ name: 'center_lat', type: 'decimal', precision: 10, scale: 7 })
  centerLat: number;

  @Column({ name: 'center_lng', type: 'decimal', precision: 10, scale: 7 })
  centerLng: number;

  @Column({ name: 'radius_m', type: 'int' })
  radiusM: number;

  /** 只管这块车牌；留空 = 对所有车生效 */
  @Index()
  @Column({ name: 'vehicle_plate', length: 32, nullable: true })
  vehiclePlate: string;

  @Column({ default: true })
  enabled: boolean;

  @Column({ name: 'alert_on_enter', default: true })
  alertOnEnter: boolean;

  @Column({ name: 'alert_on_leave', default: true })
  alertOnLeave: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
