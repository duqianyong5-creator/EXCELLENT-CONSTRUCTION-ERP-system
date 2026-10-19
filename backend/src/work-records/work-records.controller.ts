import { Controller, Get, Delete, Param, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { WorkRecordsService } from './work-records.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UserRole } from '../users/user.entity';

@ApiTags('工时记录 / Work Records')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('work-records')
export class WorkRecordsController {
  constructor(private service: WorkRecordsService) {}

  @Get()
  @ApiOperation({ summary: '获取工时记录列表' })
  findAll(@CurrentUser() user: any) {
    return this.service.findAll(user);
  }

  @Get('task/:taskId')
  @ApiOperation({ summary: '按任务获取工时' })
  findByTask(@Param('taskId') taskId: string, @CurrentUser() user: any) {
    return this.service.findByTask(taskId, user);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.findById(id, user);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '删除工时记录' })
  delete(@Param('id') id: string) {
    return this.service.delete(id);
  }
}
