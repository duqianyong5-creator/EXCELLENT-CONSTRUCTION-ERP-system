import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GpsLog } from './gps-log.entity';
import { Task, TaskStatus } from '../tasks/task.entity';
import { SystemSettingsService } from '../system-settings/system-settings.service';

/**
 * 进行中任务的排除条件两边都按文本比较，而不是 ::uuid[]。
 *
 * database.sql 里 gps_logs.task_id 定义成 UUID，但生产库是 synchronize 按实体建的，
 * 实体没写类型、按 string 推断成了 varchar。照着 database.sql 写 ::uuid[]，
 * 生产上就报 "operator does not exist: character varying = uuid"——
 * 2026-09-24 凌晨 3 点第一次真跑就是这么失败的（整条语句被拒，一行没删，但每晚都会失败）。
 * 按文本比较两种库结构都成立。
 */
/** 一次 DELETE 最多删多少行，分批跑完。整表一把删会长时间持锁，把上报和地图一起卡住 */
const BATCH_SIZE = 20_000;
/** 一次任务最多跑多少批，避免异常数据让定时任务无限循环 */
const MAX_BATCHES = 200;

@Injectable()
export class GpsCleanupService {
  private readonly logger = new Logger(GpsCleanupService.name);

  constructor(
    @InjectRepository(GpsLog) private gpsRepo: Repository<GpsLog>,
    @InjectRepository(Task) private taskRepo: Repository<Task>,
    private settings: SystemSettingsService,
  ) {}

  /**
   * 每天凌晨 3 点整理轨迹，分三段：
   *
   *   最近 gps_retention_days 天  → 原样保留（10 秒一个点，看细节用）
   *   到 gps_history_days 天为止  → 降采样，每 gps_downsample_seconds 秒留一个点
   *   更早                        → 删除
   *
   * 为什么要降采样：10 台车实时模式跑满 60 天是 518 万行、约 494MB，
   * 光轨迹就能把数据库塞满。降到每分钟一个点是 36 万行、约 34MB，
   * 两个月的回放照样看得出车走了哪条路。
   *
   * 进行中任务的点一律不动，地图实时要用。工时数字存在 work_records，删点不影响工时。
   */
  @Cron(CronExpression.EVERY_DAY_AT_3AM, { timeZone: 'Pacific/Auckland' })
  async cleanupOldGps() {
    try {
      const fullDays = await this.settings.getNumber('gps_retention_days', 7);
      const historyDays = Math.max(fullDays, await this.settings.getNumber('gps_history_days', 60));
      const bucketSeconds = Math.max(10, await this.settings.getNumber('gps_downsample_seconds', 60));

      const now = Date.now();
      const downsampleBefore = new Date(now - fullDays * 86400_000);
      const deleteBefore = new Date(now - historyDays * 86400_000);

      // 进行中任务的 id（这些任务的 GPS 点要保留，地图实时要用）
      const inProgress = await this.taskRepo.find({
        where: { status: TaskStatus.IN_PROGRESS },
        select: ['id'],
      });
      const keepTaskIds = inProgress.map((t) => t.id);

      const purged = await this.purgeOlderThan(deleteBefore, keepTaskIds);
      const thinned = await this.downsample(deleteBefore, downsampleBefore, bucketSeconds, keepTaskIds);

      this.logger.log(
        `GPS 清理完成：删除 ${purged} 条（超过 ${historyDays} 天）、` +
          `降采样删除 ${thinned} 条（${fullDays}~${historyDays} 天，每 ${bucketSeconds} 秒保留一个点）`,
      );
    } catch (e: any) {
      this.logger.error(`GPS 清理失败：${e?.message || e}`);
    }
  }

  /** 超过保留期的点直接删掉 */
  private async purgeOlderThan(cutoff: Date, keepTaskIds: string[]): Promise<number> {
    let total = 0;
    for (let i = 0; i < MAX_BATCHES; i++) {
      const params: any[] = [cutoff, BATCH_SIZE];
      let keepClause = '';
      if (keepTaskIds.length > 0) {
        params.push(keepTaskIds);
        keepClause = `AND (task_id IS NULL OR NOT (task_id::text = ANY($${params.length}::text[])))`;
      }
      const result = await this.gpsRepo.query(
        `DELETE FROM gps_logs WHERE id IN (
           SELECT id FROM gps_logs
           WHERE timestamp < $1 ${keepClause}
           LIMIT $2
         )`,
        params,
      );
      const affected = rowCount(result);
      total += affected;
      if (affected < BATCH_SIZE) break;
    }
    return total;
  }

  /**
   * 把 [from, to) 区间内的点按时间桶抽稀：每个桶里只留最早的一条。
   * 按 driver_id + task_id 分组，避免把两台车的点当成同一条轨迹抽。
   */
  private async downsample(
    from: Date,
    to: Date,
    bucketSeconds: number,
    keepTaskIds: string[],
  ): Promise<number> {
    let total = 0;
    for (let i = 0; i < MAX_BATCHES; i++) {
      const params: any[] = [from, to, bucketSeconds, BATCH_SIZE];
      let keepClause = '';
      if (keepTaskIds.length > 0) {
        params.push(keepTaskIds);
        keepClause = `AND (task_id IS NULL OR NOT (task_id::text = ANY($${params.length}::text[])))`;
      }
      const result = await this.gpsRepo.query(
        `DELETE FROM gps_logs WHERE id IN (
           SELECT id FROM (
             SELECT id, ROW_NUMBER() OVER (
               PARTITION BY driver_id, task_id,
                 floor(extract(epoch FROM timestamp) / $3::int)
               ORDER BY timestamp
             ) AS rn
             FROM gps_logs
             WHERE timestamp >= $1 AND timestamp < $2 ${keepClause}
           ) ranked
           WHERE rn > 1
           LIMIT $4
         )`,
        params,
      );
      const affected = rowCount(result);
      total += affected;
      if (affected < BATCH_SIZE) break;
    }
    return total;
  }
}

/** pg 驱动对 DELETE 返回 [rows, rowCount]，不同版本形状不一样，统一取个数 */
function rowCount(result: unknown): number {
  if (Array.isArray(result) && typeof result[1] === 'number') return result[1];
  if (typeof result === 'number') return result;
  return 0;
}
