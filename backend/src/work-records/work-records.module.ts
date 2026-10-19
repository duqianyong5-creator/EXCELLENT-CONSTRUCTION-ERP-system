import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WorkRecord } from './work-record.entity';
import { WorkRecordsController } from './work-records.controller';
import { WorkRecordsService } from './work-records.service';
import { StorageModule } from '../common/services/storage.module';

@Module({
  imports: [TypeOrmModule.forFeature([WorkRecord]), StorageModule],
  controllers: [WorkRecordsController],
  providers: [WorkRecordsService],
  exports: [WorkRecordsService],
})
export class WorkRecordsModule {}
