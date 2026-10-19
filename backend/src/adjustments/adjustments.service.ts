import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AdjustmentLog } from './adjustment-log.entity';
import { WorkRecordsService } from '../work-records/work-records.service';
import { OperationLogsService } from '../operation-logs/operation-logs.service';

@Injectable()
export class AdjustmentsService {
  constructor(
    @InjectRepository(AdjustmentLog) private repo: Repository<AdjustmentLog>,
    private workService: WorkRecordsService,
    private operationLogs: OperationLogsService,
  ) {}

  async addAdjustment(data: {
    workRecordId: string;
    driverId: string;
    taskId: string;
    addedMinutes: number;
    reason?: string;
    operatorId: string;
    operatorName?: string;
  }): Promise<AdjustmentLog> {
    await this.workService.applyAdjustment(data.workRecordId, data.addedMinutes);

    const log = this.repo.create({
      workRecordId: data.workRecordId,
      driverId: data.driverId,
      taskId: data.taskId,
      addedMinutes: data.addedMinutes,
      reason: data.reason,
      operatorId: data.operatorId,
    });
    const saved = await this.repo.save(log);
    await this.operationLogs.record({
      actorId: data.operatorId,
      actorName: data.operatorName || data.operatorId,
      action: 'work-records.adjust',
      targetType: 'work_record',
      targetId: data.workRecordId,
      description: `Adjusted work record by ${data.addedMinutes} minutes`,
      details: {
        taskId: data.taskId,
        driverId: data.driverId,
        addedMinutes: data.addedMinutes,
        reason: data.reason || null,
      },
    });
    return saved;
  }

  async setFinalDuration(workRecordId: string, finalMinutes: number, operatorId: string, operatorName?: string) {
    const record = await this.workService.findById(workRecordId);
    const diff = finalMinutes - record.systemDuration;
    await this.workService.setFinalDuration(workRecordId, finalMinutes);

    const log = this.repo.create({
      workRecordId,
      driverId: record.driverId,
      taskId: record.taskId,
      addedMinutes: diff,
      reason: '手动覆盖最终工时',
      operatorId,
    });
    const saved = await this.repo.save(log);
    await this.operationLogs.record({
      actorId: operatorId,
      actorName: operatorName || operatorId,
      action: 'work-records.set-final',
      targetType: 'work_record',
      targetId: workRecordId,
      description: `Set final work duration to ${finalMinutes} minutes`,
      details: {
        taskId: record.taskId,
        driverId: record.driverId,
        finalMinutes,
        diff,
      },
    });
    return saved;
  }

  async getLogs(taskId?: string, driverId?: string): Promise<AdjustmentLog[]> {
    const qb = this.repo
      .createQueryBuilder('al')
      .leftJoinAndSelect('al.operator', 'operator')
      .leftJoinAndSelect('al.driver', 'driver')
      .leftJoinAndSelect('al.task', 'task')
      .orderBy('al.createdAt', 'DESC');

    if (taskId) qb.andWhere('al.taskId = :taskId', { taskId });
    if (driverId) qb.andWhere('al.driverId = :driverId', { driverId });

    return qb.getMany();
  }
}
