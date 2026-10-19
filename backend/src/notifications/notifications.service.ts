import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Notification } from './notification.entity';
import { NotificationsGateway } from './notifications.gateway';
import { UsersService } from '../users/users.service';
import { UserRole } from '../users/user.entity';

@Injectable()
export class NotificationsService {
  constructor(
    @InjectRepository(Notification) private repo: Repository<Notification>,
    @Inject(forwardRef(() => UsersService)) private usersService: UsersService,
    private gateway: NotificationsGateway,
  ) {}

  async create(
    userId: string | null,
    data: {
      title: string;
      content: string;
      type?: string;
      meta?: Record<string, any>;
      notifyAdmins?: boolean;
    },
  ): Promise<Notification[]> {
    const saved: Notification[] = [];

    if (userId) {
      const notif = this.repo.create({ userId, ...data });
      const savedNotif = await this.repo.save(notif);
      saved.push(savedNotif);
      // Real-time push so the web/app update instantly (no polling delay).
      this.gateway.sendToUser(userId, 'notification:new', savedNotif);
    }

    if (data.notifyAdmins) {
      // 调度员也要收：GPS 静止报警、RUC 到期这些都是他们当班时要处理的事。
      // 以前只发给 role=admin，结果调度员的通知页永远是空的、铃铛永远是 0。
      const recipients = await Promise.all(
        [UserRole.ADMIN, UserRole.DISPATCHER].map((role) => this.usersService.findAll({ role })),
      );
      const admins = recipients.flat();
      for (const admin of admins) {
        const notif = this.repo.create({
          userId: admin.id,
          title: data.title,
          content: data.content,
          type: data.type,
          meta: data.meta,
        });
        const savedNotif = await this.repo.save(notif);
        saved.push(savedNotif);
        this.gateway.sendToUser(admin.id, 'notification:new', savedNotif);
      }
    }

    return saved;
  }

  broadcastGpsUpdate(driverId: string, gpsData: any) {
    this.gateway.broadcastGpsUpdate(driverId, gpsData);
  }

  async findForUser(userId: string): Promise<Notification[]> {
    return this.repo.find({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: 50,
    });
  }

  async markRead(id: string, userId: string): Promise<void> {
    await this.repo.update({ id, userId }, { isRead: true });
  }

  async markAllRead(userId: string): Promise<void> {
    await this.repo.update({ userId }, { isRead: true });
  }

  async countUnread(userId: string): Promise<number> {
    return this.repo.count({ where: { userId, isRead: false } });
  }
}
