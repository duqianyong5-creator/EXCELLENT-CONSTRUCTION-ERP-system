import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User, UserRole, UserStatus } from './user.entity';
import { Task } from '../tasks/task.entity';
import { GpsLog } from '../gps/gps-log.entity';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private repo: Repository<User>,
    @InjectRepository(Task) private taskRepo: Repository<Task>,
    @InjectRepository(GpsLog) private gpsRepo: Repository<GpsLog>,
  ) {}

  async findAll(filters?: { role?: UserRole; status?: UserStatus }) {
    const qb = this.repo.createQueryBuilder('u');
    if (filters?.role) qb.andWhere('u.role = :role', { role: filters.role });
    if (filters?.status) qb.andWhere('u.status = :status', { status: filters.status });
    return qb.orderBy('u.createdAt', 'DESC').getMany();
  }

  async findById(id: string): Promise<User> {
    const user = await this.repo.findOne({ where: { id } });
    if (!user) throw new NotFoundException('用户不存在');
    return user;
  }

  async findByEmailOrUsername(identifier: string): Promise<User | null> {
    return this.repo.findOne({
      where: [{ email: identifier }, { username: identifier }],
    });
  }

  async findWithPassword(id: string): Promise<User> {
    return this.repo
      .createQueryBuilder('u')
      .addSelect('u.password')
      .where('u.id = :id', { id })
      .getOne();
  }

  async create(data: Partial<User>): Promise<User> {
    const user = this.repo.create(data);
    try {
      return await this.repo.save(user);
    } catch (e: any) {
      if (e?.code === '23505') {
        throw new BadRequestException('用户名或邮箱已被占用');
      }
      throw e;
    }
  }

  async approve(id: string, operatorId: string): Promise<User> {
    const user = await this.findById(id);
    user.status = UserStatus.ACTIVE;
    user.approvedAt = new Date();
    user.approvedBy = operatorId;
    return this.repo.save(user);
  }

  async reject(id: string): Promise<User> {
    const user = await this.findById(id);
    user.status = UserStatus.REJECTED;
    return this.repo.save(user);
  }

  async disable(id: string): Promise<User> {
    const user = await this.findById(id);
    user.status = UserStatus.DISABLED;
    return this.repo.save(user);
  }

  async enable(id: string): Promise<User> {
    const user = await this.findById(id);
    user.status = UserStatus.ACTIVE;
    return this.repo.save(user);
  }

  async updateRole(id: string, role: UserRole): Promise<User> {
    const user = await this.findById(id);
    user.role = role;
    return this.repo.save(user);
  }

  async updateUser(id: string, data: Partial<User>): Promise<User> {
    const user = await this.findById(id);

    // 唯一性预检：邮箱/用户名不能与「其他」账户重复，给出明确提示而不是 500
    if (data.email && data.email !== user.email) {
      const existing = await this.repo.findOne({ where: { email: data.email } });
      if (existing && existing.id !== id) {
        throw new BadRequestException('该邮箱已被其他账户使用');
      }
    }
    if (data.username && data.username !== user.username) {
      const existing = await this.repo.findOne({ where: { username: data.username } });
      if (existing && existing.id !== id) {
        throw new BadRequestException('该用户名已被占用');
      }
    }

    Object.assign(user, data);
    try {
      return await this.repo.save(user);
    } catch (e: any) {
      // 兜底：数据库唯一约束冲突(Postgres 23505)→ 明确报错
      if (e?.code === '23505') {
        throw new BadRequestException('用户名或邮箱已被占用');
      }
      throw e;
    }
  }

  async updateProfile(id: string, data: Partial<User>): Promise<User> {
    const user = await this.findById(id);
    Object.assign(user, data);
    return this.repo.save(user);
  }

  async changePassword(id: string, oldPassword: string, newPassword: string): Promise<void> {
    const user = await this.findWithPassword(id);
    const match = await bcrypt.compare(oldPassword, user.password);
    if (!match) throw new BadRequestException('原密码错误');
    user.password = await bcrypt.hash(newPassword, 12);
    await this.repo.save(user);
  }

  async delete(id: string): Promise<{ message: string }> {
    const user = await this.findById(id);
    // 客户：有任务记录则拒绝删除
    if (user.role === UserRole.CLIENT) {
      const count = await this.taskRepo.count({ where: { clientId: id } });
      if (count > 0) {
        throw new BadRequestException(`该客户名下还有 ${count} 个任务记录，无法删除`);
      }
    }
    // 清除 GPS 日志中的司机引用
    await this.gpsRepo.createQueryBuilder()
      .update().set({ driverId: null as any }).where('driverId = :id', { id }).execute();
    // 清除任务中的司机/调度员引用
    await this.taskRepo.createQueryBuilder()
      .update().set({ driverId: null as any }).where('driverId = :id', { id }).execute();
    await this.taskRepo.createQueryBuilder()
      .update().set({ dispatcherId: null as any }).where('dispatcherId = :id', { id }).execute();
    await this.repo.remove(user);
    return { message: '用户已删除' };
  }

  async resetPassword(id: string, newPassword: string): Promise<{ message: string }> {
    const user = await this.findById(id);
    user.password = await bcrypt.hash(newPassword, 12);
    await this.repo.save(user);
    return { message: '密码已重置' };
  }

  async findDrivers(): Promise<User[]> {
    return this.repo.find({
      where: { role: UserRole.DRIVER, status: UserStatus.ACTIVE },
    });
  }

  async findClients(): Promise<User[]> {
    return this.repo.find({
      where: { role: UserRole.CLIENT, status: UserStatus.ACTIVE },
    });
  }
}
