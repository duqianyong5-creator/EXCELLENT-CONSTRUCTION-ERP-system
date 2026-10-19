import {
  Controller, Get, Post, Patch, Delete, Body, Param,
  UseGuards, UseInterceptors, UploadedFiles,
  HttpCode, HttpStatus, NotFoundException, BadRequestException,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { TasksService } from './tasks.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { StorageService } from '../common/services/storage.service';
import { ErrorCode } from '../common/i18n/messages';
import { UserRole } from '../users/user.entity';

@ApiTags('任务管理 / Tasks')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('tasks')
export class TasksController {
  constructor(
    private service: TasksService,
    private storage: StorageService,
  ) {}

  @Get()
  @ApiOperation({ summary: '获取任务列表（按角色过滤）' })
  findAll(@CurrentUser() user: any) {
    return this.service.findAll(user);
  }

  @Get('today')
  @Roles(UserRole.DRIVER)
  @ApiOperation({ summary: '司机今日任务' })
  todayTasks(@CurrentUser() user: any) {
    return this.service.findTodayTasks(user.id);
  }

  @Get('stats')
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER, UserRole.MONITOR)
  getStats() {
    return this.service.getStats();
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.findById(id, user);
  }

  @Post()
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER)
  @ApiOperation({ summary: '创建任务' })
  create(@Body() body: any, @CurrentUser() user: any) {
    return this.service.create(body, user);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER)
  update(@Param('id') id: string, @Body() body: any, @CurrentUser() user: any) {
    return this.service.update(id, body, user);
  }

  @Patch(':id/assign')
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER)
  @ApiOperation({ summary: '分配司机' })
  assign(@Param('id') id: string, @Body('driverId') driverId: string, @CurrentUser() user: any) {
    return this.service.assign(id, driverId, user);
  }

  @Post(':id/start')
  @Roles(UserRole.DRIVER)
  @ApiOperation({ summary: '开始任务' })
  startTask(@Param('id') id: string, @CurrentUser() user: any, @Body('vehiclePlate') vehiclePlate?: string) {
    return this.service.startTask(id, user.id, vehiclePlate);
  }

  @Post(':id/complete')
  @Roles(UserRole.DRIVER)
  // multipart 不走 express 的 JSON body 上限，没有 limits 的话 5 个文件可以是任意大小、
  // 并且整个读进内存 —— 一个司机账号就能把进程撑爆（API 和定位器网关同进程）。
  // 手机拍的工地照片压缩后通常 1~3MB，10MB 一张足够。
  @UseInterceptors(FilesInterceptor('images', 5, {
    storage: memoryStorage(),
    // fieldSize：文本字段（完工备注）默认上限 1MB，一条记录就能塞进 1MB 文字；4KB 足够
    limits: { fileSize: 10 * 1024 * 1024, files: 5, fields: 10, fieldSize: 4 * 1024 },
    fileFilter: (_req, file, cb) => {
      const ok = /^image\/(jpeg|png|webp|heic|heif)$/i.test(file.mimetype);
      cb(ok ? null : new BadRequestException(ErrorCode.UPLOAD_IMAGE_ONLY), ok);
    },
  }))
  @ApiOperation({ summary: '完成任务（上传工作记录照片到 Supabase Storage）' })
  async completeTask(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Body('notes') notes: string,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    const imageUrls = files?.length
      ? await this.storage.uploadMany(files, 'work-records')
      : [];
    return this.service.completeTask(id, user.id, { notes, imageUrls });
  }

  @Patch(':id/cancel')
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER)
  cancel(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.cancel(id, user);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '删除任务' })
  delete(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.delete(id, user);
  }

}
