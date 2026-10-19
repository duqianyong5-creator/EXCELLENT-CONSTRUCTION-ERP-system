import { GpsService } from './gps.service';
import { TaskStatus } from '../tasks/task.entity';
import { UserRole } from '../users/user.entity';
import { ForbiddenException } from '@nestjs/common';

// 检测到超速/瞬移时会往 gps_anomalies 落一条记录，这里给个最小 stub
function anomalyStub() {
  return { create: jest.fn((v: any) => v), save: jest.fn(async (v: any) => v) };
}


describe('GpsService live positions', () => {
  it('returns one fresh position per driver, filtered to in-progress tasks', async () => {
    const ts = new Date('2026-06-27T00:00:00.000Z');
    const qb = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getMany: jest.fn(async () => [
        { driverId: 'd1', taskId: 't1', latitude: 1, longitude: 2, speed: 0, timestamp: ts },
        { driverId: 'd1', taskId: 't1', latitude: 9, longitude: 9, speed: 0, timestamp: new Date(ts.getTime() - 1000) },
        { driverId: 'd2', taskId: 't1', latitude: 3, longitude: 4, speed: 0, timestamp: ts },
      ]),
    };
    const gpsRepo = { createQueryBuilder: jest.fn(() => qb) };
    const taskRepo = { find: jest.fn(async () => [{ id: 't1' }]) };
    const service = new GpsService(
      gpsRepo as any,
      taskRepo as any,
      anomalyStub() as any,
      { create: jest.fn(), broadcastGpsUpdate: jest.fn() } as any,
    );

    const result = await service.getLatestPositions();

    // 只查进行中任务
    expect(taskRepo.find).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: TaskStatus.IN_PROGRESS } }),
    );
    // 用数据库时钟比对新鲜度（NOW() - INTERVAL）
    expect(qb.andWhere).toHaveBeenCalledWith(
      expect.stringContaining('NOW()'),
      expect.objectContaining({ windowSec: expect.any(Number) }),
    );
    // 每个司机只保留最新一条
    expect(result).toHaveLength(2);
    expect(result.find((p: any) => p.driverId === 'd1')).toMatchObject({ latitude: 1, longitude: 2 });
  });

  it('returns empty when there are no in-progress tasks (no gps query)', async () => {
    const gpsRepo = { createQueryBuilder: jest.fn() };
    const taskRepo = { find: jest.fn(async () => []) };
    const service = new GpsService(gpsRepo as any, taskRepo as any, anomalyStub() as any, {} as any);

    const result = await service.getLatestPositions();

    expect(result).toEqual([]);
    expect(gpsRepo.createQueryBuilder).not.toHaveBeenCalled();
  });
});

describe('GpsService position/track authorization (IDOR fix)', () => {
  const makeService = (taskRow: any) => {
    const gpsRepo = {
      find: jest.fn(async () => [{ id: 'g1', taskId: 't1' }]),
      findOne: jest.fn(async () => ({ id: 'g1', driverId: 'd1', latitude: 1, longitude: 2 })),
    };
    const taskRepo = { findOne: jest.fn(async () => taskRow) };
    const service = new GpsService(gpsRepo as any, taskRepo as any, anomalyStub() as any, {} as any);
    return { service, gpsRepo, taskRepo };
  };

  it('lets staff (dispatcher) read any task track without an ownership lookup', async () => {
    const { service, taskRepo } = makeService(null);
    await expect(
      service.getTrackForUser('t1', { id: 'staff', role: UserRole.DISPATCHER }),
    ).resolves.toHaveLength(1);
    expect(taskRepo.findOne).not.toHaveBeenCalled();
  });

  it('lets a client read the track of their own task', async () => {
    const { service } = makeService({ id: 't1', clientId: 'c1', driverId: 'd1' });
    await expect(
      service.getTrackForUser('t1', { id: 'c1', role: UserRole.CLIENT }),
    ).resolves.toHaveLength(1);
  });

  it('blocks a client from reading another client\'s task track', async () => {
    const { service } = makeService({ id: 't1', clientId: 'OTHER', driverId: 'd1' });
    await expect(
      service.getTrackForUser('t1', { id: 'c1', role: UserRole.CLIENT }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('blocks a client from reading an arbitrary driver position not on their task', async () => {
    const { service, taskRepo } = makeService(null); // no task links this client to the driver
    await expect(
      service.getDriverPositionForUser('d-other', { id: 'c1', role: UserRole.CLIENT }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(taskRepo.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ where: { clientId: 'c1', driverId: 'd-other' } }),
    );
  });

  it('lets a client read the position of a driver on their own task', async () => {
    const { service } = makeService({ id: 't1' }); // task linking c1 -> d1 exists
    await expect(
      service.getDriverPositionForUser('d1', { id: 'c1', role: UserRole.CLIENT }),
    ).resolves.toMatchObject({ driverId: 'd1' });
  });
});

describe('GpsService upload realtime broadcast', () => {
  it('broadcasts the saved GPS point so maps can update immediately', async () => {
    const savedAt = new Date('2026-06-27T00:00:00.000Z');
    const gpsRepo = {
      findOne: jest.fn(async () => null),
      create: jest.fn((data) => data),
      save: jest.fn(async (data) => ({ id: 'gps-1', timestamp: savedAt, ...data })),
    };
    const notifService = {
      create: jest.fn(),
      broadcastGpsUpdate: jest.fn(),
    };
    const service = new GpsService(
      gpsRepo as any,
      {} as any,
      anomalyStub() as any,
      notifService as any,
    );

    await service.upload('driver-1', 'task-1', {
      latitude: -36.87444,
      longitude: 174.85928,
      speed: 42,
      heading: 180,
      accuracy: 6,
    });

    expect(notifService.broadcastGpsUpdate).toHaveBeenCalledWith('driver-1', {
      taskId: 'task-1',
      latitude: -36.87444,
      longitude: 174.85928,
      speed: 42,
      heading: 180,
      accuracy: 6,
      timestamp: savedAt,
    });
  });

  it('does not broadcast a silent (blind-zone backfill) point', async () => {
    const gpsRepo = {
      findOne: jest.fn(async () => null),
      create: jest.fn((data) => data),
      save: jest.fn(async (data) => ({ id: 'gps-1', ...data })),
    };
    const notifService = { create: jest.fn(), broadcastGpsUpdate: jest.fn() };
    const service = new GpsService(gpsRepo as any, {} as any, anomalyStub() as any, notifService as any);

    await service.upload('driver-1', 'task-1', {
      latitude: 1, longitude: 2, speed: 0, source: 'device', silent: true,
      timestamp: new Date('2026-06-27T00:00:00.000Z'),
    });

    expect(notifService.broadcastGpsUpdate).not.toHaveBeenCalled();
    expect(gpsRepo.create).toHaveBeenCalledWith(expect.objectContaining({
      source: 'device', timestamp: new Date('2026-06-27T00:00:00.000Z'),
    }));
  });
});

describe('GpsService anomaly recording', () => {
  const build = () => {
    const gpsRepo = {
      findOne: jest.fn(async () => null),
      create: jest.fn((data: any) => data),
      save: jest.fn(async (data: any) => ({ id: 'gps-1', ...data })),
    };
    const anomalyRepo = { create: jest.fn((v: any) => v), save: jest.fn(async (v: any) => v) };
    const notifService = { create: jest.fn(), broadcastGpsUpdate: jest.fn() };
    const service = new GpsService(gpsRepo as any, {} as any, anomalyRepo as any, notifService as any);
    return { service, gpsRepo, anomalyRepo, notifService };
  };

  it('writes a row to gps_anomalies, not just a notification', async () => {
    // 「异常管理」页读的是 gps_anomalies 表。以前只发了一条通知，
    // 于是一辆记录到 160 km/h 的车事后在系统里完全查不到、也没法标记处理。
    const { service, anomalyRepo, notifService } = build();

    const { anomalies } = await service.upload('driver-1', 'task-1', {
      latitude: -36.8, longitude: 174.7, speed: 180,
    });

    expect(anomalies).toContain('speed_anomaly');
    expect(anomalyRepo.save).toHaveBeenCalledTimes(1);
    const row = anomalyRepo.create.mock.calls[0][0] as any;
    expect(row.anomalyType).toBe('speed_anomaly');
    expect(row.driverId).toBe('driver-1');
    expect(row.taskId).toBe('task-1');
    // 事后要看得出到底怎么了，光一个类型名没法判断
    expect(String(row.description)).toMatch(/180/);
    expect(notifService.create).toHaveBeenCalledTimes(1);
  });

  it('still stores the position when the anomaly row cannot be written', async () => {
    // 定位点已经落库了，异常记录写失败不该把上报打回去让司机 App 一直重试
    const { service, anomalyRepo } = build();
    anomalyRepo.save.mockRejectedValueOnce(new Error('db down'));

    await expect(
      service.upload('driver-1', 'task-1', { latitude: -36.8, longitude: 174.7, speed: 180 }),
    ).resolves.toMatchObject({ log: expect.objectContaining({ id: 'gps-1' }) });
  });

  it('records nothing when the point is normal', async () => {
    const { service, anomalyRepo } = build();
    await service.upload('driver-1', 'task-1', { latitude: -36.8, longitude: 174.7, speed: 45 });
    expect(anomalyRepo.save).not.toHaveBeenCalled();
  });
});

describe('GpsService phone + tracker on the same task', () => {
  const makeService = (lastLog: any) => {
    const gpsRepo = {
      findOne: jest.fn(async () => lastLog),
      create: jest.fn((data) => data),
      save: jest.fn(async (data) => ({ id: 'g', timestamp: new Date(), ...data })),
    };
    const notifService = { create: jest.fn(), broadcastGpsUpdate: jest.fn() };
    return { service: new GpsService(gpsRepo as any, {} as any, anomalyStub() as any, notifService as any), notifService };
  };

  it('does NOT flag teleport when the previous point came from the other source', async () => {
    // 司机把车停在工地、自己带着手机离开：车上定位器和手机本就相距很远，
    // 跨来源比较会把每一个点都判成瞬移，给管理员刷屏报警
    const { service, notifService } = makeService({
      latitude: -36.8, longitude: 174.7, timestamp: new Date(Date.now() - 60_000), source: 'app',
    });
    const { anomalies } = await service.upload('d1', 't1', {
      latitude: -37.9, longitude: 175.9, speed: 10, source: 'device', timestamp: new Date(),
    });
    expect(anomalies).not.toContain('teleport');
    expect(notifService.create).not.toHaveBeenCalled();
  });

  it('still flags teleport within the same source', async () => {
    const { service } = makeService({
      latitude: -36.8, longitude: 174.7, timestamp: new Date(Date.now() - 60_000), source: 'device',
    });
    const { anomalies } = await service.upload('d1', 't1', {
      latitude: -37.9, longitude: 175.9, speed: 10, source: 'device', timestamp: new Date(),
    });
    expect(anomalies).toContain('teleport');
  });

  it('live map prefers the tracker point over the phone point for the same driver', async () => {
    const now = new Date();
    const qb = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getMany: jest.fn(async () => [
        { driverId: 'd1', taskId: 't1', latitude: 1, longitude: 1, source: 'app', timestamp: now },
        { driverId: 'd1', taskId: 't1', latitude: 2, longitude: 2, source: 'device', timestamp: new Date(now.getTime() - 5000) },
      ]),
    };
    const service = new GpsService(
      { createQueryBuilder: jest.fn(() => qb) } as any,
      { find: jest.fn(async () => [{ id: 't1' }]) } as any,
      anomalyStub() as any,
      {} as any,
    );

    const result = await service.getLatestPositions();

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ latitude: 2, longitude: 2, source: 'device' });
  });

  it('track replay uses tracker points once the tracker is really following the trip', async () => {
    const base = Date.now();
    const devicePoints = [1, 2, 3, 4, 5, 6].map((id) => ({ id, source: 'device', timestamp: new Date(base + id * 1000) }));
    const rows = [
      { id: 0, source: 'app', timestamp: new Date(base) },
      ...devicePoints,
      { id: 9, source: 'app', timestamp: new Date(base + 7000) },
    ];
    const service = new GpsService({ find: jest.fn(async () => rows) } as any, {} as any, anomalyStub() as any, {} as any);
    await expect(service.getTrack('t1')).resolves.toEqual(devicePoints);
  });

  it('does not flag teleport for a backfilled point older than the last stored one', async () => {
    // 盲区补报一次上来几百个历史点，若逐点判成瞬移，会给每个管理员刷几百条通知
    const { service, notifService } = makeService({
      latitude: -36.8, longitude: 174.7, timestamp: new Date(), source: 'device',
    });
    const { anomalies } = await service.upload('d1', 't1', {
      latitude: -37.9, longitude: 175.9, speed: 0, source: 'device', silent: true,
      timestamp: new Date(Date.now() - 3 * 3600 * 1000),
    });
    expect(anomalies).not.toContain('teleport');
    expect(notifService.create).not.toHaveBeenCalled();
  });

  it('keeps the phone trail for the part of the trip the tracker did not cover', async () => {
    // 定位器中途断电：不能把后面几小时的手机轨迹一起藏掉，否则回放和工时都对不上
    const t0 = Date.now() - 4 * 3600 * 1000;
    const device = Array.from({ length: 8 }, (_, i) => ({ id: `d${i}`, source: 'device', timestamp: new Date(t0 + i * 60_000) }));
    const phoneDuring = Array.from({ length: 5 }, (_, i) => ({ id: `pd${i}`, source: 'app', timestamp: new Date(t0 + i * 60_000 + 20_000) }));
    const phoneAfter = Array.from({ length: 6 }, (_, i) => ({ id: `pa${i}`, source: 'app', timestamp: new Date(t0 + 3600_000 + i * 60_000) }));
    const service = new GpsService(
      { find: jest.fn(async () => [...device, ...phoneDuring, ...phoneAfter]) } as any, {} as any, anomalyStub() as any, {} as any,
    );

    const track = await service.getTrack('t1');
    const ids = track.map((g: any) => g.id);
    // 定位器在跑的那段只保留定位器点
    expect(ids).toEqual(expect.arrayContaining(device.map((d) => d.id)));
    expect(ids).not.toEqual(expect.arrayContaining(phoneDuring.map((p) => p.id)));
    // 它没覆盖的后半程保留手机点
    expect(ids).toEqual(expect.arrayContaining(phoneAfter.map((p) => p.id)));
    // 时间递增，回放不会来回跳
    const times = track.map((g: any) => new Date(g.timestamp).getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it('does NOT hide the phone trail for one or two stray tracker points', async () => {
    // 车牌刚绑错、设备刚上线时会冒出零星设备点，不能因此把整条手机轨迹藏掉
    const rows = [{ id: 1, source: 'app' }, { id: 2, source: 'device' }, { id: 3, source: 'app' }];
    const service = new GpsService({ find: jest.fn(async () => rows) } as any, {} as any, anomalyStub() as any, {} as any);
    await expect(service.getTrack('t1')).resolves.toEqual(rows);
  });

  it('track replay falls back to phone points when there is no tracker', async () => {
    const rows = [{ id: 1, source: 'app' }, { id: 2, source: 'app' }];
    const service = new GpsService({ find: jest.fn(async () => rows) } as any, {} as any, anomalyStub() as any, {} as any);
    await expect(service.getTrack('t1')).resolves.toEqual(rows);
  });
});
