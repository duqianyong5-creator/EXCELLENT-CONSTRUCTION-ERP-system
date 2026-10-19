import { Injectable, Logger, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import { GpsLog } from './gps-log.entity';
import { GpsAnomaly, AnomalyType } from './gps-anomaly.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { Task, TaskStatus } from '../tasks/task.entity';
import { UserRole } from '../users/user.entity';
import { haversineKm } from './geo.util';
import { ErrorCode } from '../common/i18n/messages';

type RequestUser = { id: string; role: UserRole };

/**
 * 同一个任务可能同时有两个来源的点：司机手机（人）和车载定位器（车）。
 * 两者混在一起，地图会在两点之间反复跳、轨迹画成锯齿。
 * 车载定位器绑在车上、不依赖司机手机，是更可信的来源，只要有就只用它。
 */
const MIN_DEVICE_POINTS_FOR_TRACK = 5;
/** 定位器停报超过这么久，就认为这段路它没覆盖到，用手机点补上 */
const DEVICE_COVERAGE_GAP_MS = 5 * 60 * 1000;

const timeOf = (g: { timestamp?: Date | string }): number => {
  const t = g.timestamp instanceof Date ? g.timestamp.getTime() : new Date(g.timestamp ?? 0).getTime();
  return Number.isNaN(t) ? 0 : t;
};

export function preferDeviceSource<T extends { source?: string; timestamp?: Date | string }>(logs: T[]): T[] {
  const device = logs.filter((g) => g.source === 'device');
  // 要有若干个点才认为"这趟车确实由定位器在跟"，
  // 否则一两个偶发的设备点（车牌刚绑错、设备刚上线）就会把整条手机轨迹藏掉。
  if (device.length < MIN_DEVICE_POINTS_FOR_TRACK) return logs;

  // 定位器覆盖到的时段只用定位器（避免人车分离画出锯齿）；
  // 它没覆盖的时段（中途断电、装之前、拆之后）仍然保留手机轨迹，否则整趟回放会被截断。
  const deviceTimes = device.map(timeOf).sort((a, b) => a - b);
  const covered = (t: number): boolean =>
    deviceTimes.some((d) => Math.abs(d - t) <= DEVICE_COVERAGE_GAP_MS);

  const kept = logs.filter((g) => g.source === 'device' || !covered(timeOf(g)));
  return kept.sort((a, b) => timeOf(a) - timeOf(b));
}

const MAX_SPEED_KMH = 140;
const TELEPORT_THRESHOLD_KM = 10;
const GPS_TIMEOUT_SECONDS = 60;
const ONLINE_POSITION_WINDOW_SECONDS = 180; // 司机最近多少秒内有点就算在线（给熄屏偶尔稀疏上报留缓冲）

@Injectable()
export class GpsService {
  private readonly logger = new Logger('GpsService');

  constructor(
    @InjectRepository(GpsLog) private repo: Repository<GpsLog>,
    @InjectRepository(Task) private taskRepo: Repository<Task>,
    @InjectRepository(GpsAnomaly) private anomalyRepo: Repository<GpsAnomaly>,
    private notifService: NotificationsService,
  ) {}

  async upload(driverId: string, taskId: string, data: {
    latitude: number;
    longitude: number;
    speed: number;
    heading?: number;
    accuracy?: number;
    /** 点位时间：手机端不传（= 服务器收到时刻）；车载设备传终端定位时间（盲区补报会是过去的时间） */
    timestamp?: Date;
    /** 'app' 手机 App | 'device' 车载 JT808 定位器 */
    source?: 'app' | 'device';
    /** 盲区补报的历史点：不做实时广播，避免一次补几百个点把前端刷爆 */
    silent?: boolean;
  }): Promise<{ log: GpsLog; anomalies: string[] }> {
    const anomalies: string[] = [];
    const pointTime = data.timestamp ?? new Date();
    const source = data.source ?? 'app';

    // Check speed anomaly
    if (data.speed > MAX_SPEED_KMH) {
      anomalies.push('speed_anomaly');
    }

    // Check teleport（补报的历史点时间早于最近一点时不比较，否则必然误判）
    const lastLog = await this.repo.findOne({
      where: { driverId, taskId },
      order: { timestamp: 'DESC' },
    });

    // 只和同一来源的上一个点比：手机在司机身上、定位器在车上，两者本就可能相距很远，
    // 跨来源比较会在司机离车时把每一个点都判成瞬移，进而刷屏报警。
    if (lastLog && (lastLog.source ?? 'app') === source) {
      const dist = haversineKm(
        Number(lastLog.latitude), Number(lastLog.longitude),
        data.latitude, data.longitude,
      );
      const timeDiff = (pointTime.getTime() - lastLog.timestamp.getTime()) / 1000;
      const expectedMaxDist = (MAX_SPEED_KMH / 3600) * timeDiff;

      if (timeDiff > 0 && dist > TELEPORT_THRESHOLD_KM && dist > expectedMaxDist * 1.5) {
        anomalies.push('teleport');
      }
    }

    const log = this.repo.create({
      driverId,
      taskId,
      latitude: data.latitude,
      longitude: data.longitude,
      speed: data.speed,
      heading: data.heading,
      accuracy: data.accuracy,
      source,
      ...(data.timestamp ? { timestamp: data.timestamp } : {}),
      isAnomaly: anomalies.length > 0,
    });
    const saved = await this.repo.save(log);

    if (!data.silent) {
      this.notifService.broadcastGpsUpdate(driverId, {
        taskId,
        latitude: saved.latitude,
        longitude: saved.longitude,
        speed: saved.speed,
        heading: saved.heading,
        accuracy: saved.accuracy,
        timestamp: saved.timestamp,
      });
    }

    if (anomalies.length > 0) {
      // 落一条异常记录：以前只发通知，「异常管理」页读的是 gps_anomalies 表，
      // 所以「速度异常 / 瞬移异常」两个筛选项永远是空的，超速记录事后既查不到也没法处理。
      // 静止报警由 GpsAlarmService 单独维护自己的记录，这里只管上报时当场判定的两类。
      for (const type of anomalies) {
        try {
          const row = this.anomalyRepo.create({
            driverId,
            taskId: taskId || null,
            anomalyType: type as AnomalyType,
            description: this.describeAnomaly(type, saved),
            latitude: saved.latitude != null ? Number(saved.latitude) : null,
            longitude: saved.longitude != null ? Number(saved.longitude) : null,
            speed: saved.speed != null ? Number(saved.speed) : null,
            alarmCount: 1,
          } as any);
          await this.anomalyRepo.save(row);
        } catch (e: any) {
          // 定位点本身已经存下来了，异常记录写失败不该把上报打回去让司机 App 重试
          this.logger.warn(`failed to record ${type} anomaly for driver ${driverId}: ${e?.message || e}`);
        }
      }

      await this.notifService.create(null, {
        title: 'GPS 异常',
        content: `司机 GPS 检测到异常：${anomalies.join(', ')}`,
        type: 'gps_anomaly',
        meta: { driverId, taskId, anomalies },
        notifyAdmins: true,
      });
    }

    return { log: saved, anomalies };
  }

  /** 异常记录上要能看出「到底怎么了」，光一个类型名事后没法判断 */
  private describeAnomaly(type: string, log: GpsLog): string {
    const speed = log.speed != null ? Number(log.speed).toFixed(1) : '?';
    if (type === AnomalyType.SPEED_ANOMALY) return `上报速度 ${speed} km/h，超过合理阈值`;
    if (type === AnomalyType.TELEPORT) return `两次定位之间位置跳变过大（疑似定位漂移或伪造）`;
    return type;
  }

  async getTrack(taskId: string): Promise<GpsLog[]> {
    const logs = await this.repo.find({
      where: { taskId },
      order: { timestamp: 'ASC' },
    });
    return preferDeviceSource(logs);
  }

  // 运营角色（管理员/调度/监控）可看任意任务/司机；客户只能看自己名下的任务/司机；
  // 司机只能看自己。否则 403。防止任意登录账号枚举他人定位。
  private isStaff(role: UserRole): boolean {
    return role === UserRole.ADMIN || role === UserRole.DISPATCHER || role === UserRole.MONITOR;
  }

  private async assertTaskVisible(taskId: string, user: RequestUser): Promise<void> {
    if (this.isStaff(user.role)) return;
    const task = await this.taskRepo.findOne({
      where: { id: taskId },
      select: ['id', 'clientId', 'driverId'],
    });
    if (task) {
      if (user.role === UserRole.CLIENT && task.clientId === user.id) return;
      if (user.role === UserRole.DRIVER && task.driverId === user.id) return;
    }
    throw new ForbiddenException(ErrorCode.FORBIDDEN_TASK_TRACK);
  }

  private async assertDriverVisible(driverId: string, user: RequestUser): Promise<void> {
    if (this.isStaff(user.role)) return;
    if (user.role === UserRole.DRIVER && driverId === user.id) return;
    if (user.role === UserRole.CLIENT) {
      // 客户仅能查看自己名下任务上的司机
      const task = await this.taskRepo.findOne({
        where: { clientId: user.id, driverId },
        select: ['id'],
      });
      if (task) return;
    }
    throw new ForbiddenException(ErrorCode.FORBIDDEN_DRIVER_POSITION);
  }

  async getTrackForUser(taskId: string, user: RequestUser): Promise<GpsLog[]> {
    await this.assertTaskVisible(taskId, user);
    return this.getTrack(taskId);
  }

  async getDriverPositionForUser(driverId: string, user: RequestUser): Promise<GpsLog | null> {
    await this.assertDriverVisible(driverId, user);
    return this.getDriverLatestPosition(driverId);
  }

  // 每个司机取最新一条位置（最近窗口内、进行中任务）。用 getMany + JS 去重，
  // 避免 Postgres 专属的 DISTINCT ON 原生列名出错导致接口 500。
  private dedupeLatestByDriver(logs: GpsLog[]): any[] {
    // logs 已按时间倒序。每个司机取最新一条；若该司机在窗口内有车载定位器的点，
    // 就只认定位器（否则地图会在手机位置和车辆位置之间来回跳）。
    const best = new Map<string, GpsLog>();
    for (const g of logs) {
      if (!g.driverId) continue;
      const current = best.get(g.driverId);
      if (!current) { best.set(g.driverId, g); continue; }
      if (current.source !== 'device' && g.source === 'device') best.set(g.driverId, g);
    }
    return [...best.values()].map((g) => ({
      driverId: g.driverId,
      taskId: g.taskId,
      latitude: g.latitude,
      longitude: g.longitude,
      speed: g.speed,
      heading: g.heading,
      accuracy: g.accuracy,
      timestamp: g.timestamp,
      source: g.source ?? 'app',
    }));
  }

  // 把司机账号名直接挂到每个位置点上，地图标记不必再单独查司机列表
  // （监控/客户等角色拿不到司机列表也能显示名字）。
  private attachDriverNames(positions: any[], tasks: Task[]): any[] {
    const nameById = new Map<string, string>();
    for (const t of tasks) {
      if (t.driverId) nameById.set(t.driverId, t.driver?.fullName || t.driver?.username || '司机');
    }
    for (const p of positions) {
      p.driverName = nameById.get(p.driverId) || '司机';
    }
    return positions;
  }

  async getLatestPositions(): Promise<any[]> {
    // 取进行中任务（带司机关系，用于给位置点附上司机账号名）
    const inProgress = await this.taskRepo.find({
      where: { status: TaskStatus.IN_PROGRESS },
      relations: ['driver'],
    });
    const taskIds = inProgress.map((t) => t.id);
    if (taskIds.length === 0) {
      return [];
    }
    // 用数据库自身时钟比对"新鲜度"，避免本机时钟与云数据库(Supabase)时钟不一致导致全被过滤
    const logs = await this.repo
      .createQueryBuilder('g')
      .where('g.taskId IN (:...taskIds)', { taskIds })
      .andWhere(`g.timestamp > NOW() - (:windowSec * INTERVAL '1 second')`, { windowSec: ONLINE_POSITION_WINDOW_SECONDS })
      .orderBy('g.timestamp', 'DESC')
      .getMany();
    return this.attachDriverNames(this.dedupeLatestByDriver(logs), inProgress);
  }

  async getDriverLatestPosition(driverId: string): Promise<GpsLog | null> {
    return this.repo.findOne({
      where: { driverId },
      order: { timestamp: 'DESC' },
    });
  }

  async getClientDriverPositions(clientId: string): Promise<any[]> {
    const inProgress = await this.taskRepo.find({
      where: { status: TaskStatus.IN_PROGRESS, clientId },
      relations: ['driver'],
    });
    const taskIds = inProgress.map((t) => t.id);
    if (taskIds.length === 0) return [];
    const logs = await this.repo
      .createQueryBuilder('g')
      .where('g.taskId IN (:...taskIds)', { taskIds })
      .andWhere(`g.timestamp > NOW() - (:windowSec * INTERVAL '1 second')`, { windowSec: ONLINE_POSITION_WINDOW_SECONDS })
      .orderBy('g.timestamp', 'DESC')
      .getMany();
    return this.attachDriverNames(this.dedupeLatestByDriver(logs), inProgress);
  }

  async checkGpsTimeout(driverId: string, taskId: string): Promise<boolean> {
    const cutoff = new Date(Date.now() - GPS_TIMEOUT_SECONDS * 1000);
    const recent = await this.repo.findOne({
      where: {
        driverId,
        taskId,
        timestamp: MoreThan(cutoff),
      },
    });
    return !recent;
  }

  async calculateGpsDuration(taskId: string): Promise<number> {
    const logs = await this.getTrack(taskId);
    if (logs.length < 2) return 0;

    let validSeconds = 0;
    for (let i = 1; i < logs.length; i++) {
      const diff = (logs[i].timestamp.getTime() - logs[i - 1].timestamp.getTime()) / 1000;
      if (diff <= GPS_TIMEOUT_SECONDS) {
        validSeconds += diff;
      }
    }

    return Math.round(validSeconds / 60);
  }
}
