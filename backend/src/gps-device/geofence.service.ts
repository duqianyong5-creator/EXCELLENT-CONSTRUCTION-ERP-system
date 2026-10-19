import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Geofence } from './geofence.entity';
import { normalizePlate } from './plate.util';
import { haversineKm } from '../gps/geo.util';
import { ErrorCode } from '../common/i18n/messages';

/**
 * 边界抖动缓冲（米）：停在围栏边上时，GPS 原地漂几十米就会让「在圈内/圈外」来回翻，
 * 每翻一次就是一条进出围栏报警。进圈按 radius 判，出圈要跑出 radius + 这个缓冲才算离开。
 */
export const GEOFENCE_HYSTERESIS_M = 50;

/** 围栏半径的合理区间：小于这个数纯粹是在报 GPS 噪声 */
export const MIN_GEOFENCE_RADIUS_M = 20;
export const MAX_GEOFENCE_RADIUS_M = 200_000;

/** 围栏列表缓存时长。定位点每 10 秒一个，不能每个点都去查一次库。 */
const GEOFENCE_CACHE_MS = 30_000;

export interface GeofenceDto {
  name?: string;
  centerLat?: number;
  centerLng?: number;
  radiusM?: number;
  vehiclePlate?: string | null;
  enabled?: boolean;
  alertOnEnter?: boolean;
  alertOnLeave?: boolean;
}

/**
 * 圆形围栏判定（纯函数）。
 * wasInside 带进来是为了做迟滞：已经在圈内时用放宽后的半径判，避免在边界上反复进出。
 */
export function isInsideGeofence(
  fence: { centerLat: number | string; centerLng: number | string; radiusM: number | string },
  lat: number,
  lng: number,
  wasInside: boolean,
): boolean {
  const distM = haversineKm(Number(fence.centerLat), Number(fence.centerLng), lat, lng) * 1000;
  const radius = Number(fence.radiusM);
  if (!Number.isFinite(distM) || !Number.isFinite(radius)) return wasInside;
  return wasInside ? distM <= radius + GEOFENCE_HYSTERESIS_M : distM <= radius;
}

@Injectable()
export class GeofenceService {
  private cache: { fences: Geofence[]; at: number } | null = null;

  constructor(@InjectRepository(Geofence) private repo: Repository<Geofence>) {}

  // ---------- 管理 CRUD ----------

  list(): Promise<Geofence[]> {
    return this.repo.find({ order: { createdAt: 'ASC' } });
  }

  async findById(id: string): Promise<Geofence> {
    const fence = await this.repo.findOne({ where: { id } });
    if (!fence) throw new NotFoundException(ErrorCode.GEOFENCE_NOT_FOUND);
    return fence;
  }

  async create(dto: GeofenceDto): Promise<Geofence> {
    const fence = this.repo.create({
      name: this.cleanName(dto.name),
      centerLat: this.cleanLat(dto.centerLat),
      centerLng: this.cleanLng(dto.centerLng),
      radiusM: this.cleanRadius(dto.radiusM),
      vehiclePlate: this.cleanPlate(dto.vehiclePlate),
      enabled: dto.enabled === undefined ? true : !!dto.enabled,
      alertOnEnter: dto.alertOnEnter === undefined ? true : !!dto.alertOnEnter,
      alertOnLeave: dto.alertOnLeave === undefined ? true : !!dto.alertOnLeave,
    });
    const saved = await this.repo.save(fence);
    this.invalidate();
    return saved;
  }

  async update(id: string, dto: GeofenceDto): Promise<Geofence> {
    const fence = await this.findById(id);
    if (dto.name !== undefined) fence.name = this.cleanName(dto.name);
    if (dto.centerLat !== undefined) fence.centerLat = this.cleanLat(dto.centerLat);
    if (dto.centerLng !== undefined) fence.centerLng = this.cleanLng(dto.centerLng);
    if (dto.radiusM !== undefined) fence.radiusM = this.cleanRadius(dto.radiusM);
    if (dto.vehiclePlate !== undefined) fence.vehiclePlate = this.cleanPlate(dto.vehiclePlate);
    if (dto.enabled !== undefined) fence.enabled = !!dto.enabled;
    if (dto.alertOnEnter !== undefined) fence.alertOnEnter = !!dto.alertOnEnter;
    if (dto.alertOnLeave !== undefined) fence.alertOnLeave = !!dto.alertOnLeave;
    const saved = await this.repo.save(fence);
    this.invalidate();
    return saved;
  }

  async remove(id: string): Promise<void> {
    await this.findById(id);
    await this.repo.delete(id);
    this.invalidate();
  }

  // ---------- 网关侧 ----------

  invalidate(): void {
    this.cache = null;
  }

  /** 该车牌要比的围栏：绑定了这块车牌的 + 没绑车牌（对全车队生效）的 */
  async fencesFor(plate: string | null | undefined): Promise<Geofence[]> {
    const all = await this.enabledFences();
    if (all.length === 0) return [];
    const key = normalizePlate(plate);
    return all.filter((f) => {
      const bound = normalizePlate(f.vehiclePlate);
      return !bound || bound === key;
    });
  }

  private async enabledFences(): Promise<Geofence[]> {
    if (this.cache && Date.now() - this.cache.at < GEOFENCE_CACHE_MS) return this.cache.fences;
    const fences = await this.repo.find({ where: { enabled: true } });
    this.cache = { fences, at: Date.now() };
    return fences;
  }

  // ---------- 入参清洗 ----------

  private cleanName(value: string | undefined | null): string {
    const name = String(value ?? '').trim();
    if (!name) throw new BadRequestException(ErrorCode.GEOFENCE_NAME_REQUIRED);
    if (name.length > 128) throw new BadRequestException(ErrorCode.GEOFENCE_NAME_TOO_LONG);
    return name;
  }

  /**
   * 只接受真正的数字（或数字字符串）。Number() 会把 null / [] / '' 变成 0、true 变成 1：
   * PATCH 里一个 {"centerLat": null} 就会把围栏悄悄搬到 0,0（几内亚湾），
   * 然后对每辆车都报「驶离围栏」。
   */
  private toNumber(value: unknown): number {
    if (typeof value === 'number') return value;
    if (typeof value === 'string' && value.trim() !== '') return Number(value);
    return NaN;
  }

  private cleanLat(value: unknown): number {
    const n = this.toNumber(value);
    if (!Number.isFinite(n) || Math.abs(n) > 90) throw new BadRequestException(ErrorCode.GEOFENCE_CENTER_INVALID);
    return n;
  }

  private cleanLng(value: unknown): number {
    const n = this.toNumber(value);
    if (!Number.isFinite(n) || Math.abs(n) > 180) throw new BadRequestException(ErrorCode.GEOFENCE_CENTER_INVALID);
    return n;
  }

  private cleanRadius(value: unknown): number {
    const n = this.toNumber(value);
    if (!Number.isFinite(n) || n < MIN_GEOFENCE_RADIUS_M || n > MAX_GEOFENCE_RADIUS_M) {
      throw new BadRequestException(ErrorCode.GEOFENCE_RADIUS_INVALID);
    }
    return Math.round(n);
  }

  private cleanPlate(value: string | undefined | null): string | null {
    const plate = String(value ?? '').trim();
    if (!plate) return null;
    if (plate.length > 32) throw new BadRequestException(ErrorCode.DEVICE_PLATE_TOO_LONG);
    return plate;
  }
}
