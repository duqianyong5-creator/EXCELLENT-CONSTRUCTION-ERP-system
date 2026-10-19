import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Vehicle } from './vehicle.entity';
import { RucService } from './ruc.service';
import { RucController } from './ruc.controller';
import { RucSchemaGuard } from './ruc.schema';
import { NotificationsModule } from '../notifications/notifications.module';
import { SystemSettingsModule } from '../system-settings/system-settings.module';

/** 车辆档案 + 新西兰 RUC 路税提醒 */
@Module({
  imports: [TypeOrmModule.forFeature([Vehicle]), NotificationsModule, SystemSettingsModule],
  controllers: [RucController],
  providers: [RucSchemaGuard, RucService],
  exports: [RucService],
})
export class RucModule {}
