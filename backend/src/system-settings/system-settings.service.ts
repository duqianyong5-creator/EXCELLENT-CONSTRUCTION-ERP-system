import { Injectable, BadRequestException, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { SystemSetting } from './system-setting.entity';

// 默认值
export const SETTING_DEFAULTS: Record<string, string> = {
  clear_data_password: '',         // 清空数据密码（为空表示未设置）
  gps_stationary_minutes: '15',    // GPS 多少分钟不动触发报警
  gps_stationary_radius_m: '80',   // 位移阈值（米）：窗口内始终在该范围内即视为静止（容忍漂移）
  gps_alarm_repeat: '3',           // 最多报警次数（含首次）
  gps_alarm_delay_minutes: '10',   // 延时报警间隔（分钟）
  gps_retention_days: '7',         // 原始精度保留天数（10 秒一个点，用于看细节）
  gps_history_days: '60',          // 轨迹回放总天数：超过上面的天数后降采样保留，到这个天数才真正删除
  gps_downsample_seconds: '60',    // 降采样粒度：旧轨迹每这么多秒保留一个点
  ruc_warn_km: '500',              // RUC 路税：剩余公里低于此值开始提醒
  ruc_critical_km: '200',          // RUC 路税：剩余公里低于此值紧急提醒
  ruc_warn_days: '3',              // RUC 路税：预计多少天内用完就提醒
};

@Injectable()
export class SystemSettingsService {
  constructor(
    @InjectRepository(SystemSetting) private repo: Repository<SystemSetting>,
    private dataSource: DataSource,
  ) {}

  async getAll(): Promise<Record<string, string>> {
    const rows = await this.repo.find();
    const map: Record<string, string> = { ...SETTING_DEFAULTS };
    rows.forEach((r) => { map[r.key] = r.value ?? ''; });
    // 不向客户端外泄清空数据密码明文，只返回「是否已设置」标志
    map.clear_data_password_set = map.clear_data_password ? '1' : '';
    map.clear_data_password = '';
    return map;
  }

  async get(key: string): Promise<string> {
    const row = await this.repo.findOne({ where: { key } });
    return row?.value ?? SETTING_DEFAULTS[key] ?? '';
  }

  async getNumber(key: string, fallback: number): Promise<number> {
    const v = Number(await this.get(key));
    return Number.isFinite(v) && v > 0 ? v : fallback;
  }

  async set(key: string, value: string): Promise<void> {
    await this.repo.save({ key, value: value ?? '' });
  }

  async setMany(values: Record<string, string>): Promise<Record<string, string>> {
    const entries = Object.entries(values).filter(([k]) => k in SETTING_DEFAULTS);
    for (const [key, raw] of entries) {
      let value = String(raw ?? '');
      // 清空数据密码永不明文落库：存 bcrypt 哈希。空串表示清除密码。
      if (key === 'clear_data_password' && value) {
        value = await bcrypt.hash(value, 12);
      }
      await this.repo.save({ key, value });
    }
    return this.getAll();
  }

  // 清空业务数据：GPS 轨迹、异常、工时、调整、通知、公告、任务（仪表盘数据由任务派生）
  async clearData(password: string): Promise<{ cleared: string[] }> {
    const saved = await this.get('clear_data_password');
    if (!saved) {
      throw new BadRequestException('未设置清空数据密码，请先在系统设置中设置');
    }
    // 常量时间比对 bcrypt 哈希，避免明文/时序泄露
    const ok = password ? await bcrypt.compare(password, saved) : false;
    if (!ok) {
      throw new UnauthorizedException('清空数据密码错误');
    }

    const tables = [
      'gps_logs',
      'gps_anomalies',
      'adjustment_logs',
      'work_records',
      'notifications',
      'announcements',
      'tasks',
    ];
    await this.dataSource.query(
      `TRUNCATE TABLE ${tables.join(', ')} RESTART IDENTITY CASCADE`,
    );
    return { cleared: tables };
  }
}
