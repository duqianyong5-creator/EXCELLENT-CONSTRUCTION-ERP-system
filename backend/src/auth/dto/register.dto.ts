import { IsEmail, IsString, MinLength, IsEnum, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { UserRole } from '../../users/user.entity';

export class RegisterDto {
  @ApiProperty({ example: 'driver001' })
  @IsString()
  @MinLength(3)
  username: string;

  @ApiProperty({ example: 'driver@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'Password123!' })
  @IsString()
  @MinLength(8)
  password: string;

  @ApiProperty({ enum: [UserRole.DRIVER, UserRole.CLIENT], default: UserRole.DRIVER })
  @IsEnum([UserRole.DRIVER, UserRole.CLIENT])
  role: UserRole;

  @ApiProperty({ example: '张三', required: false })
  @IsOptional()
  @IsString()
  fullName?: string;

  @ApiProperty({ example: '13800138000', required: false })
  @IsOptional()
  @IsString()
  phone?: string;
}
