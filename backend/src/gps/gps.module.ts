import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GpsLog } from './gps-log.entity';
import { GpsAnomaly } from './gps-anomaly.entity';
import { GpsController } from './gps.controller';
import { GpsService } from './gps.service';
import { GpsAlarmService } from './gps-alarm.service';
import { GpsCleanupService } from './gps-cleanup.service';
import { GpsAnomalySchemaGuard } from './gps-anomaly.schema';
import { AnomaliesController } from './anomalies.controller';
import { NotificationsModule } from '../notifications/notifications.module';
import { SystemSettingsModule } from '../system-settings/system-settings.module';
import { Task } from '../tasks/task.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([GpsLog, GpsAnomaly, Task]),
    NotificationsModule,
    SystemSettingsModule,
  ],
  controllers: [GpsController, AnomaliesController],
  providers: [GpsAnomalySchemaGuard, GpsService, GpsAlarmService, GpsCleanupService],
  exports: [GpsService, TypeOrmModule],
})
export class GpsModule {}
