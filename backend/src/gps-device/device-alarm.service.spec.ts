import { Logger } from '@nestjs/common';
import { DeviceAlarmService } from './device-alarm.service';
import { AnomalyType } from '../gps/gps-anomaly.entity';
import { isInsideGeofence, GEOFENCE_HYSTERESIS_M } from './geofence.service';
import type { AlarmKind, Position } from './jt808.codec';

const DEVICE = { id: 'dev1', deviceNo: '51160004464', vehiclePlate: 'ABC123', name: 'Truck 1' } as any;
const TARGET = { taskId: 't1', driverId: 'd1' };

// 奥克兰某个场地
const YARD = { lat: -36.8485, lng: 174.7633 };

function pos(over: Partial<Position> = {}): Position {
  return {
    alarm: 0,
    alarms: [],
    status: 2,
    acc: true,
    fixed: true,
    moving: true,
    latitude: YARD.lat,
    longitude: YARD.lng,
    altitude: 10,
    speedKmh: 0,
    heading: 0,
    time: new Date(),
    extras: { raw: new Map() },
    ...over,
  };
}

/** 按 alarms 生成一条定位 */
const withAlarms = (...alarms: AlarmKind[]) => pos({ alarms });

function build(opts: { fences?: any[]; anomalies?: any[] } = {}) {
  const rows: any[] = opts.anomalies ? [...opts.anomalies] : [];
  let seq = 0;
  const anomalyRepo = {
    rows,
    findOne: jest.fn(async ({ where }: any) =>
      rows.find(
        (r) => r.deviceNo === where.deviceNo && r.anomalyType === where.anomalyType
          && (where.resolved === undefined || r.resolved === where.resolved)
          // MoreThanOrEqual(date)：FindOperator 的值在 .value 上
          && (where.detectedAt === undefined || (r.detectedAt && r.detectedAt >= where.detectedAt.value)),
      ) ?? null),
    create: jest.fn((v: any) => ({ ...v, resolved: false })),
    // detected_at 是 CreateDateColumn，由数据库在插入时填
    save: jest.fn(async (v: any) => { const row = { id: `a${++seq}`, detectedAt: new Date(), ...v }; rows.push(row); return row; }),
    update: jest.fn(async (idOrWhere: any, patch: any) => {
      const hit = typeof idOrWhere === 'string'
        ? rows.filter((r) => r.id === idOrWhere)
        : rows.filter((r) => Object.entries(idOrWhere).every(([k, v]) => r[k] === v));
      hit.forEach((row) => Object.assign(row, patch));
      return { affected: hit.length };
    }),
  };
  const geofences = { fencesFor: jest.fn(async () => opts.fences ?? []) };
  const notifService = { create: jest.fn(async (_userId: any, _data: any) => undefined) };
  const service = new DeviceAlarmService(anomalyRepo as any, geofences as any, notifService as any);
  return { service, anomalyRepo, geofences, notifService };
}

const live = { hasFix: true, target: TARGET, pointTime: new Date() };

beforeAll(() => { Logger.overrideLogger(false); });

describe('DeviceAlarmService: alarms with no GPS fix', () => {
  // 断电 / 防拆恰恰最常在没定位的时候发生：刚断电、在室内、被屏蔽。
  // 以前 Number.isFinite(0) 为真，这条最要紧的防盗记录会被记成 0,0 —— 钉在几内亚湾。
  it('records a power cut with no coordinates rather than 0,0', async () => {
    const { service, anomalyRepo, notifService } = build();
    const noFix = { hasFix: false, target: null, pointTime: new Date() };
    await service.handle(DEVICE, pos({ alarms: ['power_cut'], latitude: 0, longitude: 0, fixed: false }), noFix);

    expect(anomalyRepo.rows).toHaveLength(1);
    const row = anomalyRepo.rows[0];
    expect(row.anomalyType).toBe(AnomalyType.POWER_CUT);
    expect(row.latitude).toBeNull();
    expect(row.longitude).toBeNull();
    // 没司机没任务也要能认出是哪台车
    expect(row.driverId).toBeNull();
    expect(row.vehiclePlate).toBe('ABC123');
    expect(notifService.create).toHaveBeenCalledTimes(1);
  });

  it('refuses an out-of-range coordinate instead of losing the whole record', async () => {
    // 原始值最大 4294.97，直接写 numeric(10,7) 会溢出、整条插入失败
    const { service, anomalyRepo } = build();
    await service.handle(DEVICE, pos({ alarms: ['shock'], latitude: 4294.96, longitude: 4294.96 }), live);
    expect(anomalyRepo.rows).toHaveLength(1);
    expect(anomalyRepo.rows[0].latitude).toBeNull();
    expect(anomalyRepo.rows[0].longitude).toBeNull();
  });

  it('keeps real coordinates when there is a fix', async () => {
    const { service, anomalyRepo } = build();
    await service.handle(DEVICE, withAlarms('shock'), live);
    expect(anomalyRepo.rows[0].latitude).toBe(YARD.lat);
    expect(anomalyRepo.rows[0].longitude).toBe(YARD.lng);
  });
});

describe('DeviceAlarmService: unhandled alarm bits', () => {
  // 报警位在条件解除前一直保持。每帧都记 warn，实时模式下就是 6 行/分钟/台——
  // §7 说过，不限流的日志会把内存顶爆、连带拖垮同进程的 HTTP API。
  it('logs a stuck unhandled alarm once, not on every position', async () => {
    const { service } = build();
    const warn = jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);
    for (let i = 0; i < 12; i++) {
      await service.handle(DEVICE, withAlarms('low_battery' as AlarmKind), live);
    }
    const lines = warn.mock.calls.filter((c) => String(c[0]).includes('unhandled'));
    expect(lines).toHaveLength(1);
    warn.mockRestore();
  });

  it('logs again when the set of unhandled alarms changes', async () => {
    const { service } = build();
    const warn = jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);
    await service.handle(DEVICE, withAlarms('low_battery' as AlarmKind), live);
    await service.handle(DEVICE, withAlarms('low_battery' as AlarmKind, 'sos' as AlarmKind), live);
    const lines = warn.mock.calls.filter((c) => String(c[0]).includes('unhandled'));
    expect(lines).toHaveLength(2);
    warn.mockRestore();
  });
});

describe('DeviceAlarmService: 震动 / 断电', () => {
  it('raises 震动 once: one anomaly row and one notification', async () => {
    const { service, anomalyRepo, notifService } = build();
    await service.handle(DEVICE, withAlarms('shock'), live);
    expect(anomalyRepo.rows).toHaveLength(1);
    expect(anomalyRepo.rows[0]).toMatchObject({
      anomalyType: AnomalyType.SHOCK,
      deviceNo: '51160004464',
      vehiclePlate: 'ABC123',
      driverId: 'd1',
      taskId: 't1',
      resolved: false,
    });
    expect(notifService.create).toHaveBeenCalledTimes(1);
    expect(notifService.create.mock.calls[0][1]).toMatchObject({ type: 'gps_shock', notifyAdmins: true });
  });

  it('DE-DUPLICATES a flag the tracker repeats on every position', async () => {
    // 这是本次要修的核心问题：实时模式 10 秒一个点，一分钟就是 6 条通知。
    const { service, anomalyRepo, notifService } = build();
    for (let i = 0; i < 12; i++) await service.handle(DEVICE, withAlarms('power_cut'), live);
    expect(anomalyRepo.rows).toHaveLength(1);
    expect(notifService.create).toHaveBeenCalledTimes(1);
  });

  it('auto-resolves the open anomaly once the flag clears', async () => {
    const { service, anomalyRepo } = build();
    await service.handle(DEVICE, withAlarms('power_cut'), live);
    await service.handle(DEVICE, withAlarms(), live);
    expect(anomalyRepo.rows[0]).toMatchObject({ resolved: true });
    expect(anomalyRepo.rows[0].resolvedAt).toBeInstanceOf(Date);
  });

  it('alarms again after it cleared (a second break-in is a new alarm)', async () => {
    const { service, anomalyRepo, notifService } = build();
    await service.handle(DEVICE, withAlarms('shock'), live);
    await service.handle(DEVICE, withAlarms(), live);
    await service.handle(DEVICE, withAlarms('shock'), live);
    expect(anomalyRepo.rows).toHaveLength(2);
    expect(notifService.create).toHaveBeenCalledTimes(2);
  });

  it('does not re-notify after a restart when the anomaly is still open in the database', async () => {
    // 进程重启后内存状态是空的；数据库才是去重的准绳，否则每次部署都会把所有在报的警重发一遍
    const { service, anomalyRepo, notifService } = build({
      anomalies: [{ id: 'old', deviceNo: '51160004464', anomalyType: AnomalyType.POWER_CUT, resolved: false }],
    });
    await service.handle(DEVICE, withAlarms('power_cut'), live);
    expect(anomalyRepo.rows).toHaveLength(1);
    expect(notifService.create).not.toHaveBeenCalled();
  });

  it('keeps 震动 and 断电 as independent alarms', async () => {
    const { service, anomalyRepo, notifService } = build();
    await service.handle(DEVICE, withAlarms('shock', 'power_cut'), live);
    expect(anomalyRepo.rows.map((r) => r.anomalyType).sort())
      .toEqual([AnomalyType.POWER_CUT, AnomalyType.SHOCK].sort());
    expect(notifService.create).toHaveBeenCalledTimes(2);
    // 震动解除但断电还在：只结案震动那条
    await service.handle(DEVICE, withAlarms('power_cut'), live);
    const shock = anomalyRepo.rows.find((r) => r.anomalyType === AnomalyType.SHOCK);
    const cut = anomalyRepo.rows.find((r) => r.anomalyType === AnomalyType.POWER_CUT);
    expect(shock.resolved).toBe(true);
    expect(cut.resolved).toBe(false);
  });

  it('records a vehicle alarm even with no in-progress task (the 3am break-in case)', async () => {
    const { service, anomalyRepo, notifService } = build();
    await service.handle(DEVICE, withAlarms('power_cut'), { hasFix: true, target: null, pointTime: new Date() });
    expect(anomalyRepo.rows[0]).toMatchObject({
      driverId: null, taskId: null, deviceNo: '51160004464', vehiclePlate: 'ABC123',
    });
    expect(notifService.create).toHaveBeenCalledTimes(1);
  });

  it('does not record alarm kinds the owner did not ask for (but still notices them)', async () => {
    const { service, anomalyRepo, notifService } = build();
    await service.handle(DEVICE, withAlarms('sos', 'overspeed', 'low_battery'), live);
    expect(anomalyRepo.rows).toHaveLength(0);
    expect(notifService.create).not.toHaveBeenCalled();
  });

  it('forget() drops in-memory state so the next alarm is treated as new', async () => {
    const { service, notifService } = build();
    await service.handle(DEVICE, withAlarms('shock'), live);
    service.forget(DEVICE.deviceNo);
    // 内存清了，但数据库里那条还开着 —— 仍然不该重复通知
    await service.handle(DEVICE, withAlarms('shock'), live);
    expect(notifService.create).toHaveBeenCalledTimes(1);
  });
});

describe('DeviceAlarmService never throws out of the ingest path', () => {
  // 网关和 HTTP API 共用一个进程：这里抛出去 = 整个后端挂掉
  it('swallows a database failure', async () => {
    const { service, anomalyRepo } = build();
    anomalyRepo.findOne.mockRejectedValue(new Error('connection terminated'));
    await expect(service.handle(DEVICE, withAlarms('shock'), live)).resolves.toBeUndefined();
  });

  it('swallows a notification failure', async () => {
    const { service, notifService } = build();
    notifService.create.mockRejectedValue(new Error('websocket gone'));
    await expect(service.handle(DEVICE, withAlarms('power_cut'), live)).resolves.toBeUndefined();
  });

  it('swallows a geofence lookup failure', async () => {
    const { service, geofences } = build();
    geofences.fencesFor.mockRejectedValue(new Error('no such table'));
    await expect(service.handle(DEVICE, pos(), live)).resolves.toBeUndefined();
  });

  it('survives a position with a rubbish alarms field', async () => {
    const { service } = build();
    await expect(service.handle(DEVICE, pos({ alarms: undefined as any }), live)).resolves.toBeUndefined();
  });
});

describe('isInsideGeofence (纯函数)', () => {
  const fence = { centerLat: YARD.lat, centerLng: YARD.lng, radiusM: 200 };

  it('uses the plain radius when the vehicle was outside', () => {
    expect(isInsideGeofence(fence, YARD.lat, YARD.lng, false)).toBe(true);
    expect(isInsideGeofence(fence, YARD.lat + 0.01, YARD.lng, false)).toBe(false); // ~1.1km
  });

  it('applies hysteresis on the way out so GPS drift cannot flap the alarm', () => {
    // 半径外 ~30 米：已经在圈内时不算离开，在圈外时也还没进入
    const justOut = YARD.lat - (230 / 111_320);
    expect(isInsideGeofence(fence, justOut, YARD.lng, true)).toBe(true);
    expect(isInsideGeofence(fence, justOut, YARD.lng, false)).toBe(false);
    expect(GEOFENCE_HYSTERESIS_M).toBeGreaterThan(0);
  });

  it('leaves for real once past radius + hysteresis', () => {
    const wellOut = YARD.lat - (400 / 111_320);
    expect(isInsideGeofence(fence, wellOut, YARD.lng, true)).toBe(false);
  });

  it('keeps the previous state for an unusable fence instead of firing', () => {
    const broken = { centerLat: NaN, centerLng: NaN, radiusM: 200 };
    expect(isInsideGeofence(broken as any, YARD.lat, YARD.lng, true)).toBe(true);
    expect(isInsideGeofence(broken as any, YARD.lat, YARD.lng, false)).toBe(false);
  });
});

describe('DeviceAlarmService: 电子围栏', () => {
  const fence = (over: any = {}) => ({
    id: 'f1', name: '公司场地', centerLat: YARD.lat, centerLng: YARD.lng, radiusM: 200,
    vehiclePlate: null, enabled: true, alertOnEnter: true, alertOnLeave: true, ...over,
  });
  const away = () => pos({ latitude: YARD.lat + 0.02, longitude: YARD.lng });

  it('records the first fix without alarming (restarts must not fire "entered" for parked trucks)', async () => {
    const { service, anomalyRepo, notifService } = build({ fences: [fence()] });
    await service.handle(DEVICE, pos(), live);
    expect(anomalyRepo.rows).toHaveLength(0);
    expect(notifService.create).not.toHaveBeenCalled();
  });

  it('raises 驶入 on the outside -> inside transition', async () => {
    const { service, anomalyRepo, notifService } = build({ fences: [fence()] });
    await service.handle(DEVICE, away(), live);
    await service.handle(DEVICE, pos(), live);
    expect(anomalyRepo.rows).toHaveLength(1);
    expect(anomalyRepo.rows[0]).toMatchObject({
      anomalyType: AnomalyType.GEOFENCE_ENTER, geofenceId: 'f1', deviceNo: '51160004464',
    });
    expect(notifService.create).toHaveBeenCalledTimes(1);
    expect(notifService.create.mock.calls[0][1].content).toContain('公司场地');
  });

  it('raises 驶离 on the inside -> outside transition', async () => {
    const { service, anomalyRepo } = build({ fences: [fence()] });
    await service.handle(DEVICE, pos(), live);
    await service.handle(DEVICE, away(), live);
    expect(anomalyRepo.rows).toHaveLength(1);
    expect(anomalyRepo.rows[0].anomalyType).toBe(AnomalyType.GEOFENCE_LEAVE);
  });

  it('does not repeat while the vehicle stays inside', async () => {
    const { service, notifService } = build({ fences: [fence()] });
    await service.handle(DEVICE, away(), live);
    for (let i = 0; i < 10; i++) await service.handle(DEVICE, pos(), live);
    expect(notifService.create).toHaveBeenCalledTimes(1);
  });

  it('honours alertOnEnter / alertOnLeave', async () => {
    const noEnter = build({ fences: [fence({ alertOnEnter: false })] });
    await noEnter.service.handle(DEVICE, away(), live);
    await noEnter.service.handle(DEVICE, pos(), live);
    expect(noEnter.anomalyRepo.rows).toHaveLength(0);

    const noLeave = build({ fences: [fence({ alertOnLeave: false })] });
    await noLeave.service.handle(DEVICE, pos(), live);
    await noLeave.service.handle(DEVICE, away(), live);
    expect(noLeave.anomalyRepo.rows).toHaveLength(0);
  });

  it('does not de-duplicate across different fences (entering A must not hide entering B)', async () => {
    const { service, anomalyRepo } = build({
      fences: [fence(), fence({ id: 'f2', name: '客户工地', radiusM: 5000 })],
    });
    const farAway = pos({ latitude: YARD.lat + 0.5 }); // ~55km，两个围栏都在外面
    await service.handle(DEVICE, farAway, live); // 建立初始状态
    await service.handle(DEVICE, pos(), live); // 同时进入 f1 与 f2
    const ids = anomalyRepo.rows
      .filter((r) => r.anomalyType === AnomalyType.GEOFENCE_ENTER)
      .map((r) => r.geofenceId)
      .sort();
    expect(ids).toEqual(['f1', 'f2']);
  });

  it('holds a crossing back rather than losing it when two events land within the guard window', async () => {
    // 最小间隔是用来压抖动的，但它不能把真穿越吃掉：
    // 被压住的那一帧不翻状态，所以间隔过去后还会补报出来。
    jest.useFakeTimers().setSystemTime(new Date('2026-09-23T00:00:00Z'));
    try {
      const { service, anomalyRepo } = build({ fences: [fence()] });
      await service.handle(DEVICE, away(), live);
      await service.handle(DEVICE, pos(), live); // 驶入 -> 报警
      await service.handle(DEVICE, away(), live); // 立刻驶离 -> 被最小间隔压住
      expect(anomalyRepo.rows.map((r) => r.anomalyType)).toEqual([AnomalyType.GEOFENCE_ENTER]);

      jest.advanceTimersByTime(61_000);
      await service.handle(DEVICE, away(), live); // 间隔过去了，补报驶离
      expect(anomalyRepo.rows.map((r) => r.anomalyType))
        .toEqual([AnomalyType.GEOFENCE_ENTER, AnomalyType.GEOFENCE_LEAVE]);
    } finally {
      jest.useRealTimers();
    }
  });

  it('damps boundary flapping: drifting back inside the guard window reports nothing extra', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-23T00:00:00Z'));
    try {
      const { service, anomalyRepo, notifService } = build({ fences: [fence()] });
      await service.handle(DEVICE, away(), live);
      await service.handle(DEVICE, pos(), live); // 驶入
      for (let i = 0; i < 6; i++) {
        await service.handle(DEVICE, away(), live);
        await service.handle(DEVICE, pos(), live);
      }
      expect(anomalyRepo.rows).toHaveLength(1);
      expect(notifService.create).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('skips geofencing when the position has no fix (0,0 would "leave" every fence)', async () => {
    const { service, anomalyRepo, geofences } = build({ fences: [fence()] });
    await service.handle(DEVICE, pos(), live);
    await service.handle(DEVICE, pos({ latitude: 0, longitude: 0 }), { ...live, hasFix: false });
    expect(geofences.fencesFor).toHaveBeenCalledTimes(1);
    expect(anomalyRepo.rows).toHaveLength(0);
  });

  it('does not touch the database when no geofence applies to the vehicle', async () => {
    const { service, anomalyRepo } = build({ fences: [] });
    await service.handle(DEVICE, pos(), live);
    await service.handle(DEVICE, away(), live);
    expect(anomalyRepo.rows).toHaveLength(0);
  });
});

describe('DeviceAlarmService: 断电也认 0xE4 的外电状态', () => {
  // 报警位 bit8 是「防拆报警」，受防拆开关控制；0xE4 每条定位都带「外电断开、电池供电」这一状态
  const onBattery = (battery = 96) => pos({ extras: { raw: new Map(), externalPower: false, batteryPercent: battery } });
  const onMains = () => pos({ extras: { raw: new Map(), externalPower: true, batteryPercent: 100 } });

  it('raises a power cut when 0xE4 says external power is off, even with no alarm bit', async () => {
    const { service, anomalyRepo, notifService } = build();
    await service.handle(DEVICE, onBattery(), live);
    expect(anomalyRepo.rows).toHaveLength(1);
    expect(anomalyRepo.rows[0].anomalyType).toBe(AnomalyType.POWER_CUT);
    expect(anomalyRepo.rows[0].description).toContain('备用电池供电（剩余 96%）');
    expect(notifService.create).toHaveBeenCalledTimes(1);
  });

  it('counts bit8 and 0xE4 as ONE power cut, not two', async () => {
    const { service, anomalyRepo, notifService } = build();
    await service.handle(DEVICE, pos({ alarms: ['power_cut'], extras: { raw: new Map(), externalPower: false } }), live);
    await service.handle(DEVICE, onBattery(90), live);
    expect(anomalyRepo.rows).toHaveLength(1);
    expect(notifService.create).toHaveBeenCalledTimes(1);
  });

  it('clears when mains power comes back', async () => {
    const { service, anomalyRepo } = build();
    await service.handle(DEVICE, onBattery(), live);
    await service.handle(DEVICE, onMains(), live);
    expect(anomalyRepo.rows[0].resolved).toBe(true);
  });

  it('does not treat an unknown power state as a power cut', async () => {
    const { service, anomalyRepo } = build();
    await service.handle(DEVICE, pos({ extras: { raw: new Map() } }), live);
    expect(anomalyRepo.rows).toHaveLength(0);
  });

  it('sends null coordinates in the notification when there is no fix (not 0,0)', async () => {
    const { service, notifService } = build();
    await service.handle(DEVICE, pos({ latitude: 0, longitude: 0, fixed: false, extras: { raw: new Map(), externalPower: false } }),
      { hasFix: false, target: null, pointTime: new Date() });
    const meta = notifService.create.mock.calls[0][1].meta;
    expect(meta.latitude).toBeNull();
    expect(meta.longitude).toBeNull();
  });
});

describe('DeviceAlarmService: 状态变化日志', () => {
  it('logs power / alarm-word / E7 once per change, not per position', async () => {
    const { service } = build();
    const log = jest.spyOn((service as any).logger, 'log');
    const mains = pos({ extras: { raw: new Map(), externalPower: true, batteryPercent: 100 } });
    for (let i = 0; i < 5; i++) await service.handle(DEVICE, mains, live);
    await service.handle(DEVICE, pos({ extras: { raw: new Map(), externalPower: false, batteryPercent: 99 } }), live);
    const lines = log.mock.calls.map(([m]) => String(m)).filter((m) => m.includes('external power'));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/device 51160004464 status: external power on, battery 100%, alarm word 0x00000000/);
    expect(lines[1]).toMatch(/status changed: external power OFF \(on battery\), battery 99%/);
  });
});

describe('DeviceAlarmService: 掉线报警', () => {
  const LAST_SEEN = new Date(Date.now() - 3 * 60 * 1000);
  const parked = { lastSeenAt: LAST_SEEN, moving: false, target: null };
  const withFix = { ...DEVICE, lastLatitude: '-36.8028800', lastLongitude: '174.5936320', lastSpeed: '0.00' };

  it('raises one alarm with the last known position and a sound notification', async () => {
    const { service, anomalyRepo, notifService } = build();
    await service.raiseOffline(withFix, parked);
    expect(anomalyRepo.rows).toHaveLength(1);
    const row = anomalyRepo.rows[0];
    expect(row).toMatchObject({ anomalyType: AnomalyType.DEVICE_OFFLINE, deviceNo: '51160004464', vehiclePlate: 'ABC123' });
    // 数据库里的 numeric 是字符串，要转成数再存
    expect(row.latitude).toBeCloseTo(-36.80288, 5);
    expect(row.longitude).toBeCloseTo(174.593632, 5);
    expect(row.description).toContain('已 3 分钟没有任何数据');
    expect(row.description).toContain('当时停着');
    expect(notifService.create.mock.calls[0][1]).toMatchObject({ type: 'gps_device_offline', meta: { sound: true } });
  });

  it('reports each disappearance once, even after an admin closed it while the tracker is still gone', async () => {
    const { service, anomalyRepo, notifService } = build();
    await service.raiseOffline(withFix, parked);
    anomalyRepo.rows[0].resolved = true; // 管理员手动结案
    await service.raiseOffline(withFix, parked);
    await service.raiseOffline(withFix, parked);
    expect(anomalyRepo.rows).toHaveLength(1);
    expect(notifService.create).toHaveBeenCalledTimes(1);
  });

  it('reports again for a NEW disappearance (tracker came back, then vanished again)', async () => {
    const { service, anomalyRepo } = build();
    await service.raiseOffline(withFix, parked);
    anomalyRepo.rows[0].detectedAt = new Date(Date.now() - 60 * 60 * 1000); // 上一次是一小时前报的
    await service.raiseOffline(withFix, { ...parked, lastSeenAt: new Date(Date.now() - 2 * 60 * 1000) });
    // 旧的那条还开着 → 靠未结案去重，不重复；结掉以后再消失才是新的一次
    expect(anomalyRepo.rows).toHaveLength(1);
    anomalyRepo.rows[0].resolved = true;
    await service.raiseOffline(withFix, { ...parked, lastSeenAt: new Date(Date.now() - 2 * 60 * 1000) });
    expect(anomalyRepo.rows).toHaveLength(2);
  });

  it('records no coordinates when the tracker never had a fix', async () => {
    const { service, anomalyRepo } = build();
    await service.raiseOffline({ ...DEVICE, lastLatitude: null, lastLongitude: null }, parked);
    expect(anomalyRepo.rows[0].latitude).toBeNull();
  });

  it('deviceBackOnline closes only this device\'s open offline alarm', async () => {
    const { service, anomalyRepo } = build({
      anomalies: [
        { id: 'x1', deviceNo: '51160004464', anomalyType: AnomalyType.DEVICE_OFFLINE, resolved: false },
        { id: 'x2', deviceNo: '51160004464', anomalyType: AnomalyType.POWER_CUT, resolved: false },
        { id: 'x3', deviceNo: '99999999999', anomalyType: AnomalyType.DEVICE_OFFLINE, resolved: false },
      ],
    });
    await service.deviceBackOnline('51160004464');
    expect(anomalyRepo.rows.map((r: any) => [r.id, r.resolved])).toEqual([['x1', true], ['x2', false], ['x3', false]]);
    expect(anomalyRepo.rows[0].resolvedAt).toBeInstanceOf(Date);
  });

  it('never throws (runs on the timer and on the TCP gateway)', async () => {
    const { service, anomalyRepo } = build();
    anomalyRepo.findOne.mockRejectedValue(new Error('db down'));
    anomalyRepo.update.mockRejectedValue(new Error('db down'));
    await expect(service.raiseOffline(withFix, parked)).resolves.toBeUndefined();
    await expect(service.deviceBackOnline('51160004464')).resolves.toBeUndefined();
  });
});
