import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../users/user.entity';
import { RucService } from './ruc.service';
import { ErrorCode } from '../common/i18n/messages';

@ApiTags('RUC')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('vehicles')
export class RucController {
  constructor(private service: RucService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER, UserRole.MONITOR)
  @ApiOperation({ summary: '车辆列表（含 RUC 路税状态与里程估算）' })
  list() {
    return this.service.listWithStatus();
  }

  @Post()
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER)
  @ApiOperation({ summary: '登记车辆' })
  create(@Body() body: { plate: string; label?: string }) {
    return this.service.create(body);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER)
  update(@Param('id') id: string, @Body() body: { label?: string; enabled?: boolean }) {
    return this.service.update(id, body);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  async remove(@Param('id') id: string) {
    await this.service.remove(id);
    return { ok: true };
  }

  @Post(':id/ruc')
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER)
  @ApiOperation({ summary: '登记一张已购买的 RUC 许可（起止里程以许可上的数字为准）' })
  recordLicence(
    @Param('id') id: string,
    @Body() body: { licenceNo?: string; startKm: number; endKm: number; purchasedAt?: string },
  ) {
    const purchasedAt = body.purchasedAt ? new Date(body.purchasedAt) : undefined;
    if (purchasedAt && Number.isNaN(purchasedAt.getTime())) {
      throw new BadRequestException(ErrorCode.RUC_PURCHASE_DATE_INVALID);
    }
    return this.service.recordLicence(id, {
      licenceNo: body.licenceNo,
      startKm: Number(body.startKm),
      endKm: Number(body.endKm),
      purchasedAt,
    });
  }

  @Post(':id/odometer')
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER)
  @ApiOperation({ summary: '按车上 hubodometer 实际读数校准里程（系统里的里程是估算值）' })
  calibrate(@Param('id') id: string, @Body() body: { odometerKm: number }) {
    return this.service.calibrate(id, Number(body.odometerKm));
  }
}
