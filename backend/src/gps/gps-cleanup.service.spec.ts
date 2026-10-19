import { Logger } from '@nestjs/common';
import { GpsCleanupService } from './gps-cleanup.service';
import { TaskStatus } from '../tasks/task.entity';

/**
 * 这个服务会真的 DELETE 轨迹数据，删错了找不回来。
 * 重点验三件事：删的时间窗对不对、进行中任务有没有被保护、分批会不会停下来。
 */
const DAY = 86_400_000;

function build(opts: {
  inProgressTaskIds?: string[];
  settings?: Record<string, number>;
  deletedPerCall?: number[];
} = {}) {
  const queries: Array<{ sql: string; params: any[] }> = [];
  const deleted = opts.deletedPerCall ?? [];
  let call = 0;

  const gpsRepo = {
    query: jest.fn(async (sql: string, params: any[]) => {
      queries.push({ sql, params });
      const n = deleted[call] ?? 0;
      call++;
      return [[], n];
    }),
  };
  const taskRepo = {
    find: jest.fn(async () => (opts.inProgressTaskIds ?? []).map((id) => ({ id }))),
  };
  const settings = {
    getNumber: jest.fn(async (key: string, fallback: number) => opts.settings?.[key] ?? fallback),
  };

  const service = new GpsCleanupService(gpsRepo as any, taskRepo as any, settings as any);
  return { service, gpsRepo, taskRepo, settings, queries };
}

type Q = { sql: string; params: any[] };
const purgeQueries = (qs: Q[]) => qs.filter((q) => !q.sql.includes('ROW_NUMBER'));
const thinQueries = (qs: Q[]) => qs.filter((q) => q.sql.includes('ROW_NUMBER'));

beforeAll(() => { Logger.overrideLogger(false); });

describe('GpsCleanupService', () => {
  it('keeps recent points at full resolution and only thins the older window', async () => {
    const { service, queries } = build();
    const before = Date.now();
    await service.cleanupOldGps();
    const after = Date.now();

    const thin = thinQueries(queries)[0];
    expect(thin).toBeDefined();
    // 降采样只动 [60 天前, 7 天前) 这个区间：更近的原样保留，更早的由删除那步处理
    const from = new Date(thin.params[0]).getTime();
    const to = new Date(thin.params[1]).getTime();
    expect(to).toBeGreaterThanOrEqual(before - 7 * DAY - 5_000);
    expect(to).toBeLessThanOrEqual(after - 7 * DAY + 5_000);
    expect(from).toBeGreaterThanOrEqual(before - 60 * DAY - 5_000);
    expect(from).toBeLessThanOrEqual(after - 60 * DAY + 5_000);
    // 每 60 秒留一个点
    expect(thin.params[2]).toBe(60);
  });

  it('deletes only what is past the full history window', async () => {
    const { service, queries } = build();
    const before = Date.now();
    await service.cleanupOldGps();

    const purge = purgeQueries(queries)[0];
    const cutoff = new Date(purge.params[0]).getTime();
    expect(cutoff).toBeLessThanOrEqual(before - 60 * DAY + 5_000);
    // 下界同样要卡：只有上界时 cutoff=1970 也算通过，
    // 那等于清理什么都不回收，磁盘一路涨到满
    expect(cutoff).toBeGreaterThanOrEqual(before - 60 * DAY - 5_000);
    expect(purge.sql).toContain('DELETE FROM gps_logs');
  });

  it('never touches points belonging to a job that is still running', async () => {
    // 进行中任务的点是调度地图正在用的，删掉车就从地图上消失了
    const { service, queries, taskRepo } = build({ inProgressTaskIds: ['t1', 't2'] });
    await service.cleanupOldGps();

    expect(taskRepo.find).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: TaskStatus.IN_PROGRESS } }),
    );
    for (const q of queries) {
      // 断言子句的「形状」而不是「包含 task_id」——
      // 后者对正确写法和它的反面同时成立：PARTITION BY 里本来就有 task_id，
      // 把排除改成「只删进行中任务」照样能通过。
      expect(q.sql).toMatch(/NOT \(task_id::text = ANY\(/);
      // 少了 IS NULL 这一支，NOT (NULL = ANY(...)) 求值为 NULL，
      // 于是所有没有任务的设备点永远删不掉，清理静默失效
      expect(q.sql).toContain('task_id IS NULL OR');
      expect(q.params).toContainEqual(['t1', 't2']);
    }
  });

  it('does not add an exclusion clause when nothing is in progress', async () => {
    const { service, queries } = build({ inProgressTaskIds: [] });
    await service.cleanupOldGps();
    for (const q of queries) {
      expect(q.sql).not.toContain('ANY($');
    }
  });

  it('keeps batching while a batch comes back full, then stops', async () => {
    // 一次删 2 万行；满批说明还有，继续；不满批说明删完了，停。
    const { service, queries } = build({ deletedPerCall: [20_000, 20_000, 7] });
    await service.cleanupOldGps();
    expect(purgeQueries(queries).length).toBe(3);
  });

  it('stops batching immediately when the first batch is not full', async () => {
    const { service, queries } = build({ deletedPerCall: [3] });
    await service.cleanupOldGps();
    expect(purgeQueries(queries).length).toBe(1);
  });

  it('refuses to let the history window fall inside the full-resolution window', async () => {
    // 配置写反了（保留 30 天原始精度、总共只留 7 天）不能变成"把最近 7~30 天全删了"
    const { service, queries } = build({
      settings: { gps_retention_days: 30, gps_history_days: 7 },
    });
    await service.cleanupOldGps();

    const purge = purgeQueries(queries)[0];
    const thin = thinQueries(queries)[0];
    const purgeCutoff = new Date(purge.params[0]).getTime();
    const thinTo = new Date(thin.params[1]).getTime();
    // 删除线不能比"原始精度保留线"更晚
    expect(purgeCutoff).toBeLessThanOrEqual(thinTo + 5_000);
  });

  it('will not thin below a 10 second bucket', async () => {
    // 桶比上报间隔还小就等于什么都没删，白扫一遍全表
    const { service, queries } = build({ settings: { gps_downsample_seconds: 1 } });
    await service.cleanupOldGps();
    expect(thinQueries(queries)[0].params[2]).toBe(10);
  });

  it('logs and swallows a database failure instead of killing the scheduler', async () => {
    const { service, gpsRepo } = build();
    gpsRepo.query.mockRejectedValue(new Error('connection lost'));
    await expect(service.cleanupOldGps()).resolves.toBeUndefined();
  });
});
