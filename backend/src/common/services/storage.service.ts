import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import { sniffImage } from './image-sniff';
import { objectPathOf } from './storage-path';
import { ErrorCode } from '../i18n/messages';

/** 签名链接有效期：够看完一次工时详情，又不至于转发出去长期可用 */
const SIGNED_URL_TTL_SECONDS = 60 * 60;

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private supabase: SupabaseClient | null = null;
  private bucket: string;

  constructor(private config: ConfigService) {
    const url = config.get<string>('SUPABASE_URL');
    const key = config.get<string>('SUPABASE_SERVICE_KEY');
    this.bucket = config.get<string>('SUPABASE_STORAGE_BUCKET', 'truck-uploads');

    if (url && key) {
      this.supabase = createClient(url, key);
      this.ensureBucket();
    } else {
      this.logger.warn('Supabase Storage 未配置，将使用本地存储');
    }
  }

  private async ensureBucket() {
    if (!this.supabase) return;
    const { data: buckets } = await this.supabase.storage.listBuckets();
    const exists = buckets?.some((b) => b.name === this.bucket);
    if (!exists) {
      await this.supabase.storage.createBucket(this.bucket, { public: false });
      this.logger.log(`Supabase Storage Bucket "${this.bucket}" 已创建（私有，按需签名访问）`);
      return;
    }
    // 已存在的桶不自动改权限——那是生产数据的可见性，交给人决定。
    // 但要提醒：公开桶意味着拿到 URL 的任何人都能永久查看工地照片。
    const current = buckets?.find((b) => b.name === this.bucket);
    if (current?.public) {
      this.logger.warn(
        `Storage bucket "${this.bucket}" is public: anyone with a photo URL can view it forever. ` +
          'Signed URLs are already served, so it is safe to switch the bucket to private in Supabase.',
      );
    }
  }

  async upload(
    file: Express.Multer.File,
    folder = 'work-records',
  ): Promise<string> {
    // 扩展名和 Content-Type 一律按文件内容判定，不采信客户端给的值。
    // 否则一个司机账号就能把 .html / .svg 存进公开桶，用公司域名做钓鱼页；
    // 走本地存储兜底时更糟——那是和 API 同源提供的，等于存储型 XSS。
    const sniffed = sniffImage(file.buffer);
    if (!sniffed) {
      throw new BadRequestException(ErrorCode.UPLOAD_IMAGE_ONLY);
    }
    const { ext, contentType } = sniffed;
    const filename = `${folder}/${randomUUID()}${ext}`;

    if (this.supabase) {
      const { data, error } = await this.supabase.storage
        .from(this.bucket)
        .upload(filename, file.buffer, {
          contentType,
          upsert: false,
        });

      if (error) throw new Error(`Supabase Storage 上传失败: ${error.message}`);

      // 存对象路径而不是公开 URL：读取时现签短期链接。
      // 存公开 URL 的话，这个地址一旦外泄就永久有效、收不回来。
      return data.path;
    }

    // 本地存储备用
    const fs = require('fs');
    const path = require('path');
    const uploadDir = './uploads';
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    const localPath = path.join(uploadDir, `${randomUUID()}${ext}`);
    fs.writeFileSync(localPath, file.buffer);
    return `/uploads/${path.basename(localPath)}`;
  }

  async uploadMany(files: Express.Multer.File[], folder = 'work-records'): Promise<string[]> {
    return Promise.all(files.map((f) => this.upload(f, folder)));
  }

  /**
   * 把存起来的值换成一个可以直接访问的地址。
   *
   * 兼容三种历史形态（见 storage-path.ts）：旧的公开 URL、之前签过的 URL、新的裸路径。
   * 本地存储兜底的 /uploads/... 原样返回。签不出来时也返回原值——
   * 宁可这张照片打不开，也不要让整个工时列表报错。
   */
  async signUrl(stored: string): Promise<string> {
    if (!this.supabase) return stored;
    const path = objectPathOf(stored, this.bucket);
    if (!path) return stored;
    try {
      const { data, error } = await this.supabase.storage
        .from(this.bucket)
        .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
      if (error || !data?.signedUrl) {
        this.logger.warn(`failed to sign ${path}: ${error?.message || 'no url returned'}`);
        return stored;
      }
      return data.signedUrl;
    } catch (e: any) {
      this.logger.warn(`failed to sign ${path}: ${e?.message || e}`);
      return stored;
    }
  }

  async signUrls(stored: string[] | null | undefined): Promise<string[]> {
    if (!Array.isArray(stored) || stored.length === 0) return [];
    return Promise.all(stored.map((s) => this.signUrl(s)));
  }

  async delete(url: string): Promise<void> {
    if (!this.supabase) return;
    const path = objectPathOf(url, this.bucket);
    if (path) await this.supabase.storage.from(this.bucket).remove([path]);
  }
}
