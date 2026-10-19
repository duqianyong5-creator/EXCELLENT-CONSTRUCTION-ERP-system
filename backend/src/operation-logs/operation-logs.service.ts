import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OperationLog } from './operation-log.entity';

export interface OperationLogInput {
  actorId?: string | null;
  actorName?: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  description: string;
  details?: Record<string, any> | null;
}

@Injectable()
export class OperationLogsService {
  private readonly logger = new Logger('OperationLogs');

  constructor(
    @InjectRepository(OperationLog) private repo: Repository<OperationLog>,
  ) {}

  // 审计日志记录是「尽力而为」：写失败绝不能让主操作(如用户更新/创建)整体 500。
  async record(input: OperationLogInput): Promise<void> {
    try {
      const log = this.repo.create({
        actorId: input.actorId ?? null,
        actorName: input.actorName ?? null,
        action: input.action,
        targetType: input.targetType ?? null,
        targetId: input.targetId ?? null,
        description: input.description,
        details: input.details ?? null,
      });
      await this.repo.save(log);
    } catch (e: any) {
      this.logger.warn(`operation log failed (non-fatal): ${e?.message || e}`);
    }
  }

  async findRecent(limit = 100): Promise<OperationLog[]> {
    return this.repo.find({
      order: { createdAt: 'DESC' },
      take: Math.min(Math.max(limit, 1), 200),
      relations: ['actor'],
    });
  }
}
