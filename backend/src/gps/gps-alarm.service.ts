import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GpsLog } from './gps-log.entity';
import { GpsAnomaly, AnomalyType } from './gps-anomaly.entity';
import { Task, TaskStatus } from '../tasks/task.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { SystemSettingsService } from '../system-settings/system-settings.service';
import { haversineKm } from './geo.util';

// 判定"没动"的默认位移阈值（米）。可在系统设置里调整。
// GPS 静止时会原地漂移（瞬时速度也会有假读数），所以用「窗口内的点是否聚在一个小范围」来判断，
// 而不是看瞬时速度，并允许少量漂移离群点。
const DEFAULT_STATIONARY_RADIUS_M = 80;
// 偏离质心超过阈值的点占比超过此值，才算"真的在移动"（容忍个别漂移尖峰）。
const MOVING_POINT_RATIO = 0.25;

@Injectable()
export class GpsAlarmService {
  private readonly logger = new Logger(GpsAlarmService.name);

  constructor(
    @InjectRepository(GpsLog) private gpsRepo: Repository<GpsLog>,
    @InjectRepository(GpsAnomaly) private anomalyRepo: Repository<GpsAnomaly>,
    @InjectRepository(Task) private taskRepo: Repository<Task>,
    private notifService: NotificationsService,
    private settings: SystemSettingsService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async checkStationary() {
    try {
      const stationaryMin = await this.settings.getNumber('gps_stationary_minutes', 15);
      const repeat = await this.settings.getNumber('gps_alarm_repeat', 3);
      const delayMin = await this.settings.getNumber('gps_alarm_delay_minutes', 10);
      const radiusKm = (await this.settings.getNumber('gps_stationary_radius_m', DEFAULT_STATIONARY_RADIUS_M)) / 1000;

      const tasks = await this.taskRepo.find({
        where: { status: TaskStatus.IN_PROGRESS },
        relations: ['driver'],
      });

      for (const task of tasks) {
        if (!task.driverId) continue;
        await this.evaluateTask(task, stationaryMin, repeat, delayMin, radiusKm);
      }
    } catch (e: any) {
      this.logger.error(`stationary check failed: ${e?.message || e}`);
    }
  }

  private async evaluateTask(task: Task, stationaryMin: number, repeat: number, delayMin: number, radiusKm: number) {
    const now = Date.now();

    // 用数据库自身时钟取窗口内的轨迹点。GPS 时间戳由数据库(Supabase)写入，
    // 若用本机 Date.now() 比对会因本机与云库时钟不一致而查不到点 → 永远不报警。
    const logs = await this.gpsRepo
      .createQueryBuilder('g')
      .where('g.driverId = :driverId', { driverId: task.driverId })
      .andWhere('g.taskId = :taskId', { taskId: task.id })
      .andWhere(`g.timestamp > NOW() - (:sec * INTERVAL '1 second')`, { sec: Math.round(stationaryMin * 60) })
      .orderBy('g.timestamp', 'ASC')
      .getMany();

    const open = await this.anomalyRepo.findOne({
      where: {
        driverId: task.driverId,
        taskId: task.id,
        anomalyType: AnomalyType.STATIONARY,
        resolved: false,
      },
      order: { detectedAt: 'DESC' },
    });

    const stationary = this.isStationary(logs, stationaryMin, radiusKm);

    // 已恢复移动：自动结案已存在的静止报警
    if (!stationary) {
      if (open) {
        await this.anomalyRepo.update(open.id, { resolved: true, resolvedAt: new Date() });
      }
      return;
    }

    const latest = logs[logs.length - 1];
    const driverName = task.driver?.fullName || task.driver?.username || '司机';

    // 首次报警
    if (!open) {
      const anomaly = this.anomalyRepo.create({
        driverId: task.driverId,
        taskId: task.id,
        anomalyType: AnomalyType.STATIONARY,
        description: `${driverName} GPS 已超过 ${stationaryMin} 分钟未移动`,
        latitude: latest ? Number(latest.latitude) : null,
        longitude: latest ? Number(latest.longitude) : null,
        speed: latest ? Number(latest.speed) : null,
        alarmCount: 1,
        snoozeUntil: new Date(now + delayMin * 60 * 1000),
      });
      const saved = await this.anomalyRepo.save(anomaly);
      await this.fireAlarm(task, saved, 1, stationaryMin);
      return;
    }

    // 处于延时/忽略等待期：暂不重复报警
    if (open.snoozeUntil && open.snoozeUntil.getTime() > now) return;

    // 已达最大报警次数：不再升级
    if (open.alarmCount >= repeat) return;

    // 升级报警（二次 / 三次…）
    const nextCount = open.alarmCount + 1;
    await this.anomalyRepo.update(open.id, {
      alarmCount: nextCount,
      snoozeUntil: new Date(now + delayMin * 60 * 1000),
    });
    await this.fireAlarm(task, open, nextCount, stationaryMin);
  }

  private isStationary(logs: GpsLog[], stationaryMin: number, radiusKm: number): boolean {
    if (logs.length < 2) return false;
    const span = (logs[logs.length - 1].timestamp.getTime() - logs[0].timestamp.getTime()) / 60000;
    // 历史覆盖不足整个窗口时，无法判定静止
    if (span < stationaryMin * 0.8) return false;

    // 以所有点的质心为锚点（比用首点更稳健：首点本身可能就是漂移点）。
    // 统计明显偏离质心的点占比：原地漂移时绝大多数点都聚在阈值内；真正开走时大量点会远离质心。
    const n = logs.length;
    const centLat = logs.reduce((s, l) => s + Number(l.latitude), 0) / n;
    const centLng = logs.reduce((s, l) => s + Number(l.longitude), 0) / n;
    let movedPoints = 0;
    for (const l of logs) {
      const d = haversineKm(centLat, centLng, Number(l.latitude), Number(l.longitude));
      if (d > radiusKm) movedPoints++;
    }
    return movedPoints / n <= MOVING_POINT_RATIO;
  }

  private async fireAlarm(task: Task, anomaly: GpsAnomaly, count: number, stationaryMin: number) {
    const driverName = task.driver?.fullName || task.driver?.username || '司机';
    const ordinal = count === 1 ? '首次' : `第${count}次`;
    await this.notifService.create(null, {
      title: `🚨 GPS 静止报警（${ordinal}）`,
      content: `${driverName}（任务：${task.title || '-'}）GPS 已超过 ${stationaryMin} 分钟未移动`,
      type: 'gps_stationary',
      meta: {
        sound: true,
        anomalyId: anomaly.id,
        driverId: task.driverId,
        taskId: task.id,
        alarmCount: count,
      },
      notifyAdmins: true,
    });
    this.logger.warn(`GPS stationary alarm #${count} for driver ${task.driverId} task ${task.id}`);
  }
}
