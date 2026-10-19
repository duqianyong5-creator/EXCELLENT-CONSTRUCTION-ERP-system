import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, ManyToOne, JoinColumn,
} from 'typeorm';
import { User } from '../users/user.entity';
import { Task } from '../tasks/task.entity';

export enum AnomalyType {
  GPS_DISCONNECT = 'gps_disconnect',
  SPEED_ANOMALY = 'speed_anomaly',
  TELEPORT = 'teleport',
  TIME_INCONSISTENCY = 'time_inconsistency',
  STATIONARY = 'stationary', // GPS 长时间不动
  // 车载 JT808 定位器上报的报警。设备在没有进行中任务时也会报（半夜撬车就是这种），
  // 所以这几类记录的 driver_id / task_id 允许为空，靠 device_no + vehicle_plate 定位到车。
  SHOCK = 'shock', // 震动（0xE7 报警状态 bit0）
  POWER_CUT = 'power_cut', // 主电源掉电 / 防拆（报警标志 bit8，或 0xE4 报外电断开）
  GEOFENCE_ENTER = 'geofence_enter', // 驶入围栏（平台侧判定）
  GEOFENCE_LEAVE = 'geofence_leave', // 驶离围栏（平台侧判定）
  // 接着车电的定位器突然消失（平台侧判定）。没有备用电池的设备一拔线就整机断电，
  // 断电报警根本来不及发——平台只能从「它不见了」这件事上发现。
  DEVICE_OFFLINE = 'device_offline',
}

/** 由定位器/围栏产生、可能没有司机的报警类型 */
export const DEVICE_ANOMALY_TYPES: AnomalyType[] = [
  AnomalyType.SHOCK,
  AnomalyType.POWER_CUT,
  AnomalyType.GEOFENCE_ENTER,
  AnomalyType.GEOFENCE_LEAVE,
  AnomalyType.DEVICE_OFFLINE,
];

@Entity('gps_anomalies')
export class GpsAnomaly {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // 车载定位器的报警（震动/断电/围栏）在车辆空闲、没有进行中任务时也会发生 —— 这恰恰是最要紧的场景
  // （半夜停车场撬车）。所以 driver_id 可空：这类记录靠下面的 device_no / vehicle_plate 指向具体车辆。
  @Column({ name: 'driver_id', nullable: true })
  driverId: string;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'driver_id' })
  driver: User;

  @Column({ name: 'task_id', nullable: true })
  taskId: string;

  @ManyToOne(() => Task, { nullable: true })
  @JoinColumn({ name: 'task_id' })
  task: Task;

  @Column({ name: 'anomaly_type', type: 'enum', enum: AnomalyType })
  anomalyType: AnomalyType;

  @Column({ nullable: true, type: 'text' })
  description: string;

  @Column({ type: 'decimal', precision: 10, scale: 7, nullable: true })
  latitude: number;

  @Column({ type: 'decimal', precision: 10, scale: 7, nullable: true })
  longitude: number;

  @Column({ type: 'decimal', precision: 6, scale: 2, nullable: true })
  speed: number;

  @CreateDateColumn({ name: 'detected_at' })
  detectedAt: Date;

  @Column({ default: false })
  resolved: boolean;

  @Column({ name: 'resolved_at', nullable: true })
  resolvedAt: Date;

  @Column({ name: 'resolved_by', nullable: true })
  resolvedBy: string;

  // 报警升级：已报警次数（含首次）与下次报警最早时间
  @Column({ name: 'alarm_count', type: 'int', default: 1 })
  alarmCount: number;

  @Column({ name: 'snooze_until', type: 'timestamp', nullable: true })
  snoozeUntil: Date;

  /** 报警来源定位器的设备号（仅车载报警）。没有司机时，靠它和车牌才能知道是哪台车。 */
  @Column({ name: 'device_no', length: 32, nullable: true })
  deviceNo: string;

  @Column({ name: 'vehicle_plate', length: 32, nullable: true })
  vehiclePlate: string;

  /** 触发的围栏（仅 geofence_enter / geofence_leave） */
  @Column({ name: 'geofence_id', nullable: true })
  geofenceId: string;
}
