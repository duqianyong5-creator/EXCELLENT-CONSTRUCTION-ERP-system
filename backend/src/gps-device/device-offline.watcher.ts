import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';
import { GpsDevice } from './gps-device.entity';
import { GpsDeviceService } from './gps-device.service';
import { DeviceAlarmService } from './device-alarm.service';
import { Jt808Server } from './jt808.server';

/** 停着的车：定位器消失 2 分钟就报。拔线、剪线偷车都发生在车停着的时候 */
export const OFFLINE_GRACE_PARKED_MS = 2 * 60 * 1000;
/** 行驶中的车：山谷、隧道里掉信号是常事，等 30 分钟还没回来才报 */
export const OFFLINE_GRACE_MOVING_MS = 30 * 60 * 1000;
/** 多久以前消失的不再补报：服务停了很久再启动时，不该把一堆陈年掉线一起报出来 */
export const OFFLINE_LOOKBACK_MS = 24 * 3600 * 1000;
/** 进程刚启动：部署会断开所有连接，设备要一会儿才连回来，先等 */
export const OFFLINE_BOOT_GRACE_MS = 5 * 60 * 1000;
/** 最后一次定位的速度达到这个值、且定位是它消失前不久的，才算「在行驶」 */
const MOVING_KMH = 5;
const MOVING_FIX_FRESH_MS = 5 * 60 * 1000;

/**
 * 掉线报警：一台**接着车电**的定位器突然消失。
 *
 * 为什么需要平台来判定：2026-09-28 拔电测试里，那台设备一拔线就整机断电——没有报断电位、
 * 也没有用电池继续报位置，一个字节都没发出来。设备自己的断电报警对这种设备永远不会来，
 * 平台能看到的只有「它不见了」。服务器本身也要等 Railway 代理关掉连接（约 100 秒）才知道。
 *
 * 只看接着车电的设备：靠电池的设备休眠、断网是正常行为，不能报。
 */
@Injectable()
export class DeviceOfflineWatcher {
  private readonly logger = new Logger('DeviceOffline');
  private startedAt = Date.now();
  private running = false;

  constructor(
    @InjectRepository(GpsDevice) private repo: Repository<GpsDevice>,
    private server: Jt808Server,
    private devices: GpsDeviceService,
    private alarms: DeviceAlarmService,
  ) {}

  @Interval(30_000)
  async tick(): Promise<void> {
    if (this.running) return; // 上一轮还没跑完（数据库慢）就跳过，别叠起来
    this.running = true;
    try {
      await this.check(Date.now());
    } catch (e: any) {
      this.logger.warn(`offline check failed: ${e?.message || e}`);
    } finally {
      this.running = false;
    }
  }

  /** 返回本轮判定为掉线的设备数（是否真的新开了报警由 raiseOffline 去重决定） */
  async check(now: number): Promise<number> {
    // 网关没开或没起来：所有设备看起来都「不在线」，这时报出来的全是假警报
    if (this.server.getPort() === null) return 0;
    if (now - this.startedAt < OFFLINE_BOOT_GRACE_MS) return 0;

    const candidates = await this.repo.find({
      where: {
        enabled: true,
        externalPower: true,
        lastSeenAt: Between(new Date(now - OFFLINE_LOOKBACK_MS), new Date(now - OFFLINE_GRACE_PARKED_MS)),
      },
    });

    let offline = 0;
    for (const device of candidates) {
      // 连接还在：可能只是安静（休眠、心跳间隔长），不算消失
      if (this.server.isOnline(device.deviceNo)) continue;
      const lastSeenAt = new Date(device.lastSeenAt);
      const moving = isMoving(device, lastSeenAt.getTime());
      if (now - lastSeenAt.getTime() < (moving ? OFFLINE_GRACE_MOVING_MS : OFFLINE_GRACE_PARKED_MS)) continue;
      const target = await this.devices.resolveTarget(device.vehiclePlate);
      await this.alarms.raiseOffline(device, {
        lastSeenAt,
        moving,
        target: target ? { taskId: target.taskId, driverId: target.driverId } : null,
      });
      offline++;
    }
    return offline;
  }
}

function isMoving(device: GpsDevice, lastSeenMs: number): boolean {
  const speed = Number(device.lastSpeed);
  const fixAt = device.lastFixAt ? new Date(device.lastFixAt).getTime() : NaN;
  return Number.isFinite(speed) && speed >= MOVING_KMH
    && Number.isFinite(fixAt) && lastSeenMs - fixAt <= MOVING_FIX_FRESH_MS;
}
