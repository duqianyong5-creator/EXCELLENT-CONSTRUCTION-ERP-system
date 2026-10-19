import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Announcement, AnnouncementTarget } from './announcement.entity';
import { UserRole } from '../users/user.entity';

@Injectable()
export class AnnouncementsService {
  constructor(
    @InjectRepository(Announcement) private repo: Repository<Announcement>,
  ) {}

  // 管理端：全部公告
  findAll(): Promise<Announcement[]> {
    return this.repo.find({ relations: ['creator'], order: { createdAt: 'DESC' } });
  }

  // 客户/司机端：按角色拉取生效公告
  feedForRole(role: UserRole): Promise<Announcement[]> {
    const targets: AnnouncementTarget[] = [AnnouncementTarget.ALL];
    if (role === UserRole.CLIENT) targets.push(AnnouncementTarget.CLIENT);
    if (role === UserRole.DRIVER) targets.push(AnnouncementTarget.DRIVER);
    return this.repo.find({
      where: { active: true, targetRole: In(targets) },
      order: { createdAt: 'DESC' },
      take: 20,
    });
  }

  async create(data: {
    title: string;
    content: string;
    targetRole?: AnnouncementTarget;
    createdBy?: string;
  }): Promise<Announcement> {
    const a = this.repo.create({
      title: data.title,
      content: data.content,
      targetRole: data.targetRole || AnnouncementTarget.ALL,
      createdBy: data.createdBy,
      active: true,
    });
    return this.repo.save(a);
  }

  async setActive(id: string, active: boolean): Promise<Announcement> {
    const a = await this.repo.findOne({ where: { id } });
    if (!a) throw new NotFoundException('公告不存在');
    a.active = active;
    return this.repo.save(a);
  }

  async remove(id: string): Promise<void> {
    const a = await this.repo.findOne({ where: { id } });
    if (!a) throw new NotFoundException('公告不存在');
    await this.repo.remove(a);
  }
}
