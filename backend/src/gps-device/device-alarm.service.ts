import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThanOrEqual, Repository } from 'typeorm';
import { GpsAnomaly, AnomalyType } from '../gps/gps-anomaly.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { GeofenceService, isInsideGeofence } from './geofence.service';
import { Geofence } from './geofence.entity';
import type { GpsDevice } from './gps-device.entity';
import type { AlarmKind, Position } from './jt808.codec';

/** 定位器报警 -> 异常类型。只有 owner 点名要的两类会落库报警。 */
const ALARM_TO_ANOMALY: Partial<Record<AlarmKind, AnomalyType>> = {
  shock: AnomalyType.SHOCK,
  power_cut: AnomalyType.POWER_CUT,
};

/** 中文说明，落在异常记录和通知里 */
const ALARM_LABEL: Record<string, string> = {
  [AnomalyType.SHOCK]: '震动报警',
  [AnomalyType.POWER_CUT]: '断电报警（主电源掉电 / 防拆）',
  [AnomalyType.GEOFENCE_ENTER]: '驶入电子围栏',
  [AnomalyType.GEOFENCE_LEAVE]: '驶离电子围栏',
  [AnomalyType.DEVICE_OFFLINE]: '定位器掉线（接车电时突然断开）',
};

/** 设备侧持续型报警：置位后一直保持，撤销时自动结案 */
const LEVEL_ALARMS: AnomalyType[] = [AnomalyType.SHOCK, AnomalyType.POWER_CUT];

/**
 * 同一台车同一个围栏，两次进出事件之间的最小间隔。
 * 迟滞已经挡掉了原地漂移，这一条是兜底：真沿着边界开的车（比如绕场一周）也不该每个点报一次。
 */
const GEOFENCE_MIN_EVENT_MS = 60_000;

/** 内存状态上限。设备号虽然来自已登记设备、数量有限，但不设上限就是一个慢性泄漏。 */
const MAX_TRACKED_DEVICES = 1000;

export interface AlarmTarget {
  taskId: string;
  driverId: string;
}

/** 报警记录上的位置。没有可信位置时整个传 null，不要拼一个 0,0 */
interface AlarmPoint {
  latitude: number;
  longitude: number;
  speed: number | null;
}

function fixPoint(pos: Position, hasFix: boolean): AlarmPoint | null {
  return hasFix ? { latitude: pos.latitude, longitude: pos.longitude, speed: pos.speedKmh } : null;
}

function numberOrNull(v: unknown): number | null {
  const n = Number(v);
  return v == null || v === '' || !Number.isFinite(n) ? null : n;
}

/** 报警文字里的时间按新西兰本地时间写：看报警的是这边的调度 */
function nzTime(d: Date): string {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Pacific/Auckland', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(d);
}

/**
 * 车载定位器报警：震动 / 断电 / 电子围栏。
 *
 * 去重是这个服务存在的主要理由。终端把「还在报警」这件事写在每一条定位里，
 * 实时模式 10 秒一个点 = 一分钟 6 条通知；所以这里按**状态变化**触发，
 * 而不是按报文触发：一台设备一类报警在结案之前只有一条未处理记录、只通知一次。
 *
 * 记录与通知的写法沿用 gps.service.ts / gps-alarm.service.ts 那一套（gps_anomalies + notifyAdmins），
 * 没有另起一套机制。
 */
/** 有限且在范围内才保留，否则记 null——宁可没有坐标，也不要错的坐标 */
function inRange(v: number, max: number): number | null {
  return Number.isFinite(v) && Math.abs(v) <= max ? v : null;
}

@Injectable()
export class DeviceAlarmService {
  private readonly logger = new Logger('DeviceAlarm');

  /** deviceNo -> 上一次见到的持续型报警集合（边沿触发） */
  private active = new Map<string, Set<AnomalyType>>();
  /** deviceNo -> (fenceId -> 上一次在不在圈内)。undefined = 还没见过，第一帧只记录不报警 */
  private inside = new Map<string, Map<string, boolean>>();
  /** `deviceNo|fenceId` -> 上次进出事件时间 */
  private lastFenceEventAt = new Map<string, number>();
  /** 每台设备上次记录过的「未处理报警位」集合，用来只在变化时记日志 */
  private lastUnhandled = new Map<string, string>();
  /** 每台设备上次记录过的电源 / 报警字 / 0xE7 状态，只在变化时记日志 */
  private lastStatus = new Map<string, string>();

  constructor(
    @InjectRepository(GpsAnomaly) private anomalyRepo: Repository<GpsAnomaly>,
    private geofences: GeofenceService,
    private notifService: NotificationsService,
  ) {}

  /** 设备下线/删除时清掉内存状态，避免下次上线拿着过期的「已在报警」把首次报警吞掉 */
  forget(deviceNo: string): void {
    this.active.delete(deviceNo);
    this.inside.delete(deviceNo);
    this.lastStatus.delete(deviceNo);
    for (const key of [...this.lastFenceEventAt.keys()]) {
      if (key.startsWith(`${deviceNo}|`)) this.lastFenceEventAt.delete(key);
    }
  }

  /**
   * 处理一条定位带来的报警。
   *
   * **这个方法绝不抛错**：它跑在 TCP 网关线程上，和 HTTP API 共用一个进程，
   * 一次未捕获的 throw 会把整个后端带走。报警写不进去是可以忍的，API 挂掉不行。
   */
  async handle(
    device: GpsDevice,
    pos: Position,
    opts: { hasFix: boolean; target: AlarmTarget | null; pointTime: Date },
  ): Promise<void> {
    try {
      await this.evaluate(device, pos, opts);
    } catch (e: any) {
      this.logger.warn(`alarm handling failed for ${device.deviceNo}: ${e?.message || e}`);
    }
  }

  private async evaluate(
    device: GpsDevice,
    pos: Position,
    opts: { hasFix: boolean; target: AlarmTarget | null; pointTime: Date },
  ): Promise<void> {
    const kinds: AlarmKind[] = Array.isArray(pos.alarms) ? pos.alarms : [];
    this.logStatusChange(device, pos);
    this.logUnhandled(device, kinds);
    await this.syncLevelAlarms(device, kinds, pos, opts);
    if (opts.hasFix) await this.checkGeofences(device, pos, opts);
  }

  /**
   * 设备的电源、报警字、0xE7 状态一变就记一行。
   * 2026-09-28 拔电测试没有报警时，日志里只有「连上 / 断开」，设备在断开前到底报没报断电、
   * 外电状态有没有变，一概看不出来——只能猜。这几个值只在状态变化时才变，不会刷屏。
   */
  private logStatusChange(device: GpsDevice, pos: Position): void {
    const ex = pos.extras ?? ({} as Position['extras']);
    const power = ex.externalPower === true ? 'on' : ex.externalPower === false ? 'OFF (on battery)' : 'unknown';
    const alarmWord = `0x${((pos.alarm ?? 0) >>> 0).toString(16).padStart(8, '0')}`;
    const e7 = ex.alarmExt ? ex.alarmExt.toString('hex') : '-';
    const signature = `${power}|${alarmWord}|${e7}`;
    const previous = this.lastStatus.get(device.deviceNo);
    if (previous === signature) return;
    if (this.lastStatus.size >= MAX_TRACKED_DEVICES && previous === undefined) this.lastStatus.clear();
    this.lastStatus.set(device.deviceNo, signature);
    const state = ex.alarmExtState ? ` (armed=${ex.alarmExtState.armed}, sleeping=${ex.alarmExtState.sleeping})` : '';
    this.logger.log(
      `device ${device.deviceNo} ${previous === undefined ? 'status' : 'status changed'}: external power ${power}, `
        + `battery ${ex.batteryPercent ?? '?'}%, alarm word ${alarmWord}, E7 ${e7}${state}`,
    );
  }

  /**
   * 其余报警位（SOS、超速、低电、非法位移…）暂时不落库，但至少要在日志里留痕：
   * 这次修的就是「解出来了却没人看」，不能再悄悄丢一批。
   */
  private logUnhandled(device: GpsDevice, kinds: AlarmKind[]): void {
    const others = kinds.filter((k) => !ALARM_TO_ANOMALY[k]).sort();
    // 报警位是「条件解除前一直保持」的：一个卡住的低电或天线断开位，
    // 实时模式下每 10 秒就会带一次。每帧都打 warn 就是 6 行/分钟/台，
    // 正是 §7 说的那种会把日志写满、顶爆内存、连带拖垮同进程 API 的路径。只在集合变化时记。
    const signature = others.join(',');
    if (this.lastUnhandled.get(device.deviceNo) === signature) return;
    this.lastUnhandled.set(device.deviceNo, signature);
    if (this.lastUnhandled.size > MAX_TRACKED_DEVICES) {
      const oldest = this.lastUnhandled.keys().next().value;
      if (oldest !== undefined) this.lastUnhandled.delete(oldest);
    }
    if (others.length) {
      this.logger.warn(`device ${device.deviceNo} reports unhandled alarm(s): ${signature}`);
    }
  }

  /** 震动 / 断电：按状态变化开案与结案 */
  private async syncLevelAlarms(
    device: GpsDevice,
    kinds: AlarmKind[],
    pos: Position,
    opts: { hasFix: boolean; target: AlarmTarget | null; pointTime: Date },
  ): Promise<void> {
    const now = new Set<AnomalyType>();
    for (const kind of kinds) {
      const type = ALARM_TO_ANOMALY[kind];
      if (type) now.add(type);
    }
    // 0xE4 明说「断开外接电源，备用电源供电」也算断电。报警位 bit8 是「防拆报警」，
    // 受防拆开关 0xF100 控制，关掉了就不置位；而 0xE4 每一条定位都带，是更直接的证据。
    if (pos.extras?.externalPower === false) now.add(AnomalyType.POWER_CUT);

    const before = this.active.get(device.deviceNo);
    for (const type of LEVEL_ALARMS) {
      const isActive = now.has(type);
      const wasActive = !!before?.has(type);
      if (isActive && !wasActive) {
        await this.raise(device, type, fixPoint(pos, opts.hasFix), opts.target, {
          dedupe: true,
          description: this.describe(device, type, pos),
        });
      } else if (!isActive && wasActive) {
        await this.resolveOpen(device, type);
      }
    }

    if (now.size === 0) {
      this.active.delete(device.deviceNo);
    } else {
      if (this.active.size >= MAX_TRACKED_DEVICES && !this.active.has(device.deviceNo)) this.active.clear();
      this.active.set(device.deviceNo, now);
    }
  }

  /** 围栏进出：平台侧判定，边沿触发 */
  private async checkGeofences(
    device: GpsDevice,
    pos: Position,
    opts: { hasFix: boolean; target: AlarmTarget | null; pointTime: Date },
  ): Promise<void> {
    const fences = await this.geofences.fencesFor(device.vehiclePlate);
    if (fences.length === 0) {
      this.inside.delete(device.deviceNo);
      return;
    }

    if (this.inside.size >= MAX_TRACKED_DEVICES && !this.inside.has(device.deviceNo)) this.inside.clear();
    let state = this.inside.get(device.deviceNo);
    if (!state) { state = new Map<string, boolean>(); this.inside.set(device.deviceNo, state); }

    const liveIds = new Set(fences.map((f) => f.id));
    for (const id of [...state.keys()]) if (!liveIds.has(id)) state.delete(id);

    for (const fence of fences) {
      const was = state.get(fence.id);
      const nowInside = isInsideGeofence(fence, pos.latitude, pos.longitude, was ?? false);

      // 第一次见到这个「设备 × 围栏」组合：只记状态。
      // 否则每次重启、每次新建围栏，停在场内的车都会被当成「刚刚驶入」报一遍。
      if (was === undefined) { state.set(fence.id, nowInside); continue; }
      if (was === nowInside) continue;

      const type = nowInside ? AnomalyType.GEOFENCE_ENTER : AnomalyType.GEOFENCE_LEAVE;
      // 这个方向不报警时状态照样要翻，否则下一次真正要报的那个方向会判断成「没变化」
      if (nowInside ? !fence.alertOnEnter : !fence.alertOnLeave) { state.set(fence.id, nowInside); continue; }

      const key = `${device.deviceNo}|${fence.id}`;
      if (Date.now() - (this.lastFenceEventAt.get(key) ?? 0) < GEOFENCE_MIN_EVENT_MS) {
        // 间隔太近：**不翻状态**就跳过。翻了的话这次穿越就永远丢了（下一帧会被当成「没变化」）。
        // 抖动会自己回到原状态、什么都不报；真的穿越则在间隔过去后的下一帧补报出来。
        continue;
      }
      state.set(fence.id, nowInside);
      this.lastFenceEventAt.set(key, Date.now());

      // 进出是「事件」不是「状态」：不做未结案去重，否则进了 A 围栏就再也报不出 B 围栏。
      // 防重复靠的是边沿触发 + 迟滞 + 上面的最小间隔。
      await this.raise(device, type, fixPoint(pos, opts.hasFix), opts.target, {
        dedupe: false,
        description: this.describeFence(device, type, fence),
        geofenceId: fence.id,
      });
    }
  }

  private async raise(
    device: GpsDevice,
    type: AnomalyType,
    point: AlarmPoint | null,
    target: AlarmTarget | null,
    extra: { dedupe: boolean; description: string; geofenceId?: string },
  ): Promise<void> {
    if (extra.dedupe) {
      // 进程重启后内存状态是空的，会把「一直在报警」当成刚发生。
      // 数据库才是去重的准绳：已经有未结案的同类记录就什么都不做，不再通知一次。
      const open = await this.anomalyRepo.findOne({
        where: { deviceNo: device.deviceNo, anomalyType: type, resolved: false },
        order: { detectedAt: 'DESC' },
      });
      if (open) return;
    }

    const row = this.anomalyRepo.create({
      driverId: target?.driverId ?? null,
      taskId: target?.taskId ?? null,
      anomalyType: type,
      description: extra.description,
      // 没有定位时绝不能写坐标。断电/防拆恰恰最常发生在没定位的时候（刚断电、在室内、被屏蔽），
      // 而 Number.isFinite(0) 为真——以前会记成 0,0，最该有位置的那条防盗记录被钉在几内亚湾。
      // 另外原始值最大到 4294.97，直接写 numeric(10,7) 会溢出，整条记录丢掉。
      latitude: point ? inRange(point.latitude, 90) : null,
      longitude: point ? inRange(point.longitude, 180) : null,
      speed: point && point.speed != null ? inRange(point.speed, 9999) : null,
      deviceNo: device.deviceNo,
      vehiclePlate: device.vehiclePlate ?? null,
      geofenceId: extra.geofenceId ?? null,
      alarmCount: 1,
    } as any);

    let anomalyId: string | null = null;
    try {
      const saved = await this.anomalyRepo.save(row);
      anomalyId = (saved as any)?.id ?? null;
    } catch (e: any) {
      // 记录写不进去也要把通知发出去：报警本身比归档更要紧
      this.logger.error(`failed to record ${type} for ${device.deviceNo}: ${e?.message || e}`);
    }

    const who = device.vehiclePlate || device.name || device.deviceNo;
    await this.notifService.create(null, {
      title: `🚨 ${ALARM_LABEL[type] ?? type}`,
      content: extra.description,
      type: `gps_${type}`,
      meta: {
        sound: true,
        anomalyId,
        deviceNo: device.deviceNo,
        vehiclePlate: device.vehiclePlate ?? null,
        geofenceId: extra.geofenceId ?? null,
        driverId: target?.driverId ?? null,
        taskId: target?.taskId ?? null,
        // 没定位时给 null：以前直接给 pos.latitude，无定位的断电报警通知里带的是 0,0
        latitude: point ? inRange(point.latitude, 90) : null,
        longitude: point ? inRange(point.longitude, 180) : null,
      },
      notifyAdmins: true,
    });
    this.logger.warn(`${type} raised for ${who} (device ${device.deviceNo})`);
  }

  /**
   * 接着车电的定位器消失了（由 DeviceOfflineWatcher 判定后调用）。
   *
   * 这是给「没有备用电池」的设备兜底的：2026-09-28 拔电测试里设备一拔线就整机断电，
   * 断电报警一个字节都没发出来，平台只能从「它不见了」这件事上发现。
   * 每次消失只报一次：已经有一条在它最后一次上报之后产生的掉线记录（哪怕管理员已经结案），就不再报。
   * 绝不抛错：跑在定时器里，和 API 同进程。
   */
  async raiseOffline(
    device: GpsDevice,
    info: { lastSeenAt: Date; moving: boolean; target: AlarmTarget | null },
  ): Promise<void> {
    try {
      const already = await this.anomalyRepo.findOne({
        where: {
          deviceNo: device.deviceNo,
          anomalyType: AnomalyType.DEVICE_OFFLINE,
          detectedAt: MoreThanOrEqual(info.lastSeenAt),
        },
      });
      if (already) return;

      const lat = numberOrNull(device.lastLatitude);
      const lng = numberOrNull(device.lastLongitude);
      // 位置是它消失前最后一次定位——防盗时最要紧的就是这个
      const point = lat != null && lng != null
        ? { latitude: lat, longitude: lng, speed: numberOrNull(device.lastSpeed) }
        : null;
      const who = device.vehiclePlate || device.name || device.deviceNo;
      const minutes = Math.max(1, Math.round((Date.now() - info.lastSeenAt.getTime()) / 60000));
      const how = info.moving ? `当时在行驶（${numberOrNull(device.lastSpeed) ?? '?'} km/h）` : '当时停着';
      const description = `${who} 定位器接着车电时突然断开，已 ${minutes} 分钟没有任何数据`
        + `（最后数据 ${nzTime(info.lastSeenAt)}，${how}）。可能被拔掉、剪线或拆除；设备重新连上后自动结案`;
      await this.raise(device, AnomalyType.DEVICE_OFFLINE, point, info.target, { dedupe: true, description });
    } catch (e: any) {
      this.logger.warn(`offline alarm for ${device.deviceNo} failed: ${e?.message || e}`);
    }
  }

  /** 设备重新连上：把还开着的掉线记录结掉。绝不抛错（跑在 TCP 网关上） */
  async deviceBackOnline(deviceNo: string): Promise<void> {
    try {
      const res = await this.anomalyRepo.update(
        { deviceNo, anomalyType: AnomalyType.DEVICE_OFFLINE, resolved: false },
        { resolved: true, resolvedAt: new Date() },
      );
      if (res?.affected) this.logger.log(`${AnomalyType.DEVICE_OFFLINE} cleared for device ${deviceNo} (reconnected)`);
    } catch (e: any) {
      this.logger.warn(`clearing the offline alarm for ${deviceNo} failed: ${e?.message || e}`);
    }
  }

  /** 报警条件解除：把未结案的那条自动结掉，下次再触发才算新报警 */
  private async resolveOpen(device: GpsDevice, type: AnomalyType): Promise<void> {
    const open = await this.anomalyRepo.findOne({
      where: { deviceNo: device.deviceNo, anomalyType: type, resolved: false },
      order: { detectedAt: 'DESC' },
    });
    if (!open) return;
    await this.anomalyRepo.update(open.id, { resolved: true, resolvedAt: new Date() });
    this.logger.log(`${type} cleared for device ${device.deviceNo}`);
  }

  private describe(device: GpsDevice, type: AnomalyType, pos: Position): string {
    const who = device.vehiclePlate || device.name || device.deviceNo;
    if (type === AnomalyType.POWER_CUT) {
      const volt = pos.extras.voltage != null ? `，外电 ${pos.extras.voltage.toFixed(2)}V` : '';
      const battery = pos.extras.externalPower === false && pos.extras.batteryPercent != null
        ? `，现由备用电池供电（剩余 ${pos.extras.batteryPercent}%）`
        : '';
      return `${who} 定位器主电源被切断（防拆报警）${volt}${battery}`;
    }
    if (type === AnomalyType.SHOCK) {
      const armed = pos.extras.alarmExtState?.armed ? '设防状态下' : '';
      return `${who} 定位器检测到${armed}震动`;
    }
    return `${who} ${ALARM_LABEL[type] ?? type}`;
  }

  private describeFence(device: GpsDevice, type: AnomalyType, fence: Geofence): string {
    const who = device.vehiclePlate || device.name || device.deviceNo;
    const verb = type === AnomalyType.GEOFENCE_ENTER ? '驶入' : '驶离';
    return `${who} ${verb}围栏「${fence.name}」（半径 ${fence.radiusM} 米）`;
  }
}
