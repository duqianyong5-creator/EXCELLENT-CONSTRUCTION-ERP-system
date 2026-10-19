import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../users/user.entity';
import { OperationLogsService } from './operation-logs.service';

@ApiTags('Operation Logs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('operation-logs')
export class OperationLogsController {
  constructor(private service: OperationLogsService) {}

  @Get()
  @ApiOperation({ summary: 'List recent operation logs' })
  findRecent(@Query('limit') limit?: string) {
    return this.service.findRecent(Number(limit) || 100);
  }
}
