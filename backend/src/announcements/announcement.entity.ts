import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn,
  ManyToOne, JoinColumn,
} from 'typeorm';
import { User } from '../users/user.entity';

// 公告目标人群
export enum AnnouncementTarget {
  ALL = 'all',
  CLIENT = 'client',
  DRIVER = 'driver',
}

@Entity('announcements')
export class Announcement {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 200 })
  title: string;

  @Column({ type: 'text' })
  content: string;

  @Column({ name: 'target_role', type: 'enum', enum: AnnouncementTarget, default: AnnouncementTarget.ALL })
  targetRole: AnnouncementTarget;

  @Column({ default: true })
  active: boolean;

  @Column({ name: 'created_by', nullable: true })
  createdBy: string;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'created_by' })
  creator: User;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
