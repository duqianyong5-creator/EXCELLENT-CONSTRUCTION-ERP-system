import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, ManyToOne, JoinColumn,
} from 'typeorm';
import { User } from '../users/user.entity';
import { Task } from '../tasks/task.entity';

@Entity('gps_logs')
export class GpsLog {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ name: 'driver_id' })
  driverId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'driver_id' })
  driver: User;

  @Column({ name: 'task_id', nullable: true })
  taskId: string;

  @Column({ type: 'decimal', precision: 10, scale: 7 })
  latitude: number;

  @Column({ type: 'decimal', precision: 10, scale: 7 })
  longitude: number;

  @Column({ type: 'decimal', precision: 6, scale: 2, default: 0 })
  speed: number;

  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
  heading: number;

  @Column({ type: 'decimal', precision: 6, scale: 2, nullable: true })
  accuracy: number;

  @Column({ name: 'is_anomaly', default: false })
  isAnomaly: boolean;

  /** 'app' 手机 App 上报 | 'device' 车载 JT808 定位器上报 */
  @Column({ length: 16, default: 'app' })
  source: string;

  // 显式 timestamptz：数据库建的就是 TIMESTAMPTZ，不写类型的话开发环境的 synchronize
  // 会把它改成不带时区的 timestamp，两边差一个时区（设备点的时间尤其敏感）。
  @CreateDateColumn({ name: 'timestamp', type: 'timestamptz' })
  timestamp: Date;
}
