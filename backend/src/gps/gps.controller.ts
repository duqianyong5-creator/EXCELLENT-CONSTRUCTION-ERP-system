import { Controller, Post, Get, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { GpsService } from './gps.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UserRole } from '../users/user.entity';

@ApiTags('GPS')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('gps')
export class GpsController {
  constructor(private service: GpsService) {}

  @Post('upload')
  @Roles(UserRole.DRIVER)
  @ApiOperation({ summary: '上传 GPS 坐标（每10秒一次）' })
  upload(
    @CurrentUser() user: any,
    @Body() body: {
      taskId: string;
      latitude: number;
      longitude: number;
      speed: number;
      heading?: number;
      accuracy?: number;
    },
  ) {
    return this.service.upload(user.id, body.taskId, body);
  }

  @Get('track/:taskId')
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER, UserRole.MONITOR, UserRole.CLIENT, UserRole.DRIVER)
  @ApiOperation({ summary: '获取任务GPS轨迹（按归属鉴权）' })
  getTrack(@Param('taskId') taskId: string, @CurrentUser() user: any) {
    return this.service.getTrackForUser(taskId, user);
  }

  @Get('positions')
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER, UserRole.MONITOR)
  @ApiOperation({ summary: '获取所有司机最新位置（地图用）' })
  getPositions() {
    return this.service.getLatestPositions();
  }

  @Get('client-positions')
  @Roles(UserRole.CLIENT)
  @ApiOperation({ summary: '客户获取其名下任务对应司机的最新位置' })
  getClientPositions(@CurrentUser() user: any) {
    return this.service.getClientDriverPositions(user.id);
  }

  @Get('driver/:driverId/position')
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER, UserRole.MONITOR, UserRole.CLIENT, UserRole.DRIVER)
  @ApiOperation({ summary: '获取指定司机最新位置（按归属鉴权）' })
  getDriverPosition(@Param('driverId') driverId: string, @CurrentUser() user: any) {
    return this.service.getDriverPositionForUser(driverId, user);
  }
}
