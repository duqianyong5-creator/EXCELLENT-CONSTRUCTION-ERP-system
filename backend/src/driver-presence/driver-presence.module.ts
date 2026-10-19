import { Module } from '@nestjs/common';
import { DriverPresenceController } from './driver-presence.controller';
import { DriverPresenceService } from './driver-presence.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { UsersModule } from '../users/users.module';
import { GpsModule } from '../gps/gps.module';

@Module({
  imports: [NotificationsModule, UsersModule, GpsModule],
  controllers: [DriverPresenceController],
  providers: [DriverPresenceService],
  exports: [DriverPresenceService],
})
export class DriverPresenceModule {}
