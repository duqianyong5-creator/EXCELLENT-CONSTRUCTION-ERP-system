import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Task } from './task.entity';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';
import { WorkRecord } from '../work-records/work-record.entity';
import { GpsLog } from '../gps/gps-log.entity';
import { NotificationsModule } from '../notifications/notifications.module';
import { OperationLogsModule } from '../operation-logs/operation-logs.module';
import { SystemSettingsModule } from '../system-settings/system-settings.module';
import { AdjustmentLog } from '../adjustments/adjustment-log.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Task, WorkRecord, GpsLog, AdjustmentLog]), NotificationsModule, OperationLogsModule, SystemSettingsModule],
  controllers: [TasksController],
  providers: [TasksService],
  exports: [TasksService],
})
export class TasksModule {}
