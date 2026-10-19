import { Controller, Post, Get, Body, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AdjustmentsService } from './adjustments.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UserRole } from '../users/user.entity';

@ApiTags('工时调整 / Adjustments')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.DISPATCHER)
@Controller('adjustments')
export class AdjustmentsController {
  constructor(private service: AdjustmentsService) {}

  private actorName(user: any): string {
    return user?.fullName || user?.username || user?.email || user?.id;
  }

  @Post()
  @ApiOperation({ summary: '调整工时 (+30min / +60min)' })
  addAdjustment(
    @Body() body: {
      workRecordId: string;
      driverId: string;
      taskId: string;
      addedMinutes: number;
      reason?: string;
    },
    @CurrentUser() user: any,
  ) {
    return this.service.addAdjustment({ ...body, operatorId: user.id, operatorName: this.actorName(user) });
  }

  @Post('set-final')
  @ApiOperation({ summary: '手动设置最终工时（分钟）' })
  setFinal(
    @Body() body: { workRecordId: string; finalMinutes: number },
    @CurrentUser() user: any,
  ) {
    return this.service.setFinalDuration(body.workRecordId, body.finalMinutes, user.id, this.actorName(user));
  }

  @Get('logs')
  @ApiOperation({ summary: '获取调整日志' })
  getLogs(
    @Query('taskId') taskId?: string,
    @Query('driverId') driverId?: string,
  ) {
    return this.service.getLogs(taskId, driverId);
  }
}
