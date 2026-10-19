import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GpsDevice } from './gps-device.entity';
import { Geofence } from './geofence.entity';
import { GpsDeviceService } from './gps-device.service';
import { GpsDeviceController } from './gps-device.controller';
import { GeofenceService } from './geofence.service';
import { GeofenceController } from './geofence.controller';
import { DeviceAlarmService } from './device-alarm.service';
import { Jt808Server } from './jt808.server';
import { DeviceOfflineWatcher } from './device-offline.watcher';
import { GpsDeviceSchemaGuard } from './gps-device.schema';
import { GpsModule } from '../gps/gps.module';
import { RucModule } from '../ruc/ruc.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { Task } from '../tasks/task.entity';

/** 车载 JT808 定位器接入：TCP 网关 + 设备登记管理 + 报警 / 电子围栏 */
@Module({
  imports: [
    TypeOrmModule.forFeature([GpsDevice, Geofence, Task]),
    GpsModule, // 顺带带来 GpsAnomaly 仓库（报警记录与「异常管理」页共用一张表）
    RucModule,
    NotificationsModule,
  ],
  controllers: [GpsDeviceController, GeofenceController],
  providers: [GpsDeviceSchemaGuard, GpsDeviceService, GeofenceService, DeviceAlarmService, Jt808Server, DeviceOfflineWatcher],
  exports: [GpsDeviceService, GeofenceService, Jt808Server],
})
export class GpsDeviceModule {}
