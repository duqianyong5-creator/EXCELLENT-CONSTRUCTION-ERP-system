import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn,
} from 'typeorm';
import { User } from '../users/user.entity';

export enum TaskStatus {
  PENDING = 'pending',
  ASSIGNED = 'assigned',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
}

@Entity('tasks')
export class Task {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'client_id' })
  clientId: string;

  @ManyToOne(() => User, { eager: false })
  @JoinColumn({ name: 'client_id' })
  client: User;

  @Column({ name: 'driver_id', nullable: true })
  driverId: string;

  @ManyToOne(() => User, { eager: false, nullable: true })
  @JoinColumn({ name: 'driver_id' })
  driver: User;

  @Column({ name: 'dispatcher_id', nullable: true })
  dispatcherId: string;

  @Column({ length: 256 })
  title: string;

  @Column({ name: 'start_location', length: 512, nullable: true })
  startLocation: string;

  @Column({ name: 'end_location', length: 512 })
  endLocation: string;

  @Column({ name: 'start_lat', type: 'decimal', precision: 10, scale: 7, nullable: true })
  startLat: number;

  @Column({ name: 'start_lng', type: 'decimal', precision: 10, scale: 7, nullable: true })
  startLng: number;

  @Column({ name: 'end_lat', type: 'decimal', precision: 10, scale: 7, nullable: true })
  endLat: number;

  @Column({ name: 'end_lng', type: 'decimal', precision: 10, scale: 7, nullable: true })
  endLng: number;

  @Column({ nullable: true, type: 'text' })
  cargo: string;

  @Column({ name: 'cargo_weight', type: 'decimal', precision: 10, scale: 2, nullable: true })
  cargoWeight: number;

  @Column({ name: 'scheduled_at', nullable: true })
  scheduledAt: Date;

  @Column({ type: 'enum', enum: TaskStatus, default: TaskStatus.PENDING })
  status: TaskStatus;

  @Column({ nullable: true, type: 'text' })
  notes: string;

  @Column({ name: 'vehicle_plate', length: 32, nullable: true })
  vehiclePlate: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
