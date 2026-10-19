import { BadRequestException } from '@nestjs/common';
import { ErrorCode } from '../common/i18n/messages';
import { GpsDeviceService, normalizePlate } from './gps-device.service';
import { TaskStatus } from '../tasks/task.entity';
import type { Position } from './jt808.codec';

// 实时点的时间必须是"刚刚"：写死日期的夹具会随着时间流逝被时钟修正逻辑改掉
const RECENT = new Date(Date.now() - 30_000);

function pos(over: Partial<Position> = {}): Position {
  return {
    alarm: 0, alarms: [], status: 2, acc: true, fixed: true, moving: true,
    latitude: -36.8485, longitude: 174.7633, altitude: 10, speedKmh: 42.5, heading: 90,
    time: RECENT,
    extras: { raw: new Map(), batteryPercent: 88, externalPower: true, signalPercent: 70 },
    ...over,
  };
}

function build(opts: { device?: any; tasks?: any[] } = {}) {
  const device = opts.device === undefined
    ? { id: 'dev1', deviceNo: '51160004464', vehiclePlate: 'ABC 123', enabled: true }
    : opts.device;
  const repo = {
    findOne: jest.fn(async ({ where }: any) => (where.deviceNo === '51160004464' || where.id === 'dev1') ? device : null),
    update: jest.fn(async () => undefined),
    create: jest.fn((v: any) => ({ id: 'new', ...v })),
    save: jest.fn(async (v: any) => v),
    find: jest.fn(async () => [device].filter(Boolean)),
    delete: jest.fn(async () => undefined),
  };
  const taskRepo = {
    find: jest.fn(async () => opts.tasks ?? [
      { id: 't1', driverId: 'd1', vehiclePlate: 'abc-123', updatedAt: new Date() },
    ]),
  };
  const gpsService = { upload: jest.fn(async () => ({ log: {}, anomalies: [] })) };
  const ruc = { addDistance: jest.fn(async () => undefined) };
  const alarms = { handle: jest.fn(async () => undefined), forget: jest.fn(), deviceBackOnline: jest.fn(async () => undefined) };
  const service = new GpsDeviceService(repo as any, taskRepo as any, gpsService as any, ruc as any, alarms as any);
  return { service, repo, taskRepo, gpsService, ruc, alarms, device };
}

describe('normalizePlate', () => {
  it('ignores case, spaces, hyphens and dots', () => {
    expect(normalizePlate(' abc-123 ')).toBe('ABC123');
    expect(normalizePlate('粤B·88888')).toBe('粤B88888');
    expect(normalizePlate(null)).toBe('');
  });
});

describe('GpsDeviceService.ingest', () => {
  it('returns unknown for an unregistered device and writes nothing', async () => {
    const { service, repo, gpsService } = build();
    expect(await service.ingest('999', pos())).toBe('unknown');
    expect(repo.update).not.toHaveBeenCalled();
    expect(gpsService.upload).not.toHaveBeenCalled();
  });

  it('returns disabled for a disabled device', async () => {
    const { service } = build({ device: { id: 'dev1', deviceNo: '51160004464', enabled: false } });
    expect(await service.ingest('051160004464', pos())).toBe('disabled');
  });

  it('stores the point on the in-progress task whose plate matches (case/space-insensitive)', async () => {
    const { service, repo, gpsService } = build();
    expect(await service.ingest('051160004464', pos())).toBe('stored');
    expect(gpsService.upload).toHaveBeenCalledWith('d1', 't1', expect.objectContaining({
      latitude: -36.8485, longitude: 174.7633, speed: 42.5, heading: 90,
      timestamp: RECENT, source: 'device',
    }));
    expect(repo.update).toHaveBeenCalledWith('dev1', expect.objectContaining({
      lastLatitude: -36.8485, lastLongitude: 174.7633, lastSpeed: 42.5, lastTaskId: 't1',
      lastFixAt: RECENT, // 设备页「最后定位」那一列靠它，写错了看不出来
      batteryPercent: 88, externalPower: true, signalPercent: 70,
    }));
  });

  it('asks the database for the most recently updated task first', async () => {
    const { service, taskRepo } = build();
    await service.ingest('51160004464', pos());
    expect(taskRepo.find).toHaveBeenCalledWith(expect.objectContaining({ order: { updatedAt: 'DESC' } }));
  });

  it('clears lastTaskId once the job is over, so a finished task stops looking live', async () => {
    const { service, repo } = build({ tasks: [] });
    expect(await service.ingest('51160004464', pos())).toBe('no_task');
    expect(repo.update).toHaveBeenCalledWith('dev1', expect.objectContaining({ lastTaskId: null }));
  });

  it('returns no_task when no in-progress task carries that plate, but still updates device state', async () => {
    const { service, repo, gpsService } = build({ tasks: [{ id: 't9', driverId: 'd9', vehiclePlate: 'ZZZ999', updatedAt: new Date() }] });
    expect(await service.ingest('51160004464', pos())).toBe('no_task');
    expect(gpsService.upload).not.toHaveBeenCalled();
    expect(repo.update).toHaveBeenCalledWith('dev1', expect.objectContaining({ lastLatitude: -36.8485 }));
  });

  it('ignores points without a GPS fix or with 0,0 / out-of-range coordinates (keeps liveness + battery)', async () => {
    const { service, repo, gpsService } = build();
    expect(await service.ingest('51160004464', pos({ fixed: false }))).toBe('no_fix');
    expect(await service.ingest('51160004464', pos({ latitude: 0, longitude: 0 }))).toBe('no_fix');
    expect(await service.ingest('51160004464', pos({ latitude: 95 }))).toBe('no_fix');
    expect(gpsService.upload).not.toHaveBeenCalled();
    const patch: any = (repo.update.mock.calls[0] as any)[1];
    expect(patch.lastSeenAt).toBeInstanceOf(Date);
    expect(patch.batteryPercent).toBe(88);
    expect(patch.lastLatitude).toBeUndefined();
  });

  it('replaces an obviously wrong device clock (unsynced / far future) with server time', async () => {
    const { service, gpsService } = build();
    const before = Date.now();
    await service.ingest('51160004464', pos({ time: new Date('2000-01-01T00:00:00Z') }));
    await service.ingest('51160004464', pos({ time: new Date(Date.now() + 3600 * 1000) }));
    for (const call of gpsService.upload.mock.calls) {
      const ts: Date = (call as any)[2].timestamp;
      expect(ts.getTime()).toBeGreaterThanOrEqual(before - 1000);
      expect(ts.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
    }
  });

  it('keeps a legitimately old blind-zone backfill timestamp (hours old)', async () => {
    const { service, gpsService } = build();
    const old = new Date(Date.now() - 6 * 3600 * 1000);
    await service.ingest('51160004464', pos({ time: old }), { batch: true, blindZone: true });
    const call: any = gpsService.upload.mock.calls[0];
    expect(call[2].timestamp).toEqual(old);
    expect(call[2].silent).toBe(true); // 补报不实时广播，否则一次几百个点会把前端刷爆
  });

  it('repairs an hours-old timestamp on a LIVE report (device clock/timezone misconfigured)', async () => {
    // 实时点落在在线窗口外 = 车在跑却不出现在地图上，是最难查的故障，必须用服务器时间兜底
    const { service, gpsService } = build();
    const before = Date.now();
    await service.ingest('51160004464', pos({ time: new Date(Date.now() - 4 * 3600 * 1000) }));
    const ts: Date = (gpsService.upload.mock.calls[0] as any)[2].timestamp;
    expect(ts.getTime()).toBeGreaterThanOrEqual(before - 1000);
  });

  it('caches device and task lookups and drops them on invalidate()', async () => {
    const { service, repo, taskRepo } = build();
    await service.ingest('51160004464', pos());
    await service.ingest('51160004464', pos());
    expect(repo.findOne).toHaveBeenCalledTimes(1);
    expect(taskRepo.find).toHaveBeenCalledTimes(1);
    expect(taskRepo.find).toHaveBeenCalledWith(expect.objectContaining({ where: { status: TaskStatus.IN_PROGRESS } }));
    service.invalidate('051160004464');
    await service.ingest('51160004464', pos());
    expect(repo.findOne).toHaveBeenCalledTimes(2);
    expect(taskRepo.find).toHaveBeenCalledTimes(2);
  });

  it('refuses to guess when two in-progress tasks claim the same plate', async () => {
    // 猜错就会把这辆车的位置画进别人的任务里（客户端也看得到），宁可不归属
    const { service, gpsService } = build({ tasks: [
      { id: 'newer', driverId: 'd2', vehiclePlate: 'ABC123', updatedAt: new Date('2026-09-14T02:00:00Z') },
      { id: 'older', driverId: 'd1', vehiclePlate: 'ABC 123', updatedAt: new Date('2026-09-13T02:00:00Z') },
    ] });
    expect(await service.ingest('51160004464', pos())).toBe('no_task');
    expect(gpsService.upload).not.toHaveBeenCalled();
  });

  it('only trusts a days-old timestamp when the device flagged it as blind-zone backfill', async () => {
    const { service, gpsService } = build();
    const old = new Date(Date.now() - 6 * 3600 * 1000);
    // 批量但没标盲区补报：按实时处理，时间被修正（否则可以用批量消息绕过时间校验）
    await service.ingest('51160004464', pos({ time: old }), { batch: true });
    expect((gpsService.upload.mock.calls[0] as any)[2].timestamp).not.toEqual(old);
    // 标了盲区补报：保留原始时间
    await service.ingest('51160004464', pos({ time: old }), { batch: true, blindZone: true });
    expect((gpsService.upload.mock.calls[1] as any)[2].timestamp).toEqual(old);
  });
});

describe('GpsDeviceService feeds vehicle mileage for RUC', () => {
  it('passes the tracker odometer through to the vehicle bound to that plate', async () => {
    // RUC 路税按里程买，这条链路断了提醒就永远不会响
    const { service, ruc } = build();
    await service.ingest('51160004464', pos({ extras: { raw: new Map(), mileageKm: 88_123.4 } }));
    expect(ruc.addDistance).toHaveBeenCalledWith('ABC 123', expect.objectContaining({ deviceOdoKm: 88_123.4 }));
  });

  it('falls back to GPS distance when the tracker reports no odometer', async () => {
    const { service, ruc } = build({
      device: { id: 'dev1', deviceNo: '51160004464', vehiclePlate: 'ABC 123', enabled: true, lastLatitude: -36.8485, lastLongitude: 174.7633 },
    });
    await service.ingest('51160004464', pos({ latitude: -36.8585, longitude: 174.7633 }));
    const call: any = ruc.addDistance.mock.calls[0];
    expect(call[1].deviceOdoKm).toBeUndefined();
    expect(call[1].gpsKm).toBeGreaterThan(1);
    expect(call[1].gpsKm).toBeLessThan(2); // 0.01 度纬度 ≈ 1.1 km
  });

  it('does not feed mileage for a device with no plate bound', async () => {
    const { service, ruc } = build({ device: { id: 'dev1', deviceNo: '51160004464', vehiclePlate: null, enabled: true } });
    await service.ingest('51160004464', pos());
    expect(ruc.addDistance).not.toHaveBeenCalled();
  });

  it('does not feed mileage from a point with no GPS fix', async () => {
    const { service, ruc } = build();
    await service.ingest('51160004464', pos({ fixed: false }));
    expect(ruc.addDistance).not.toHaveBeenCalled();
  });
});

describe('GpsDeviceService.listWithTasks / plates', () => {
  it('attaches the in-progress task and driver of the matching plate, null when none matches', async () => {
    const { service, repo } = build();
    repo.find.mockResolvedValueOnce([
      { id: 'dev1', deviceNo: '51160004464', vehiclePlate: 'ABC 123', enabled: true },
      { id: 'dev2', deviceNo: '51160004465', vehiclePlate: 'ZZZ999', enabled: true },
      { id: 'dev3', deviceNo: '51160004466', vehiclePlate: null, enabled: true },
    ]);
    const rows = await service.listWithTasks();
    expect(rows[0].currentTask).toEqual({ id: 't1', title: undefined, driverName: '司机' });
    expect(rows[1].currentTask).toBeNull();
    expect(rows[2].currentTask).toBeNull();
  });

  it('prefers the driver full name and the most recent task per plate', async () => {
    const { service, repo, taskRepo } = build();
    repo.find.mockResolvedValueOnce([{ id: 'dev1', deviceNo: '51160004464', vehiclePlate: 'abc123', enabled: true }]);
    taskRepo.find.mockResolvedValueOnce([
      { id: 'newer', title: 'T-2', driverId: 'd2', driver: { fullName: '张三' }, vehiclePlate: 'ABC-123' },
      { id: 'older', title: 'T-1', driverId: 'd1', driver: { fullName: '李四' }, vehiclePlate: 'ABC123' },
    ]);
    const rows = await service.listWithTasks();
    expect(rows[0].currentTask).toEqual({ id: 'newer', title: 'T-2', driverName: '张三' });
  });

  it('plates() returns enabled, plate-bound devices only, deduped by normalized plate', async () => {
    const { service, repo } = build();
    repo.find.mockResolvedValueOnce([
      { id: '1', deviceNo: '1', vehiclePlate: 'ABC123', name: '1 号车', enabled: true },
      { id: '2', deviceNo: '2', vehiclePlate: 'abc-123', name: '备用', enabled: true },
      { id: '3', deviceNo: '3', vehiclePlate: '  ', name: null, enabled: true },
      { id: '4', deviceNo: '4', vehiclePlate: 'XYZ789', name: null, enabled: true },
    ]);
    const plates = await service.plates();
    expect(repo.find).toHaveBeenCalledWith(expect.objectContaining({ where: { enabled: true } }));
    expect(plates).toEqual([
      { plate: 'ABC123', name: '1 号车' },
      { plate: 'XYZ789', name: null },
    ]);
  });
});

describe('GpsDeviceService.create / touch', () => {
  it('rejects a 15-digit IMEI with a message telling the user which number to use', async () => {
    const { service } = build({ device: null });
    await expect(service.create({ deviceNo: '867567041100769' })).rejects.toThrow(/IMEI/);
  });

  it('rejects an over-long plate or name instead of failing at the database', async () => {
    const { service } = build({ device: null });
    await expect(service.create({ deviceNo: '51160004464', vehiclePlate: 'X'.repeat(33) })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.create({ deviceNo: '51160004464', name: 'N'.repeat(129) })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('normalizes the device number and rejects non-numeric or duplicate numbers', async () => {
    const { service, repo } = build({ device: null });
    await expect(service.create({ deviceNo: 'abc' })).rejects.toBeInstanceOf(BadRequestException);
    const created = await service.create({ deviceNo: ' 0511-6000-4464 ', vehiclePlate: ' abc123 ', name: ' Truck 1 ' });
    expect(created).toMatchObject({ deviceNo: '51160004464', vehiclePlate: 'abc123', name: 'Truck 1', enabled: true });
    repo.findOne.mockResolvedValueOnce({ id: 'x', deviceNo: '51160004464' });
    await expect(service.create({ deviceNo: '51160004464' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('touch refreshes lastSeenAt (and battery when given) for known devices only', async () => {
    const { service, repo } = build();
    await service.touch('051160004464', { batteryPercent: 40 });
    expect(repo.update).toHaveBeenCalledWith('dev1', expect.objectContaining({ batteryPercent: 40, lastSeenAt: expect.any(Date) }));
    repo.update.mockClear();
    await service.touch('1');
    expect(repo.update).not.toHaveBeenCalled();
  });
});

describe('GpsDeviceService.ingest -> 报警判定', () => {
  it('hands every live position to the alarm service with the resolved task', async () => {
    const { service, alarms } = build();
    const p = pos({ alarms: ['power_cut'] });
    await service.ingest('51160004464', p);
    expect(alarms.handle).toHaveBeenCalledWith(
      expect.objectContaining({ deviceNo: '51160004464' }),
      p,
      expect.objectContaining({ hasFix: true, target: { taskId: 't1', driverId: 'd1' } }),
    );
  });

  it('still evaluates alarms when no task matches (车辆空闲时被撬也要报)', async () => {
    const { service, alarms } = build({ tasks: [] });
    await service.ingest('51160004464', pos({ alarms: ['shock'] }));
    expect(alarms.handle).toHaveBeenCalledWith(expect.anything(), expect.anything(),
      expect.objectContaining({ hasFix: true, target: null }));
  });

  it('tells the alarm service there is no fix, so geofences are not evaluated on 0,0', async () => {
    const { service, alarms } = build();
    await service.ingest('51160004464', pos({ fixed: false }));
    expect(alarms.handle).toHaveBeenCalledWith(expect.anything(), expect.anything(),
      expect.objectContaining({ hasFix: false }));
  });

  it('does NOT replay alarms for blind-zone backfill points', async () => {
    // 补报是一次性倒出来的几百个历史点：拿它们做状态变化判定会把早就过去的报警重放一遍
    const { service, alarms } = build();
    await service.ingest('51160004464', pos({ alarms: ['power_cut'] }), { batch: true, blindZone: true });
    expect(alarms.handle).not.toHaveBeenCalled();
  });

  it('forgets in-memory alarm state when the device registration changes', async () => {
    // 车牌一改，这台车要比的围栏就变了；停用/删除同理
    const { service, alarms } = build();
    await service.update('dev1', { vehiclePlate: 'XYZ999' });
    expect(alarms.forget).toHaveBeenCalledWith('51160004464');
  });

  it('keeps ingest alive when alarm handling blows up', async () => {
    const { service, alarms, gpsService } = build();
    alarms.handle.mockRejectedValue(new Error('boom'));
    // handle() 自己吞异常；即便它没吞住，定位入库也不该被带走
    await expect(service.ingest('51160004464', pos())).rejects.toThrow();
    expect(gpsService.upload).toHaveBeenCalled();
  });
});

describe('GpsDeviceService: 设备连上后补传的存货', () => {
  // 2026-09-28：那台设备连上后先用普通 0x0200 倒出了 80 个 2~4 天前的点，每个都被改成了「现在」
  const TWO_DAYS_AGO = () => new Date(Date.now() - 2 * 24 * 3600 * 1000);

  it('keeps a days-old point with its own time when the device clock is trusted', async () => {
    const { service, gpsService } = build();
    const old = TWO_DAYS_AGO();
    expect(await service.ingest('51160004464', pos({ time: old }), { clockTrusted: true })).toBe('stored');
    const call: any = gpsService.upload.mock.calls[0];
    expect(call[2].timestamp).toEqual(old);
    expect(call[2].silent).toBe(true); // 一次倒几十上百个点，不实时广播
  });

  it('does not let a stored point move the live position, power state, mileage or alarms', async () => {
    const { service, repo, ruc, alarms } = build();
    await service.ingest('51160004464', pos({
      time: TWO_DAYS_AGO(), alarms: ['power_cut'],
      extras: { raw: new Map(), batteryPercent: 20, externalPower: false, signalPercent: 5, mileageKm: 500 },
    }), { clockTrusted: true });
    const patch: any = (repo.update.mock.calls[0] as any)[1];
    expect(patch.lastSeenAt).toBeInstanceOf(Date); // 设备确实在线
    expect(patch).not.toHaveProperty('lastLatitude');
    expect(patch).not.toHaveProperty('lastFixAt');
    expect(patch).not.toHaveProperty('externalPower');
    expect(patch).not.toHaveProperty('batteryPercent');
    expect(patch).not.toHaveProperty('lastTaskId');
    expect(ruc.addDistance).not.toHaveBeenCalled(); // 旧里程读数会让下一次实时读数把同一段路再算一遍
    expect(alarms.handle).not.toHaveBeenCalled(); // 两天前的断电不是现在的断电
  });

  it('does not attach a stored point to a task created after it', async () => {
    const { service, gpsService } = build({
      tasks: [{ id: 't1', driverId: 'd1', vehiclePlate: 'abc-123', updatedAt: new Date(), createdAt: new Date(Date.now() - 3600 * 1000) }],
    });
    expect(await service.ingest('51160004464', pos({ time: TWO_DAYS_AGO() }), { clockTrusted: true })).toBe('no_task');
    expect(gpsService.upload).not.toHaveBeenCalled();
  });

  it('attaches it when the task already existed at that time', async () => {
    const { service, gpsService } = build({
      tasks: [{ id: 't1', driverId: 'd1', vehiclePlate: 'abc-123', updatedAt: new Date(), createdAt: new Date(Date.now() - 3 * 24 * 3600 * 1000) }],
    });
    expect(await service.ingest('51160004464', pos({ time: TWO_DAYS_AGO() }), { clockTrusted: true })).toBe('stored');
    expect(gpsService.upload).toHaveBeenCalledTimes(1);
  });

  it('still repairs the time when the clock is NOT trusted (timezone misconfigured)', async () => {
    const { service, gpsService, alarms } = build();
    const before = Date.now();
    await service.ingest('51160004464', pos({ time: TWO_DAYS_AGO() }));
    expect((gpsService.upload.mock.calls[0] as any)[2].timestamp.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(alarms.handle).toHaveBeenCalled(); // 按实时点对待
  });

  it('logs one line per replay burst, not one per point', async () => {
    const { service } = build();
    const log = jest.spyOn((service as any).logger, 'log');
    const warn = jest.spyOn((service as any).logger, 'warn');
    for (let i = 0; i < 20; i++) {
      await service.ingest('51160004464', pos({ time: new Date(Date.now() - (3 - i * 0.1) * 24 * 3600 * 1000) }), { clockTrusted: true });
    }
    expect(log.mock.calls.filter(([m]) => String(m).includes('is uploading stored points'))).toHaveLength(1);
    expect(warn.mock.calls.filter(([m]) => String(m).includes('clock off'))).toHaveLength(0);
  });

  it('does not stretch the trust beyond a week', async () => {
    const { service, gpsService } = build();
    const ancient = new Date(Date.now() - 30 * 24 * 3600 * 1000);
    await service.ingest('51160004464', pos({ time: ancient }), { clockTrusted: true });
    expect((gpsService.upload.mock.calls[0] as any)[2].timestamp).not.toEqual(ancient);
  });

  it('deviceOnline() clears the offline alarm for the normalized device number', async () => {
    const { service, alarms } = build();
    await service.deviceOnline('051160004464');
    expect(alarms.deviceBackOnline).toHaveBeenCalledWith('51160004464');
  });
});

describe('GpsDeviceService: SIM ICCID', () => {
  const ICCID = '898600F11926F0185264';

  it('normalizes a hand-typed ICCID and rejects something that is not one', async () => {
    const { service } = build({ device: null });
    const created = await service.create({ deviceNo: '51160004464', iccid: ' 8986 00f1 1926 f018 5264 ' });
    expect(created.iccid).toBe(ICCID);
    await expect(service.create({ deviceNo: '51160004464', iccid: '12345' })).rejects.toBeInstanceOf(BadRequestException);
    // 报的得是 ICCID 的错，不是设备号的错
    await expect(service.create({ deviceNo: '51160004464', iccid: 'F'.repeat(20) })).rejects.toMatchObject({ message: ErrorCode.DEVICE_ICCID_INVALID });
    const blank = await service.create({ deviceNo: '51160004464', iccid: '  ' });
    expect(blank.iccid).toBeNull();
    const none = await service.create({ deviceNo: '51160004464' });
    expect(none.iccid).toBeNull();
  });

  it('update(): omitted leaves the ICCID alone, null clears it', async () => {
    const { service, repo } = build({ device: { id: 'dev1', deviceNo: '51160004464', vehiclePlate: 'ABC 123', enabled: true, iccid: ICCID } });
    await service.update('dev1', { name: 'truck 1' });
    expect((repo.save.mock.calls[0] as any)[0].iccid).toBe(ICCID);
    await service.update('dev1', { iccid: null as any });
    expect((repo.save.mock.calls[1] as any)[0].iccid).toBeNull();
  });

  it('update() can set or clear the ICCID', async () => {
    const { service, repo } = build();
    await service.update('dev1', { iccid: ICCID.toLowerCase() });
    expect((repo.save.mock.calls[0] as any)[0].iccid).toBe(ICCID);
    await service.update('dev1', { iccid: '' });
    expect((repo.save.mock.calls[1] as any)[0].iccid).toBeNull();
  });

  it('takes the ICCID the device reports, writes it once, and logs a SIM change', async () => {
    const { service, repo, device } = build();
    const warn = jest.spyOn((service as any).logger, 'warn');
    await service.touch('51160004464', { iccid: ICCID });
    expect((repo.update.mock.calls[0] as any)[1]).toMatchObject({ iccid: ICCID });
    expect(warn).not.toHaveBeenCalled(); // 第一次知道这张卡，不是换卡
    await service.touch('51160004464', { iccid: ICCID });
    expect((repo.update.mock.calls[1] as any)[1]).not.toHaveProperty('iccid'); // 没变就不重写
    await service.touch('51160004464', { iccid: '89640000000000000001' });
    // 日志只留尾 6 位：ICCID 是计费标识，全值在库里
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('SIM changed: …185264 -> …000001'));
    expect(device.iccid).toBe('89640000000000000001');
  });

  it('stops following a device whose ICCID flaps (frames replayed with a known device number)', async () => {
    const { service, repo, device } = build();
    const warn = jest.spyOn((service as any).logger, 'warn');
    const a = '89860000000000000001';
    const b = '89860000000000000002';
    for (let i = 0; i < 10; i++) await service.touch('51160004464', { iccid: i % 2 ? b : a });
    // 前 3 次跟着变（a, b, a），之后库里保持不动，只多一条「在刷」的警告
    const written = repo.update.mock.calls.map((c: any) => c[1].iccid).filter(Boolean);
    expect(written).toEqual([a, b, a]);
    expect(device.iccid).toBe(a);
    expect(warn.mock.calls.filter(([m]) => String(m).includes('keeps changing'))).toHaveLength(1);
  });

  it('picks the ICCID out of a position report too', async () => {
    const { service, repo } = build();
    await service.ingest('51160004464', pos({ extras: { raw: new Map(), iccid: ICCID } }));
    expect((repo.update.mock.calls[0] as any)[1]).toMatchObject({ iccid: ICCID });
  });

  it('a blind-zone backfill point still records the ICCID (the SIM is static) but not the old battery', async () => {
    const { service, repo } = build();
    const old = new Date(Date.now() - 2 * 24 * 3600 * 1000);
    await service.ingest('51160004464', pos({ time: old, extras: { raw: new Map(), iccid: ICCID, batteryPercent: 12 } }), { batch: true, blindZone: true });
    const patch: any = (repo.update.mock.calls[0] as any)[1];
    expect(patch.iccid).toBe(ICCID);
    expect(patch.batteryPercent).toBeUndefined();
  });

  it('the device-reported ICCID overrides a hand-typed one and says so', async () => {
    const { service, repo } = build({ device: { id: 'dev1', deviceNo: '51160004464', enabled: true, iccid: '8986001111111111111' } });
    const warn = jest.spyOn((service as any).logger, 'warn');
    await service.touch('51160004464', { iccid: ICCID });
    expect((repo.update.mock.calls[0] as any)[1].iccid).toBe(ICCID);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('SIM changed'));
  });

  it('touch() for an unregistered device writes nothing', async () => {
    const { service, repo } = build();
    await service.touch('999', { iccid: ICCID });
    expect(repo.update).not.toHaveBeenCalled();
  });
});
