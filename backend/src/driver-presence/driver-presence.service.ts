import { Injectable } from '@nestjs/common';
import { NotificationsGateway } from '../notifications/notifications.gateway';
import { UsersService } from '../users/users.service';
import { GpsService } from '../gps/gps.service';

export interface OnlineDriver {
  id: string;
  username: string;
  fullName: string | null;
  email: string;
}

@Injectable()
export class DriverPresenceService {
  constructor(
    private gateway: NotificationsGateway,
    private usersService: UsersService,
    private gpsService: GpsService,
  ) {}

  async findOnlineDrivers(): Promise<OnlineDriver[]> {
    // 在线 = 有 socket 连接 或 正在上报 GPS（在地图上有最新位置）。
    // 两者取并集，避免「司机在跑、地图有点，但 socket 没连上时显示 0 在线」。
    const onlineIds = new Set(this.gateway.getOnlineDriverIds());
    try {
      const active = await this.gpsService.getLatestPositions();
      active.forEach((p: any) => { if (p?.driverId) onlineIds.add(p.driverId); });
    } catch { /* GPS 取失败不影响 socket 在线统计 */ }

    if (onlineIds.size === 0) return [];

    const drivers = await this.usersService.findDrivers();
    return drivers
      .filter((driver) => onlineIds.has(driver.id))
      .map((driver) => ({
        id: driver.id,
        username: driver.username,
        fullName: driver.fullName ?? null,
        email: driver.email,
      }));
  }
}
