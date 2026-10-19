import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn,
} from 'typeorm';
import { User } from '../users/user.entity';
import { Task } from '../tasks/task.entity';

@Entity('work_records')
export class WorkRecord {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'driver_id' })
  driverId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'driver_id' })
  driver: User;

  @Column({ name: 'task_id' })
  taskId: string;

  @ManyToOne(() => Task)
  @JoinColumn({ name: 'task_id' })
  task: Task;

  @Column({ name: 'start_time', nullable: true })
  startTime: Date;

  @Column({ name: 'end_time', nullable: true })
  endTime: Date;

  @Column({ name: 'system_duration', default: 0 })
  systemDuration: number;

  @Column({ name: 'gps_duration', default: 0 })
  gpsDuration: number;

  @Column({ name: 'final_duration', default: 0 })
  finalDuration: number;

  @Column({ name: 'adjustment_time', default: 0 })
  adjustmentTime: number;

  @Column({ name: 'image_urls', type: 'text', array: true, nullable: true })
  imageUrls: string[];

  @Column({ name: 'completion_notes', nullable: true, type: 'text' })
  completionNotes: string;

  @Column({ name: 'anomaly_flag', default: false })
  anomalyFlag: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
