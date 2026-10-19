import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OperationLog } from './operation-log.entity';
import { OperationLogsController } from './operation-logs.controller';
import { OperationLogsService } from './operation-logs.service';

@Module({
  imports: [TypeOrmModule.forFeature([OperationLog])],
  controllers: [OperationLogsController],
  providers: [OperationLogsService],
  exports: [OperationLogsService],
})
export class OperationLogsModule {}
