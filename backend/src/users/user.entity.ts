import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn,
} from 'typeorm';

export enum UserRole {
  ADMIN = 'admin',
  DISPATCHER = 'dispatcher',
  DRIVER = 'driver',
  CLIENT = 'client',
  MONITOR = 'monitor', // 大屏监控账号：只看地图/轨迹/异常，不被闲置登出，仅网页端
}

export enum UserStatus {
  PENDING = 'pending',
  ACTIVE = 'active',
  REJECTED = 'rejected',
  DISABLED = 'disabled',
}

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true, length: 64 })
  username: string;

  @Column({ unique: true, length: 128 })
  email: string;

  @Column({ length: 256, select: false })
  password: string;

  @Column({ type: 'enum', enum: UserRole, default: UserRole.DRIVER })
  role: UserRole;

  @Column({ type: 'enum', enum: UserStatus, default: UserStatus.PENDING })
  status: UserStatus;

  @Column({ name: 'full_name', length: 128, nullable: true })
  fullName: string;

  @Column({ length: 32, nullable: true })
  phone: string;

  @Column({ name: 'avatar_url', length: 512, nullable: true })
  avatarUrl: string;

  @Column({ length: 8, default: 'zh' })
  language: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @Column({ name: 'approved_at', nullable: true })
  approvedAt: Date;

  @Column({ name: 'approved_by', nullable: true })
  approvedBy: string;
}
