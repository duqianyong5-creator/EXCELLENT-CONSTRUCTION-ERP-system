import { BadRequestException } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { RucService } from './ruc.service';
import { RucAlertLevel } from './ruc.util';

function build(vehicles: any[] = []) {
  const store = [...vehicles];
  const repo = {
    find: jest.fn(async () => store),
    findOne: jest.fn(async ({ where }: any) => store.find(
      (v) => (where.plate && v.plate === where.plate) || (where.id && v.id === where.id),
    ) || null),
    create: jest.fn((v: any) => ({ id: `veh-${store.length + 1}`, enabled: true, rucAlertLevel: 0, ...v })),
    save: jest.fn(async (v: any) => {
      const i = store.findIndex((s) => s.id === v.id);
      if (i >= 0) store[i] = { ...store[i], ...v }; else store.push(v);
      return v;
    }),
    update: jest.fn(async (id: string, patch: any) => {
      const v = store.find((s) => s.id === id);
      if (v) Object.assign(v, patch);
    }),
    delete: jest.fn(async () => undefined),
  };
  const notifications = { create: jest.fn(async () => []) };
  const settings = { getNumber: jest.fn(async (_k: string, fallback: number) => fallback) };
  const service = new RucService(repo as any, notifications as any, settings as any);
  return { service, repo, notifications, settings, store };
}

const vehicle = (over: any = {}) => ({
  id: 'v1', plate: 'ABC123', displayPlate: 'ABC123', enabled: true, rucAlertLevel: 0,
  odometerKm: 120_000, rucEndKm: 121_000, lastDeviceOdoKm: null,
  odoSnapshotKm: null, odoSnapshotAt: null, ...over,
});

beforeAll(() => { Logger.overrideLogger(false); });

describe('RucService vehicle registry', () => {
  it('matches vehicles by normalized plate, the same way devices and tasks do', async () => {
    const { service } = build([vehicle()]);
    await expect(service.findByPlate(' abc-123 ')).resolves.toMatchObject({ id: 'v1' });
    await expect(service.findByPlate('ZZZ999')).resolves.toBeNull();
  });

  it('stores the plate normalized but keeps what the user typed for display', async () => {
    const { service } = build();
    const created = await service.create({ plate: ' abc-123 ', label: '1 号车' });
    expect(created).toMatchObject({ plate: 'ABC123', displayPlate: 'abc-123', label: '1 号车' });
  });

  it('refuses a duplicate plate instead of creating a second record for one truck', async () => {
    const { service } = build([vehicle()]);
    await expect(service.create({ plate: 'abc 123' })).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('RucService licence recording', () => {
  it('records a purchased licence and clears the previous alert state', async () => {
    const { service, repo } = build([vehicle({ rucAlertLevel: 3 })]);
    await service.recordLicence('v1', { licenceNo: 'RUC123', startKm: 121_000, endKm: 122_000 });
    const saved = repo.save.mock.calls.at(-1)![0];
    expect(saved).toMatchObject({ rucLicenceNo: 'RUC123', rucStartKm: 121_000, rucEndKm: 122_000, rucAlertLevel: 0 });
    expect(saved.rucPurchasedAt).toBeInstanceOf(Date);
  });

  it('rejects a licence that ends before it starts', async () => {
    const { service } = build([vehicle()]);
    await expect(service.recordLicence('v1', { licenceNo: 'X', startKm: 122_000, endKm: 121_000 }))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a licence that is already behind the current odometer', async () => {
    // 买了一张已经跑过的许可等于没买，必须当场拦下来
    const { service } = build([vehicle({ odometerKm: 125_000 })]);
    await expect(service.recordLicence('v1', { licenceNo: 'X', startKm: 120_000, endKm: 121_000 }))
      .rejects.toThrow(/已经超过|already/i);
  });
});

describe('RucService odometer calibration', () => {
  it('takes the human-entered hubodometer reading as the new source of truth', async () => {
    const { service, repo } = build([vehicle({ odometerKm: 120_000 })]);
    await service.calibrate('v1', 120_450);
    const saved = repo.save.mock.calls.at(-1)![0];
    expect(saved.odometerKm).toBe(120_450);
    expect(saved.odometerCalibratedKm).toBe(120_450);
    expect(saved.odometerCalibratedAt).toBeInstanceOf(Date);
  });

  it('accepts a downward correction — the estimate is what calibration exists to fix', async () => {
    // 系统里的里程是估算值，可能偏高（GPS 兜底会多算、换设备、或上次校准手滑多打一位）。
    // 以前这里拿估算值当下限拦住，结果输错一次就永久锁死，正确读数再也填不进去——
    // 而这辆车的 RUC 提醒从此全部基于错的基准。
    const { service, repo } = build([vehicle({ odometerKm: 500_000 })]);
    await service.calibrate('v1', 50_000);
    const saved = repo.save.mock.calls.at(-1)![0];
    expect(saved.odometerKm).toBe(50_000);
    expect(saved.odometerCalibratedKm).toBe(50_000);
    // 日均里程的起算点也要跟着重置，否则这次下调会被当成"跑了负数"
    expect(saved.odoSnapshotKm).toBe(50_000);
  });

  it('still rejects a reading that is not a usable number', async () => {
    const { service } = build([vehicle({ odometerKm: 120_000 })]);
    await expect(service.calibrate('v1', -1)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.calibrate('v1', NaN)).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('RucService: a licence with no mileage basis must not be silent', () => {
  it('tells the admin to calibrate when a licence is recorded but the truck was never calibrated', async () => {
    // 这是「漏买 RUC 被罚」最容易发生的情形：买了许可、录进系统，却漏掉一次性的
    // 里程表校准。系统算不出剩余里程，于是 level=UNKNOWN，而 UNKNOWN 的 rank 是 0——
    // 和「正常」走同一个分支被跳过，这辆车从此再也不会被提醒任何事。
    const { service, notifications, store } = build([
      vehicle({ odometerKm: null, odometerCalibratedKm: null, rucEndKm: 121_000 }),
    ]);

    await service.checkAll();

    expect(notifications.create).toHaveBeenCalledTimes(1);
    const payload = (notifications.create.mock.calls[0] as any)[1];
    expect(payload.type).toBe('ruc_due');
    expect(payload.meta.reason).toBe('never_calibrated');
    expect(payload.notifyAdmins).toBe(true);
    // 提醒里必须说清要做什么，否则收到的人不知道下一步
    expect(String(payload.content)).toMatch(/校准/);
    // 只提醒一次，不要每天刷
    await service.checkAll();
    expect(notifications.create).toHaveBeenCalledTimes(1);
    expect(store[0].rucAlertLevel).toBeGreaterThan(0);
  });

  it('stays quiet for a vehicle that has no licence recorded at all', async () => {
    // 没录许可的车可能只是还没设置完，天天报警会让人忽略所有 RUC 提醒
    const { service, notifications } = build([
      vehicle({ odometerKm: null, odometerCalibratedKm: null, rucEndKm: null }),
    ]);
    await service.checkAll();
    expect(notifications.create).not.toHaveBeenCalled();
  });

  it('resumes normal warn/critical alerts once the truck is calibrated', async () => {
    // 「需校准」标记占用的是同一个 rucAlertLevel 字段，如果校准后不归零，
    // 之后真正的 WARN(1)/CRITICAL(2) 都会被 rank <= 9 静默跳过——
    // 那就等于用一条提醒换掉了这辆车后续所有提醒。
    const { service, notifications, store } = build([
      vehicle({ odometerKm: null, odometerCalibratedKm: null, rucEndKm: 121_000 }),
    ]);
    await service.checkAll();
    expect(store[0].rucAlertLevel).toBeGreaterThan(0);

    await service.calibrate('v1', 120_900); // 剩 100 km -> CRITICAL
    expect(store[0].rucAlertLevel).toBe(0);

    notifications.create.mockClear();
    await service.checkAll();
    expect(notifications.create).toHaveBeenCalledTimes(1);
    expect((notifications.create.mock.calls[0] as any)[1].meta.reason).toBeUndefined();
  });

  it('does not hijack the normal warn/critical escalation', async () => {
    // 能算出剩余里程的车，走原来的分级逻辑，不应该被"需校准"这条抢走
    const { service, notifications } = build([vehicle({ odometerKm: 120_900 })]); // 剩 100 -> CRITICAL
    await service.checkAll();
    expect(notifications.create).toHaveBeenCalledTimes(1);
    const payload = (notifications.create.mock.calls[0] as any)[1];
    expect(payload.meta.reason).toBeUndefined();
  });
});

describe('RucService distance tracking from trackers', () => {
  it('accumulates distance reported by the vehicle tracker', async () => {
    const { service, repo } = build([vehicle({ odometerKm: 120_000, lastDeviceOdoKm: 8000 })]);
    await service.addDistance('ABC123', { deviceOdoKm: 8025 });
    expect(repo.update).toHaveBeenCalledWith('v1', expect.objectContaining({ odometerKm: 120_025 }));
  });

  it('does nothing for a plate that has no vehicle record', async () => {
    const { service, repo } = build([]);
    await service.addDistance('NOPE', { gpsKm: 10 });
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('never lets tracker noise move the estimate backwards', async () => {
    const { service, repo } = build([vehicle({ odometerKm: 120_000, lastDeviceOdoKm: 8000 })]);
    await service.addDistance('ABC123', { deviceOdoKm: 10 });
    const patch = repo.update.mock.calls.at(-1)?.[1] as any;
    expect(patch.odometerKm).toBe(120_000);
  });
});

describe('RucService reminders', () => {
  const thresholds = { warnKm: 500, criticalKm: 200, warnDays: 3 };

  it('notifies administrators when a licence is nearly used up', async () => {
    const { service, notifications } = build([vehicle({ odometerKm: 120_900 })]); // 剩 100
    await service.checkAll();
    expect(notifications.create).toHaveBeenCalledWith(null, expect.objectContaining({
      type: 'ruc_due',
      notifyAdmins: true,
    }));
    const content = (notifications.create.mock.calls[0] as any)[1].content as string;
    expect(content).toContain('ABC123');
    expect(content).toContain('100'); // 剩余公里要写在提醒里，否则调度不知道有多急
  });

  it('does not repeat the same level every time the check runs', async () => {
    // 车队已经吃过设备离线告警刷屏的亏，这里必须做去重
    const { service, notifications } = build([vehicle({ odometerKm: 120_900 })]);
    await service.checkAll();
    await service.checkAll();
    expect(notifications.create).toHaveBeenCalledTimes(1);
  });

  it('notifies again when the situation gets worse', async () => {
    const { service, notifications, store } = build([vehicle({ odometerKm: 120_600 })]); // WARN
    await service.checkAll();
    store[0].odometerKm = 121_100; // 已经超出许可
    await service.checkAll();
    expect(notifications.create).toHaveBeenCalledTimes(2);
    expect((notifications.create.mock.calls[1] as any)[1].title).toMatch(/超出|EXCEEDED|exceed/i);
  });

  it('stays quiet for vehicles that have plenty of distance left', async () => {
    const { service, notifications } = build([vehicle({ odometerKm: 119_000 })]);
    await service.checkAll();
    expect(notifications.create).not.toHaveBeenCalled();
  });

  it('stays quiet for a vehicle with no licence recorded rather than crying wolf', async () => {
    // 未登记不等于紧急；界面上会显示「未登记」，但不该每天推送
    const { service, notifications } = build([vehicle({ rucEndKm: null })]);
    await service.checkAll();
    expect(notifications.create).not.toHaveBeenCalled();
  });

  it('skips disabled vehicles', async () => {
    const { service, notifications } = build([vehicle({ odometerKm: 120_950, enabled: false })]);
    await service.checkAll();
    expect(notifications.create).not.toHaveBeenCalled();
  });

  it('keeps a rolling snapshot so it can project how many days are left', async () => {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000);
    const { service } = build([vehicle({
      odometerKm: 120_000, odoSnapshotKm: 118_600, odoSnapshotAt: sevenDaysAgo,
    })]);
    const rows = await service.listWithStatus();
    // 7 天跑了 1400 公里 = 每天 200；剩 1000 公里 ≈ 5 天
    expect(rows[0].avgDailyKm).toBeCloseTo(200, 0);
    expect(rows[0].projectedDays).toBeCloseTo(5, 0);
    expect(rows[0].level).toBe(RucAlertLevel.OK);
    expect(thresholds.warnDays).toBe(3);
  });
});
