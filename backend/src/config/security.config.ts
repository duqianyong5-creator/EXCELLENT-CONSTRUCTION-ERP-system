import { ConfigService } from '@nestjs/config';

type CorsCallback = (error: Error | null, allow?: boolean) => void;

export function getConfig(config: ConfigService, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = config.get<string>(key);
    if (value) return value;
  }
  return undefined;
}

export function requireConfig(config: ConfigService, key: string): string {
  const value = config.get<string>(key);
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

export function createCorsOriginResolver(config: ConfigService) {
  // 本地开发域名只在非生产环境放行；生产只允许 FRONTEND_URL 指定的来源
  const isProd = config.get<string>('NODE_ENV') === 'production';
  const localOrigins = isProd
    ? []
    : [
        'http://localhost:5173',
        'http://127.0.0.1:5173',
        'http://localhost:3000',
        'http://127.0.0.1:3000',
      ];

  return (origin: string | undefined, callback: CorsCallback) => {
    const configuredOrigins = config
      .get<string>('FRONTEND_URL', '')
      .split(',')
      .map((allowedOrigin) => allowedOrigin.trim())
      .filter(Boolean);
    const allowedOrigins = new Set([...configuredOrigins, ...localOrigins]);

    // 移动端(无 Origin)与桌面端 Electron(file:// 发出的 Origin 为字符串 'null')
    // 都是受信任的一方客户端，仍需 JWT 鉴权，放行 CORS。
    if (!origin || origin === 'null' || allowedOrigins.has(origin)) {
      callback(null, true);
      return;
    }

    callback(new Error(`CORS origin not allowed: ${origin}`), false);
  };
}
