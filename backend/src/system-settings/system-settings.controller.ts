import { Controller, Get, Put, Post, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { SystemSettingsService } from './system-settings.service';
import { OperationLogsService } from '../operation-logs/operation-logs.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UserRole } from '../users/user.entity';

@ApiTags('系统设置 / System Settings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('system-settings')
export class SystemSettingsController {
  constructor(
    private service: SystemSettingsService,
    private operationLogs: OperationLogsService,
  ) {}

  @Get()
  @ApiOperation({ summary: '获取全部系统设置' })
  getAll() {
    return this.service.getAll();
  }

  @Put()
  @ApiOperation({ summary: '更新系统设置' })
  update(@Body() body: Record<string, string>) {
    return this.service.setMany(body || {});
  }

  @Post('clear-data')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: '清空业务数据（需要密码）' })
  async clearData(@Body('password') password: string, @CurrentUser() user: any) {
    const result = await this.service.clearData(password || '');
    await this.operationLogs.record({
      actorId: user.id,
      actorName: user.fullName || user.username || user.email || user.id,
      action: 'system.clear-data',
      targetType: 'system',
      targetId: 'business-data',
      description: 'Cleared all business data',
      details: { cleared: result.cleared },
    });
    return result;
  }
}
