import { Controller, Get, Patch, Param, Body, UseGuards } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { GpsAnomaly } from './gps-anomaly.entity';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UserRole } from '../users/user.entity';

@ApiTags('异常管理 / Anomalies')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.DISPATCHER, UserRole.MONITOR)
@Controller('anomalies')
export class AnomaliesController {
  constructor(
    @InjectRepository(GpsAnomaly) private repo: Repository<GpsAnomaly>,
  ) {}

  @Get()
  @ApiOperation({ summary: '获取所有 GPS 异常记录' })
  findAll() {
    return this.repo.find({
      relations: ['driver', 'task'],
      order: { detectedAt: 'DESC' },
      take: 200,
    });
  }

  @Get('unresolved')
  findUnresolved() {
    return this.repo.find({
      where: { resolved: false },
      relations: ['driver', 'task'],
      order: { detectedAt: 'DESC' },
    });
  }

  @Patch(':id/resolve')
  @ApiOperation({ summary: '标记异常已处理' })
  resolve(@Param('id') id: string, @CurrentUser() user: any) {
    return this.markResolved(id, user.id);
  }

  @Patch(':id/ignore')
  @ApiOperation({ summary: '忽略报警（结案）' })
  ignore(@Param('id') id: string, @CurrentUser() user: any) {
    return this.markResolved(id, user.id);
  }

  private async markResolved(id: string, resolvedBy: string) {
    await this.repo.update(id, {
      resolved: true,
      resolvedAt: new Date(),
      resolvedBy,
      snoozeUntil: null as any,
    });
    return this.repo.findOne({ where: { id }, relations: ['driver'] });
  }

  @Patch(':id/snooze')
  @ApiOperation({ summary: '延时报警：延后 N 分钟后若仍未移动则再次报警' })
  async snooze(@Param('id') id: string, @Body('minutes') minutes: number) {
    const delay = Number(minutes) > 0 ? Number(minutes) : 10;
    await this.repo.update(id, {
      snoozeUntil: new Date(Date.now() + delay * 60 * 1000),
    });
    return this.repo.findOne({ where: { id }, relations: ['driver'] });
  }
}
