import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../users/user.entity';
import { GeofenceService, GeofenceDto } from './geofence.service';

/**
 * 电子围栏管理。
 *
 * 权限与 gps-devices 保持一致：管理员 + 调度可增删改，监控可看。
 * 围栏是平台侧判定的，不会改写设备参数，所以不像 set_server 那样限死管理员；
 * 删除仍然只给管理员，和设备删除对齐。
 */
@ApiTags('电子围栏 / Geofences')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('geofences')
export class GeofenceController {
  constructor(private service: GeofenceService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER, UserRole.MONITOR)
  @ApiOperation({ summary: '围栏列表' })
  list() {
    return this.service.list();
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER, UserRole.MONITOR)
  findOne(@Param('id') id: string) {
    return this.service.findById(id);
  }

  @Post()
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER)
  @ApiOperation({ summary: '新建圆形围栏（圆心经纬度 + 半径米；车牌留空为全车队）' })
  create(@Body() body: GeofenceDto) {
    return this.service.create(body);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER)
  update(@Param('id') id: string, @Body() body: GeofenceDto) {
    return this.service.update(id, body);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  async remove(@Param('id') id: string) {
    await this.service.remove(id);
    return { ok: true };
  }
}
