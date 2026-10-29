import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Task, TaskStatus } from './task.entity';
import { WorkRecord } from '../work-records/work-record.entity';
import { GpsLog } from '../gps/gps-log.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { OperationLogsService } from '../operation-logs/operation-logs.service';
import { SystemSettingsService } from '../system-settings/system-settings.service';
import { AdjustmentLog } from '../adjustments/adjustment-log.entity';
import { GpsAnomaly } from '../gps/gps-anomaly.entity';
import { UserRole } from '../users/user.entity';
import { ErrorCode } from '../common/i18n/messages';

const WORK_ADJUST_SETTING = 'work_adjust_minutes';
const WORK_ADJUST_SYSTEM_REASON = 'System default adjustment';
/** Upper bound for the automatic adjustment (8 hours), whatever the stored setting says */
const MAX_DEFAULT_ADJUST_MINUTES = 480;
/** What PATCH /tasks/:id may change */
const EDITABLE_TASK_FIELDS = ['endLocation', 'cargo', 'cargoWeight', 'scheduledAt', 'notes'] as const;

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
    private settings: SystemSettingsService,
    @InjectRepository(AdjustmentLog) private adjustRepo: Repository<AdjustmentLog>,
  ) {}

  /**
   * System Settings "default time adjustment": minutes added to every work record when the job is
   * completed. 0, blank or unreadable means none. The console used to keep this choice only in the
   * browser, so nothing ever applied it and final hours always equalled the measured hours.
   */
  private async defaultAdjustmentMinutes(): Promise<number> {
    try {
      const n = Number(await this.settings.get(WORK_ADJUST_SETTING));
      return Number.isFinite(n) && n > 0 ? Math.min(Math.round(n), MAX_DEFAULT_ADJUST_MINUTES) : 0;
    } catch {
      return 0;
    }
  }

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
    // Closed jobs are history: hours and evidence hang off them
    if (task.status === TaskStatus.COMPLETED || task.status === TaskStatus.CANCELLED) {
      throw new BadRequestException('A completed or cancelled task cannot be edited');
    }
    // Only the fields the edit dialog owns. Status, driver and client change through their own endpoints
    // (start/complete/assign/cancel), which notify people and keep the work record consistent.
    const patch: Partial<Task> = {};
    for (const key of EDITABLE_TASK_FIELDS) {
      if (key in (data ?? {})) (patch as any)[key] = (data as any)[key];
    }
    Object.assign(task, patch);
    const saved = await this.taskRepo.save(task);
    if (actor) {
      await this.operationLogs.record({
        actorId: this.actorId(actor),
        actorName: this.actorName(actor),
        action: 'tasks.update',
        targetType: 'task',
        targetId: saved.id,
        description: `Updated task ${saved.title}`,
        details: { fields: Object.keys(patch) },
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

    // Find the work record before touching the task, so a missing record never leaves a "completed" job behind
    const record = await this.workRepo.findOne({ where: { taskId, driverId } });
    if (!record) throw new NotFoundException('未找到工作记录，请先开始任务');

    const endTime = new Date();
    // Claim the completion atomically: of two concurrent requests (double tap, network retry) only one moves
    // the job out of in_progress; the other is refused instead of completing it twice.
    const claimed = await this.taskRepo.update({ id: taskId, status: TaskStatus.IN_PROGRESS }, { status: TaskStatus.COMPLETED });
    if (!claimed?.affected) throw new ForbiddenException('任务未在进行中');
    task.status = TaskStatus.COMPLETED;

    record.endTime = endTime;
    const diffMs = endTime.getTime() - record.startTime.getTime();
    record.systemDuration = Math.round(diffMs / 60000);
    // the configured default adjustment is applied here and recorded like a manual one
    const extraMinutes = await this.defaultAdjustmentMinutes();
    record.adjustmentTime = extraMinutes;
    record.finalDuration = record.systemDuration + extraMinutes;
    record.completionNotes = notes || null;
    record.imageUrls = data.imageUrls;
    const saved = await this.workRepo.save(record);
    if (extraMinutes > 0) {
      // The hours are already on the work record; a failed log write must not fail the driver's completion
      try {
        await this.adjustRepo.save(this.adjustRepo.create({
          workRecordId: saved.id,
          driverId,
          taskId,
          addedMinutes: extraMinutes,
          reason: WORK_ADJUST_SYSTEM_REASON,
          operatorId: driverId,
        }));
      } catch (e: any) {
        console.error(`[tasks] default adjustment log not written for task ${taskId}: ${e?.message || e}`);
      }
    }

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
    // A completed job carries paid hours and their adjustments: only an admin may remove it
    if (task.status === TaskStatus.COMPLETED && actor && actor.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Only an administrator can delete a completed task');
    }
    const record = await this.workRepo.findOne({ where: { taskId: id } }).catch(() => null);
    // Everything that points at the task goes first, in one transaction, or the foreign keys refuse the
    // delete: adjustment logs (every completed job has one now), anomalies (kept as vehicle history, just
    // unlinked from the job), the job's GPS points and its work record.
    await this.taskRepo.manager.transaction(async (m) => {
      await m.delete(AdjustmentLog, { taskId: id });
      await m.update(GpsAnomaly, { taskId: id }, { taskId: null as any });
      await m.delete(GpsLog, { taskId: id });
      await m.delete(WorkRecord, { taskId: id });
      await m.remove(task);
    });
    if (actor) {
      await this.operationLogs.record({
        actorId: this.actorId(actor),
        actorName: this.actorName(actor),
        action: 'tasks.delete',
        targetType: 'task',
        targetId: id,
        description: `Deleted task ${task.title}`,
        // keep the hours in the audit trail: the work record and its adjustments are deleted with the task
        details: { status: task.status, systemDuration: record?.systemDuration ?? null, adjustmentTime: record?.adjustmentTime ?? null, finalDuration: record?.finalDuration ?? null },
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
