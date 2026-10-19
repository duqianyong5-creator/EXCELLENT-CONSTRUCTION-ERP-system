import {
  Controller, Get, Post, Patch, Delete, Body, Param,
  UseGuards, Query, BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UserRole, UserStatus } from './user.entity';
import { OperationLogsService } from '../operation-logs/operation-logs.service';

@ApiTags('用户管理 / Users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('users')
export class UsersController {
  constructor(
    private service: UsersService,
    private operationLogs: OperationLogsService,
  ) {}

  private actorName(user: any): string {
    return user?.fullName || user?.username || user?.email || user?.id;
  }

  @Get()
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER)
  @ApiOperation({ summary: '获取用户列表' })
  findAll(
    @Query('role') role?: UserRole,
    @Query('status') status?: UserStatus,
  ) {
    return this.service.findAll({ role, status });
  }

  @Get('drivers')
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER)
  findDrivers() {
    return this.service.findDrivers();
  }

  @Get('clients')
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER)
  findClients() {
    return this.service.findClients();
  }

  @Get('pending')
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER)
  getPending() {
    return this.service.findAll({ status: UserStatus.PENDING });
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER)
  findOne(@Param('id') id: string) {
    return this.service.findById(id);
  }

  @Post()
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '管理员直接创建用户' })
  async create(@Body() body: any, @CurrentUser() user?: any) {
    const existing = await this.service.findByEmailOrUsername(body.username);
    if (existing) throw new BadRequestException('用户名已被使用');
    const existingEmail = await this.service.findByEmailOrUsername(body.email);
    if (existingEmail) throw new BadRequestException('邮箱已被注册');

    if (!body.password || body.password.length < 6) {
      throw new BadRequestException('Password must be at least 6 characters');
    }

    const bcrypt = require('bcrypt');
    const hashed = await bcrypt.hash(body.password, 12);
    const created = await this.service.create({
      ...body,
      password: hashed,
      status: UserStatus.ACTIVE,
      approvedAt: new Date(),
    });
    if (user) {
      await this.operationLogs.record({
        actorId: user.id,
        actorName: this.actorName(user),
        action: 'users.create',
        targetType: 'user',
        targetId: created.id,
        description: `Created user ${created.username}`,
        details: { role: created.role, status: created.status },
      });
    }
    return created;
  }

  @Patch(':id/approve')
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER)
  async approve(@Param('id') id: string, @CurrentUser() user: any) {
    const updated = await this.service.approve(id, user.id);
    await this.operationLogs.record({
      actorId: user.id,
      actorName: this.actorName(user),
      action: 'users.approve',
      targetType: 'user',
      targetId: id,
      description: `Approved user ${updated.username}`,
      details: { status: updated.status },
    });
    return updated;
  }

  @Patch(':id/reject')
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER)
  async reject(@Param('id') id: string, @CurrentUser() user: any) {
    const updated = await this.service.reject(id);
    await this.operationLogs.record({
      actorId: user.id,
      actorName: this.actorName(user),
      action: 'users.reject',
      targetType: 'user',
      targetId: id,
      description: `Rejected user ${updated.username}`,
      details: { status: updated.status },
    });
    return updated;
  }

  @Patch(':id/disable')
  @Roles(UserRole.ADMIN)
  async disable(@Param('id') id: string, @CurrentUser() user: any) {
    const updated = await this.service.disable(id);
    await this.operationLogs.record({
      actorId: user.id,
      actorName: this.actorName(user),
      action: 'users.disable',
      targetType: 'user',
      targetId: id,
      description: `Disabled user ${updated.username}`,
      details: { status: updated.status },
    });
    return updated;
  }

  @Patch(':id/enable')
  @Roles(UserRole.ADMIN)
  async enable(@Param('id') id: string, @CurrentUser() user: any) {
    const updated = await this.service.enable(id);
    await this.operationLogs.record({
      actorId: user.id,
      actorName: this.actorName(user),
      action: 'users.enable',
      targetType: 'user',
      targetId: id,
      description: `Enabled user ${updated.username}`,
      details: { status: updated.status },
    });
    return updated;
  }

  @Patch(':id/role')
  @Roles(UserRole.ADMIN)
  async updateRole(@Param('id') id: string, @Body('role') role: UserRole, @CurrentUser() user: any) {
    const updated = await this.service.updateRole(id, role);
    await this.operationLogs.record({
      actorId: user.id,
      actorName: this.actorName(user),
      action: 'users.update-role',
      targetType: 'user',
      targetId: id,
      description: `Updated user role for ${updated.username}`,
      details: { role: updated.role },
    });
    return updated;
  }

  // 注意：以下静态路径必须排在 @Patch(':id') 之前。
  // Nest 按声明顺序注册，':id' 会把 /users/profile、/users/change-password 当成 id 吃掉。
  @Patch('profile')
  @ApiOperation({ summary: '更新个人资料' })
  updateProfile(@CurrentUser() user: any, @Body() body: any) {
    const { password, role, status, ...safe } = body;
    return this.service.updateProfile(user.id, safe);
  }

  @Patch('change-password')
  @ApiOperation({ summary: '修改密码' })
  async changePassword(
    @CurrentUser() user: any,
    @Body('oldPassword') oldPassword: string,
    @Body('newPassword') newPassword: string,
  ) {
    const result = await this.service.changePassword(user.id, oldPassword, newPassword);
    await this.operationLogs.record({
      actorId: user.id,
      actorName: this.actorName(user),
      action: 'users.change-password',
      targetType: 'user',
      targetId: user.id,
      description: 'Changed own password',
      details: {},
    });
    return result;
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN)
  async updateUser(@Param('id') id: string, @Body() body: any, @CurrentUser() user: any) {
    if (id === user.id) {
      throw new BadRequestException('Cannot edit your own account from user management');
    }

    const allowed = {
      username: typeof body.username === 'string' ? body.username.trim() : body.username,
      email: typeof body.email === 'string' ? body.email.trim() : body.email,
      fullName: body.fullName,
      phone: body.phone,
      role: body.role,
      status: body.status,
    };

    if (!allowed.username) {
      throw new BadRequestException('Username is required');
    }
    if (!allowed.email) {
      throw new BadRequestException('Email is required');
    }

    const updated = await this.service.updateUser(id, allowed);
    await this.operationLogs.record({
      actorId: user.id,
      actorName: this.actorName(user),
      action: 'users.update',
      targetType: 'user',
      targetId: id,
      description: `Updated user ${updated.username}`,
      details: { fields: Object.keys(allowed) },
    });
    return updated;
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '删除用户（仅管理员）' })
  deleteUser(@Param('id') id: string, @CurrentUser() me: any) {
    if (id === me.id) throw new BadRequestException('不能删除自己的账户');
    return this.service.delete(id);
  }

  @Patch(':id/reset-password')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '管理员重置用户密码' })
  async resetPassword(
    @Param('id') id: string,
    @Body('newPassword') newPassword: string,
    @CurrentUser() user: any,
  ) {
    if (id === user.id) {
      throw new BadRequestException('Cannot reset your own password from user management');
    }

    if (!newPassword || newPassword.length < 6) {
      throw new BadRequestException('密码长度不能少于6位');
    }
    const result = await this.service.resetPassword(id, newPassword);
    await this.operationLogs.record({
      actorId: user.id,
      actorName: this.actorName(user),
      action: 'users.reset-password',
      targetType: 'user',
      targetId: id,
      description: 'Reset user password',
      details: {},
    });
    return result;
  }
}
