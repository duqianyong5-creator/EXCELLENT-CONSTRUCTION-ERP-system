// 必须最先执行：在任何数据库连接建立之前把「不带时区」的时间列固定成 UTC（原因见文件内说明）
import './config/pg-utc';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { join } from 'path';
import * as os from 'os';
import { AppModule } from './app.module';
import helmet from 'helmet';
import { createCorsOriginResolver } from './config/security.config';
import { securityHeaders } from './config/security-headers.config';
import { I18nExceptionFilter } from './common/filters/i18n-exception.filter';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // 生产环境不输出 debug：里面会带车辆坐标等位置信息，不该进第三方日志平台
    logger: process.env.NODE_ENV === 'production'
      ? ['error', 'warn', 'log']
      : ['error', 'warn', 'log', 'debug', 'verbose'],
  });
  const configService = app.get(ConfigService);
  const isProd = process.env.NODE_ENV === 'production';

  // 部署在 Railway/Render 等反向代理后面：信任第一跳代理，拿到真实客户端 IP（限流按 IP 才准）
  app.set('trust proxy', 1);

  // 安全响应头。资源策略必须放宽到 cross-origin，否则桌面端(file://)和手机端
  // 加载 /uploads 下的工完照片会被挡掉（见 security-headers.config.ts）
  app.use(helmet(securityHeaders(isProd)));

  app.enableCors({
    origin: createCorsOriginResolver(configService),
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  // 服务里只抛错误码，这里按请求语言换成中文或英文的句子（不再返回 "中文 / English" 混排）
  app.useGlobalFilters(new I18nExceptionFilter());

  app.useStaticAssets(join(__dirname, '..', 'uploads'), {
    prefix: '/uploads',
  });

  // Swagger 仅在非生产环境暴露，避免线上泄露完整 API 结构
  if (!isProd) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Truck Dispatch Management System API')
      .setDescription('Truck Dispatch Management System API Documentation')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document);
  }

  const port = process.env.PORT || 3000;
  await app.listen(port, '0.0.0.0');

  const nets = os.networkInterfaces();
  logger.log('Server running on:');
  logger.log(`Local: http://localhost:${port}`);
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] ?? []) {
      if (net.family === 'IPv4' && !net.internal) {
        logger.log(`Network: http://${net.address}:${port}`);
      }
    }
  }
  logger.log(`API Docs: http://localhost:${port}/api/docs`);
}

bootstrap();
