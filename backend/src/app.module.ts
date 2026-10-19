import { Module, Get, Controller } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { TasksModule } from './tasks/tasks.module';
import { GpsModule } from './gps/gps.module';
import { WorkRecordsModule } from './work-records/work-records.module';
import { AdjustmentsModule } from './adjustments/adjustments.module';
import { NotificationsModule } from './notifications/notifications.module';
import { OperationLogsModule } from './operation-logs/operation-logs.module';
import { StorageModule } from './common/services/storage.module';
import { DriverPresenceModule } from './driver-presence/driver-presence.module';
import { SystemSettingsModule } from './system-settings/system-settings.module';
import { AnnouncementsModule } from './announcements/announcements.module';
import { GpsDeviceModule } from './gps-device/gps-device.module';
import { RucModule } from './ruc/ruc.module';
import { getConfig } from './config/security.config';

@Controller()
class AppController {
  @Get('ping')
  ping() {
    return { status: 'ok', time: new Date().toISOString() };
  }
}

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => {
        return {
          type: 'postgres' as const,
          host: getConfig(config, ['DB_HOST', 'DATABASE_HOST']),
          port: Number(getConfig(config, ['DB_PORT', 'DATABASE_PORT']) || 5432),
          username: getConfig(config, ['DB_USER', 'DATABASE_USER']),
          password: getConfig(config, ['DB_PASSWORD', 'DATABASE_PASSWORD']),
          database: getConfig(config, ['DB_NAME', 'DATABASE_NAME']) || 'postgres',
          autoLoadEntities: true,
          synchronize: config.get<string>('NODE_ENV') !== 'production',
          ssl: { rejectUnauthorized: false },
          logging: false,
        };
      },
      inject: [ConfigService],
    }),
    ScheduleModule.forRoot(),
    // 限流配置（默认较宽松，仅作兜底；登录/注册/清空数据等敏感接口用 @Throttle 单独收紧）
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 120 }]),
    AuthModule,
    UsersModule,
    TasksModule,
    GpsModule,
    WorkRecordsModule,
    AdjustmentsModule,
    NotificationsModule,
    OperationLogsModule,
    StorageModule,
    DriverPresenceModule,
    SystemSettingsModule,
    AnnouncementsModule,
    GpsDeviceModule,
    RucModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
