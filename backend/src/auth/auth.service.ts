import { Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { UsersService } from '../users/users.service';
import { UserRole, UserStatus } from '../users/user.entity';
import { RegisterDto } from './dto/register.dto';
import { OperationLogsService } from '../operation-logs/operation-logs.service';
import { ErrorCode } from '../common/i18n/messages';

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    private operationLogs: OperationLogsService,
  ) {}

  async validateUser(identifier: string, password: string) {
    // 提示语中英双写：司机端可切英文，网页端也有英文界面，后端只有一种文案时另一边会看不懂
    const user = await this.usersService.findByEmailOrUsername(identifier);
    if (!user) throw new UnauthorizedException(ErrorCode.AUTH_ACCOUNT_NOT_FOUND);

    if (user.status === UserStatus.PENDING) {
      throw new UnauthorizedException(ErrorCode.AUTH_PENDING);
    }
    if (user.status === UserStatus.REJECTED) {
      throw new UnauthorizedException(ErrorCode.AUTH_REJECTED);
    }
    if (user.status === UserStatus.DISABLED) {
      throw new UnauthorizedException(ErrorCode.AUTH_DISABLED);
    }

    const userWithPassword = await this.usersService.findWithPassword(user.id);
    const isMatch = await bcrypt.compare(password, userWithPassword.password);
    if (!isMatch) throw new UnauthorizedException(ErrorCode.AUTH_WRONG_PASSWORD);

    return user;
  }

  async login(user: any) {
    const payload = { sub: user.id, role: user.role, username: user.username };
    await this.operationLogs.record({
      actorId: user.id,
      actorName: user.fullName || user.username || user.email || user.id,
      action: 'auth.login',
      targetType: 'user',
      targetId: user.id,
      description: 'User logged in',
      details: { role: user.role },
    });
    return {
      access_token: this.jwtService.sign(payload),
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        fullName: user.fullName,
        language: user.language,
        avatarUrl: user.avatarUrl,
      },
    };
  }

  async register(dto: RegisterDto) {
    const existing = await this.usersService.findByEmailOrUsername(dto.email);
    if (existing) throw new BadRequestException('邮箱已被注册');

    const existingUsername = await this.usersService.findByEmailOrUsername(dto.username);
    if (existingUsername) throw new BadRequestException('用户名已被使用');

    if (dto.role === UserRole.ADMIN || dto.role === UserRole.DISPATCHER || dto.role === UserRole.MONITOR) {
      throw new BadRequestException('无法自行注册该角色');
    }

    const hashed = await bcrypt.hash(dto.password, 12);
    const user = await this.usersService.create({
      ...dto,
      password: hashed,
      status: UserStatus.PENDING,
    });

    return { message: '注册成功，等待管理员审核', userId: user.id };
  }
}
