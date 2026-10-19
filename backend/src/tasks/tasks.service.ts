import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Task, TaskStatus } from './task.entity';
import { WorkRecord } from '../work-records/work-record.entity';
import { GpsLog } from '../gps/gps-log.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { OperationLogsService } from '../operation-logs/operation-logs.service';
import { UserRole } from '../users/user.entity';
import { ErrorCode } from '../common/i18n/messages';

/** 完工备注上限：司机手打的几句话，不是文档 */
const MAX_NOTES_LEN = 2000;

@Injectable()
export class TasksService {
  constructor(
    @InjectRepository(Task) private taskRepo: Repository<Task>,
    @InjectRepository(WorkRecord) private workRepo: Repository<WorkRecord>,
    @InjectRepository(GpsLog) private gpsRepo: Repository<GpsLog>,
    private notifService: NotificationsService,
    private operationLogs: OperationLogsService,
  ) {}

  private actorId(actor: any): string {
    return typeof actor === 'string' ? actor : actor?.id;
  }

  private actorName(actor: any): string {
    return typeof actor === 'string' ? actor : (actor?.fullName || actor?.username || actor?.email || actor?.id);
  }

  async findAll(user: any) {
    const qb = this.taskRepo
      .createQueryBuilder('t')
      .leftJoinAndSelect('t.client', 'client')
      .leftJoinAndSelect('t.driver', 'driver')
      .orderBy('t.createdAt', 'DESC');

    if (user.role === UserRole.DRIVER) {
      qb.where('t.driverId = :id', { id: user.id });
    } else if (user.role === UserRole.CLIENT) {
      qb.where('t.clientId = :id', { id: user.id });
    }

    return qb.getMany();
  }

  async findTodayTasks(driverId: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    return this.taskRepo
      .createQueryBuilder('t')
      .leftJoinAndSelect('t.client', 'client')
      .where('t.driverId = :id', { id: driverId })
      .andWhere('t.scheduledAt >= :today', { today })
      .andWhere('t.scheduledAt < :tomorrow', { tomorrow })
      .andWhere('t.status != :cancelled', { cancelled: TaskStatus.CANCELLED })
      .orderBy('t.scheduledAt', 'ASC')
      .getMany();
  }

  /**
   * actor 传入时会做归属校验。findAll 一直是按角色收窄的，但单条查询没有——
   * 任何登录账号只要有任务 UUID 就能读到别家客户的姓名、邮箱、送货地址、货物和司机。
   * 内部调用（开始/完成/取消任务等）不传 actor，行为不变。
   */
  async findById(id: string, actor?: any): Promise<Task> {
    const task = await this.taskRepo.findOne({
      where: { id },
      relations: ['client', 'driver'],
    });
    if (!task) throw new NotFoundException('任务不存在');

    if (actor?.role === UserRole.DRIVER && task.driverId !== actor.id) {
      throw new ForbiddenException(ErrorCode.FORBIDDEN_TASK);
    }
    if (actor?.role === UserRole.CLIENT && task.clientId !== actor.id) {
      throw new ForbiddenException(ErrorCode.FORBIDDEN_TASK);
    }
    return task;
  }

  async create(data: Partial<Task>, actor: any): Promise<Task> {
    const task = this.taskRepo.create({ ...data, dispatcherId: this.actorId(actor) });
    const saved = await this.taskRepo.save(task);

    if (saved.driverId) {
      await this.notifService.create(saved.driverId, {
        title: '新任务分配',
        content: `您有新任务：${saved.title}`,
        type: 'new_task',
        meta: { taskId: saved.id },
      });
      saved.status = TaskStatus.ASSIGNED;
      await this.taskRepo.save(saved);
    }

    if (saved.clientId) {
      await this.notifService.create(saved.clientId, {
        title: '任务已创建',
        content: `您的任务 "${saved.title}" 已创建`,
        type: 'task_created',
        meta: { taskId: saved.id },
      });
    }

    await this.operationLogs.record({
      actorId: this.actorId(actor),
      actorName: this.actorName(actor),
      action: 'tasks.create',
      targetType: 'task',
      targetId: saved.id,
      description: `Created task ${saved.title}`,
      details: {
        clientId: saved.clientId,
        driverId: saved.driverId ?? null,
        status: saved.status,
      },
    });

    return saved;
  }

  async update(id: string, data: Partial<Task>, actor?: any): Promise<Task> {
    const task = await this.findById(id);
    Object.assign(task, data);
    const saved = await this.taskRepo.save(task);
    if (actor) {
      await this.operationLogs.record({
        actorId: this.actorId(actor),
        actorName: this.actorName(actor),
        action: 'tasks.update',
        targetType: 'task',
        targetId: saved.id,
        description: `Updated task ${saved.title}`,
        details: { fields: Object.keys(data) },
      });
    }
    return saved;
  }

  async assign(taskId: string, driverId: string, actor?: any): Promise<Task> {
    const task = await this.findById(taskId);
    task.driverId = driverId;
    task.status = TaskStatus.ASSIGNED;
    const saved = await this.taskRepo.save(task);

    await this.notifService.create(driverId, {
      title: '任务分配',
      content: `任务 "${saved.title}" 已分配给您`,
      type: 'task_assigned',
      meta: { taskId: saved.id },
    });

    if (actor) {
      await this.operationLogs.record({
        actorId: this.actorId(actor),
        actorName: this.actorName(actor),
        action: 'tasks.assign',
        targetType: 'task',
        targetId: saved.id,
        description: `Assigned task ${saved.title}`,
        details: { driverId },
      });
    }

    return saved;
  }

  async startTask(taskId: string, driverId: string, vehiclePlate?: string): Promise<WorkRecord> {
    const task = await this.findById(taskId);
    if (task.driverId !== driverId) throw new ForbiddenException('无权操作此任务');
    if (task.status !== TaskStatus.ASSIGNED) throw new ForbiddenException('任务状态不正确');

    task.status = TaskStatus.IN_PROGRESS;
    if (vehiclePlate && vehiclePlate.trim()) task.vehiclePlate = vehiclePlate.trim();
    await this.taskRepo.save(task);

    const record = this.workRepo.create({
      driverId,
      taskId,
      startTime: new Date(),
    });
    return this.workRepo.save(record);
  }

  async completeTask(
    taskId: string,
    driverId: string,
    data: { notes?: string; imageUrls?: string[] },
  ): Promise<WorkRecord> {
    const task = await this.findById(taskId);
    if (task.driverId !== driverId) throw new ForbiddenException('无权操作此任务');
    if (task.status !== TaskStatus.IN_PROGRESS) throw new ForbiddenException('任务未在进行中');
    // 先验备注再改状态：验不过时任务不能已经被标成完成
    const notes = String(data.notes ?? '').trim();
    if (notes.length > MAX_NOTES_LEN) throw new BadRequestException(ErrorCode.NOTES_TOO_LONG);

    const endTime = new Date();
    task.status = TaskStatus.COMPLETED;
    await this.taskRepo.save(task);

    const record = await this.workRepo.findOne({ where: { taskId, driverId } });
    if (!record) throw new NotFoundException('未找到工作记录，请先开始任务');

    record.endTime = endTime;
    const diffMs = endTime.getTime() - record.startTime.getTime();
    record.systemDuration = Math.round(diffMs / 60000);
    record.finalDuration = record.systemDuration;
    record.completionNotes = notes || null;
    record.imageUrls = data.imageUrls;
    const saved = await this.workRepo.save(record);

    await this.notifService.create(task.clientId, {
      title: '任务完成',
      content: `任务 "${task.title}" 已完成`,
      type: 'task_completed',
      meta: { taskId },
    });

    return saved;
  }

  async cancel(id: string, actor?: any): Promise<Task> {
    const task = await this.findById(id);
    if (task.status === TaskStatus.COMPLETED || task.status === TaskStatus.CANCELLED) {
      throw new BadRequestException('已完成或已取消的任务无法取消');
    }
    task.status = TaskStatus.CANCELLED;
    const saved = await this.taskRepo.save(task);
    if (actor) {
      await this.operationLogs.record({
        actorId: this.actorId(actor),
        actorName: this.actorName(actor),
        action: 'tasks.cancel',
        targetType: 'task',
        targetId: saved.id,
        description: `Cancelled task ${saved.title}`,
        details: { status: saved.status },
      });
    }
    return saved;
  }

  async delete(id: string, actor?: any): Promise<void> {
    const task = await this.findById(id);
    await this.gpsRepo.delete({ taskId: id });
    await this.workRepo.delete({ taskId: id });
    await this.taskRepo.remove(task);
    if (actor) {
      await this.operationLogs.record({
        actorId: this.actorId(actor),
        actorName: this.actorName(actor),
        action: 'tasks.delete',
        targetType: 'task',
        targetId: id,
        description: `Deleted task ${task.title}`,
        details: { status: task.status },
      });
    }
  }

  async getStats() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const [total, pending, inProgress, completed, todayCount] = await Promise.all([
      this.taskRepo.count(),
      this.taskRepo.count({ where: { status: TaskStatus.PENDING } }),
      this.taskRepo.count({ where: { status: TaskStatus.IN_PROGRESS } }),
      this.taskRepo.count({ where: { status: TaskStatus.COMPLETED } }),
      this.taskRepo
        .createQueryBuilder('t')
        .where('t.scheduledAt >= :today', { today })
        .andWhere('t.scheduledAt < :tomorrow', { tomorrow })
        .andWhere('t.status != :cancelled', { cancelled: TaskStatus.CANCELLED })
        .getCount(),
    ]);
    return { total, pending, inProgress, completed, today: todayCount };
  }
}
