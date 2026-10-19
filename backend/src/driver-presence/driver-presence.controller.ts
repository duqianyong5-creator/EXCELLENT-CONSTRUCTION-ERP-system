import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { DriverPresenceService } from './driver-presence.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../users/user.entity';

@ApiTags('Driver Presence')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('driver-presence')
export class DriverPresenceController {
  constructor(private service: DriverPresenceService) {}

  @Get('online')
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER, UserRole.MONITOR)
  @ApiOperation({ summary: 'Get currently connected driver app accounts' })
  findOnlineDrivers() {
    return this.service.findOnlineDrivers();
  }
}
