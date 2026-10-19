import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UserRole } from '../users/user.entity';
import { GpsDeviceService } from './gps-device.service';
import { Jt808Server } from './jt808.server';

@ApiTags('GPS Devices')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('gps-devices')
export class GpsDeviceController {
  constructor(
    private service: GpsDeviceService,
    private server: Jt808Server,
  ) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER, UserRole.MONITOR)
  @ApiOperation({ summary: '车载定位器列表（含在线状态与当前任务）' })
  async list(@CurrentUser() user: { role: UserRole }) {
    const [devices, online] = [await this.service.listWithTasks(), this.server.getOnline()];
    const onlineMap = new Map(online.map((o) => [o.deviceNo, o]));
    // 监控（大屏）账号常年登录、路过的人都看得到：SIM 卡号和设备来源地址不给它
    const full = user.role !== UserRole.MONITOR;
    return devices.map(({ iccid, ...d }) => {
      const conn = onlineMap.get(d.deviceNo);
      return {
        ...d,
        ...(full ? { iccid } : {}),
        online: !!conn,
        connection: conn ? (full ? conn : { tzOffset: conn.tzOffset }) : null,
      };
    });
  }

  @Get('plates')
  @Roles(UserRole.DRIVER, UserRole.ADMIN, UserRole.DISPATCHER)
  @ApiOperation({ summary: '已登记车牌（司机接单时快速选择，避免手输打错对不上设备）' })
  plates() {
    return this.service.plates();
  }

  @Get('gateway')
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER)
  @ApiOperation({ summary: '网关状态（监听端口、在线数、未登记设备尝试）' })
  gateway() {
    return {
      port: this.server.getPort(),
      error: this.server.getStartError(),
      online: this.server.getOnline(),
      unregistered: this.server.getUnregistered(),
    };
  }

  @Post()
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER)
  @ApiOperation({ summary: '登记定位器（设备号 + 车牌）' })
  async create(@Body() body: { deviceNo: string; vehiclePlate?: string; name?: string; enabled?: boolean; iccid?: string }) {
    const device = await this.service.create(body);
    this.server.clearUnregistered(device.deviceNo);
    return device;
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER)
  update(@Param('id') id: string, @Body() body: { vehiclePlate?: string; name?: string; enabled?: boolean; iccid?: string }) {
    return this.service.update(id, body);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  async remove(@Param('id') id: string) {
    await this.service.remove(id);
    return { ok: true };
  }

  @Post(':id/command')
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER)
  @ApiOperation({ summary: '下发指令：reboot / realtime(实时模式) / locate(立即定位) / set_server' })
  async command(
    @Param('id') id: string,
    @CurrentUser() user: { id: string; role: UserRole },
    @Body() body: { type: 'reboot' | 'realtime' | 'locate' | 'set_server'; intervalSec?: number; tzOffset?: number; host?: string; port?: number },
  ) {
    const device = await this.service.findById(id);
    switch (body?.type) {
      case 'reboot': this.server.reboot(device.deviceNo); break;
      case 'realtime': {
        const tz = body.tzOffset;
        if (tz !== undefined && (!Number.isFinite(tz) || Math.abs(tz) > 14)) throw new BadRequestException('tzOffset out of range');
        this.server.setRealtimeMode(device.deviceNo, Number(body.intervalSec) || 10, tz);
        break;
      }
      case 'locate': this.server.queryPosition(device.deviceNo); break;
      case 'set_server': {
        // 改服务器地址会让设备脱离本平台，只允许管理员
        if (user.role !== UserRole.ADMIN) throw new ForbiddenException('仅管理员可修改设备服务器地址');
        const host = String(body.host || '').trim();
        const port = Number(body.port);
        if (!/^[A-Za-z0-9.-]{1,64}$/.test(host) || !Number.isInteger(port) || port < 1 || port > 65535) {
          throw new BadRequestException('host/port invalid');
        }
        this.server.setServer(device.deviceNo, host, port);
        break;
      }
      default: throw new BadRequestException('unknown command');
    }
    return { ok: true, sent: body.type };
  }
}
