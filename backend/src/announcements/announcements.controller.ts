import {
  Controller, Get, Post, Patch, Delete, Param, Body, UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AnnouncementsService } from './announcements.service';
import { AnnouncementTarget } from './announcement.entity';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UserRole } from '../users/user.entity';

@ApiTags('公告 / Announcements')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('announcements')
export class AnnouncementsController {
  constructor(private service: AnnouncementsService) {}

  // 客户端/司机端：按当前用户角色拉取生效公告（所有登录角色可访问，按角色过滤）
  @Get('feed')
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER, UserRole.DRIVER, UserRole.CLIENT)
  @ApiOperation({ summary: '获取当前用户角色的生效公告' })
  feed(@CurrentUser() user: any) {
    return this.service.feedForRole(user.role);
  }

  @Get()
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER)
  @ApiOperation({ summary: '获取全部公告（管理端）' })
  findAll() {
    return this.service.findAll();
  }

  @Post()
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER)
  @ApiOperation({ summary: '发布公告' })
  create(
    @Body() body: { title: string; content: string; targetRole?: AnnouncementTarget },
    @CurrentUser() user: any,
  ) {
    return this.service.create({ ...body, createdBy: user.id });
  }

  @Patch(':id/active')
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER)
  @ApiOperation({ summary: '启用/停用公告' })
  setActive(@Param('id') id: string, @Body('active') active: boolean) {
    return this.service.setActive(id, !!active);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER)
  @ApiOperation({ summary: '删除公告' })
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
