import * as express from 'express';
import helmet from 'helmet';
import * as request from 'supertest';
import { securityHeaders } from './security-headers.config';

/**
 * 加安全响应头最容易犯的错，是把自家客户端一起挡掉：
 * 桌面端从 file:// 加载（Origin 为 null）、手机端没有 Origin，
 * 而工完照片在本地存储兜底时是从本 API 的 /uploads 出去的。
 * helmet 默认的 same-origin 资源策略会让这些照片直接加载失败。
 */
function appWith(isProd: boolean) {
  const app = express();
  app.use(helmet(securityHeaders(isProd)));
  app.get('/uploads/photo.jpg', (_req, res) => res.type('jpeg').send(Buffer.from([0xff, 0xd8, 0xff])));
  app.get('/tasks', (_req, res) => res.json([]));
  return app;
}

describe('securityHeaders', () => {
  it('lets the desktop and phone clients keep loading work photos', async () => {
    const res = await request(appWith(true)).get('/uploads/photo.jpg');
    expect(res.status).toBe(200);
    expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin');
  });

  it('sets the headers that actually matter for a JSON API', async () => {
    const res = await request(appWith(true)).get('/tasks');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['x-frame-options']).toBeDefined();
    // helmet 默认会去掉 X-Powered-By，别把框架和版本白送出去
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('only pins HTTPS in production', async () => {
    const prod = await request(appWith(true)).get('/tasks');
    expect(prod.headers['strict-transport-security']).toContain('max-age=');

    // 本地开发是 http://localhost，HSTS 会把它钉死成 https，之后浏览器再也连不上
    const dev = await request(appWith(false)).get('/tasks');
    expect(dev.headers['strict-transport-security']).toBeUndefined();
  });

  it('does not send a CSP that would break Swagger in development', async () => {
    const res = await request(appWith(false)).get('/tasks');
    expect(res.headers['content-security-policy']).toBeUndefined();
  });
});
