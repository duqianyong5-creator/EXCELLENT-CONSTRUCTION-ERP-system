import { GpsAlarmService } from './gps-alarm.service';
import { AnomalyType } from './gps-anomaly.entity';

const STATIONARY_MIN = 15;

function settingsMock() {
  const map: Record<string, number> = {
    gps_stationary_minutes: STATIONARY_MIN,
    gps_alarm_repeat: 3,
    gps_alarm_delay_minutes: 10,
    gps_stationary_radius_m: 80,
  };
  return { getNumber: jest.fn(async (key: string, fallback: number) => map[key] ?? fallback) };
}

// 在窗口内、坐标几乎不变的两点 → 视为静止
function stationaryLogs() {
  const now = Date.now();
  return [
    { latitude: -36.8, longitude: 174.8, speed: 0, timestamp: new Date(now - STATIONARY_MIN * 60 * 1000) },
    { latitude: -36.8, longitude: 174.8, speed: 0, timestamp: new Date(now) },
  ];
}

// 明显移动的两点 → 非静止
function movingLogs() {
  const now = Date.now();
  return [
    { latitude: -36.8, longitude: 174.8, speed: 30, timestamp: new Date(now - STATIONARY_MIN * 60 * 1000) },
    { latitude: -36.9, longitude: 174.9, speed: 30, timestamp: new Date(now) },
  ];
}

// 历史覆盖不足窗口的 80%（司机刚开始任务）→ 无法判定静止
function sparseLogs() {
  const now = Date.now();
  return [
    { latitude: -36.8, longitude: 174.8, speed: 0, timestamp: new Date(now - 5 * 60 * 1000) },
    { latitude: -36.8, longitude: 174.8, speed: 0, timestamp: new Date(now) },
  ];
}

// 只有一个点 → 无法判定
function singleLog() {
  return [{ latitude: -36.8, longitude: 174.8, speed: 0, timestamp: new Date() }];
}

// 原地停车但 GPS 在小范围漂移（离质心约 66m，含一个假速度读数）→ 仍应判定静止
function parkedWithDriftLogs() {
  const now = Date.now();
  return [
    { latitude: -36.8, longitude: 174.8, speed: 1, timestamp: new Date(now - STATIONARY_MIN * 60 * 1000) },
    { latitude: -36.8 + 0.0009, longitude: 174.8, speed: 3, timestamp: new Date(now - 7 * 60 * 1000) },
    { latitude: -36.8, longitude: 174.8, speed: 1, timestamp: new Date(now) },
  ];
}

// 真正在跑：多点沿路线铺开（每点远离质心）→ 非静止
function movingManyLogs() {
  const now = Date.now();
  return Array.from({ length: 10 }, (_, i) => ({
    latitude: -36.8 + i * 0.002, // 共约 2.2km，远超半径
    longitude: 174.8,
    speed: 25,
    timestamp: new Date(now - (STATIONARY_MIN - i * 1.5) * 60 * 1000),
  }));
}

function build({ logs, openAnomaly }: { logs: any[]; openAnomaly: any }) {
  const qb = {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    getMany: jest.fn(async () => logs),
  };
  const gpsRepo = { createQueryBuilder: jest.fn(() => qb) };
  const anomalyRepo = {
    findOne: jest.fn(async () => openAnomaly),
    create: jest.fn((d) => d),
    save: jest.fn(async (d) => ({ id: 'a-new', ...d })),
    update: jest.fn(async () => ({})),
  };
  const taskRepo = {
    find: jest.fn(async () => [{ id: 't1', driverId: 'd1', title: 'Task 1', driver: { username: 'driver' } }]),
  };
  const notif = { create: jest.fn(async (..._args: any[]) => []) };
  const settings = settingsMock();
  const service = new GpsAlarmService(
    gpsRepo as any, anomalyRepo as any, taskRepo as any, notif as any, settings as any,
  );
  return { service, gpsRepo, qb, anomalyRepo, taskRepo, notif };
}

describe('GpsAlarmService.checkStationary', () => {
  it('fires a first alarm (with sound) when a driver is stationary and no open anomaly exists', async () => {
    const { service, anomalyRepo, notif, qb } = build({ logs: stationaryLogs(), openAnomaly: null });

    await service.checkStationary();

    // 用数据库时钟取窗口（NOW() - INTERVAL），避免本机/云库时钟不一致导致查不到点、永不报警
    expect(qb.andWhere).toHaveBeenCalledWith(
      expect.stringContaining('NOW()'),
      expect.objectContaining({ sec: expect.any(Number) }),
    );
    expect(anomalyRepo.save).toHaveBeenCalledTimes(1);
    const created = anomalyRepo.create.mock.calls[0][0];
    expect(created.anomalyType).toBe(AnomalyType.STATIONARY);
    expect(created.alarmCount).toBe(1);
    expect(notif.create).toHaveBeenCalledTimes(1);
    const payload = notif.create.mock.calls[0][1];
    expect(payload.type).toBe('gps_stationary');
    expect(payload.meta.sound).toBe(true);
    expect(payload.notifyAdmins).toBe(true);
  });

  it('auto-resolves an open alarm once the driver starts moving again', async () => {
    const open = { id: 'a1', alarmCount: 1, snoozeUntil: null };
    const { service, anomalyRepo, notif } = build({ logs: movingLogs(), openAnomaly: open });

    await service.checkStationary();

    expect(anomalyRepo.update).toHaveBeenCalledWith('a1', expect.objectContaining({ resolved: true }));
    expect(notif.create).not.toHaveBeenCalled();
  });

  it('does not re-alarm while the anomaly is still in its snooze window', async () => {
    const open = { id: 'a1', alarmCount: 1, snoozeUntil: new Date(Date.now() + 5 * 60 * 1000) };
    const { service, anomalyRepo, notif } = build({ logs: stationaryLogs(), openAnomaly: open });

    await service.checkStationary();

    expect(notif.create).not.toHaveBeenCalled();
    expect(anomalyRepo.update).not.toHaveBeenCalled();
  });

  it('escalates to the next alarm once the snooze window has passed', async () => {
    const open = { id: 'a1', alarmCount: 1, snoozeUntil: new Date(Date.now() - 60 * 1000) };
    const { service, anomalyRepo, notif } = build({ logs: stationaryLogs(), openAnomaly: open });

    await service.checkStationary();

    expect(anomalyRepo.update).toHaveBeenCalledWith('a1', expect.objectContaining({ alarmCount: 2 }));
    expect(notif.create).toHaveBeenCalledTimes(1);
  });

  it('stops escalating after the configured maximum alarm count', async () => {
    const open = { id: 'a1', alarmCount: 3, snoozeUntil: new Date(Date.now() - 60 * 1000) };
    const { service, anomalyRepo, notif } = build({ logs: stationaryLogs(), openAnomaly: open });

    await service.checkStationary();

    expect(notif.create).not.toHaveBeenCalled();
    expect(anomalyRepo.update).not.toHaveBeenCalled();
  });
});

describe('GpsAlarmService.checkStationary — false-alarm guards', () => {
  it('does not alarm when GPS history covers less than 80% of the window', async () => {
    const { service, anomalyRepo, notif } = build({ logs: sparseLogs(), openAnomaly: null });
    await service.checkStationary();
    expect(notif.create).not.toHaveBeenCalled();
    expect(anomalyRepo.save).not.toHaveBeenCalled();
  });

  it('does not alarm with fewer than two GPS points', async () => {
    const { service, anomalyRepo, notif } = build({ logs: singleLog(), openAnomaly: null });
    await service.checkStationary();
    expect(notif.create).not.toHaveBeenCalled();
    expect(anomalyRepo.save).not.toHaveBeenCalled();
  });

  it('still alarms when the driver is parked but GPS drifts within the radius (drift tolerated)', async () => {
    const { service, anomalyRepo, notif } = build({ logs: parkedWithDriftLogs(), openAnomaly: null });
    await service.checkStationary();
    expect(anomalyRepo.save).toHaveBeenCalledTimes(1);
    expect(notif.create).toHaveBeenCalledTimes(1);
  });

  it('does not alarm when the driver is genuinely moving along a route', async () => {
    const { service, anomalyRepo, notif } = build({ logs: movingManyLogs(), openAnomaly: null });
    await service.checkStationary();
    expect(notif.create).not.toHaveBeenCalled();
    expect(anomalyRepo.save).not.toHaveBeenCalled();
  });

  it('swallows repository errors so the cron tick never crashes', async () => {
    const settings = { getNumber: jest.fn(async (_k: string, f: number) => f) };
    const taskRepo = { find: jest.fn(async () => { throw new Error('db down'); }) };
    const notif = { create: jest.fn() };
    const service = new GpsAlarmService(
      {} as any, {} as any, taskRepo as any, notif as any, settings as any,
    );
    await expect(service.checkStationary()).resolves.toBeUndefined();
    expect(notif.create).not.toHaveBeenCalled();
  });
});
