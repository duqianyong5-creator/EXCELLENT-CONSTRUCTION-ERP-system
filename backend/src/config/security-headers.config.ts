import type { HelmetOptions } from 'helmet';

/**
 * 安全响应头。
 *
 * 两个默认值必须改掉，否则会把自家客户端打坏：
 *
 * 1. `crossOriginResourcePolicy` 默认是 same-origin。工完照片走本地存储兜底时
 *    是从本 API 的 /uploads 提供的，而桌面端是 file://（Origin 为 null）、
 *    手机端根本没有 Origin —— 都算跨源，照片会被浏览器/WebView 拒绝加载。
 * 2. CSP 只对 HTML 有意义，本服务只返回 JSON 和图片；生产环境 Swagger 是关的，
 *    开发环境留着 CSP 反而会挡掉 Swagger UI 自己的内联脚本。
 */
export function securityHeaders(isProd: boolean): HelmetOptions {
  return {
    // 只有 JSON 和图片，没有需要 CSP 保护的 HTML 文档
    contentSecurityPolicy: false,
    // 让桌面端(file://)和手机端能加载 /uploads 下的照片
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    // 不需要跨源隔离，开了会连带要求所有子资源都带 CORP
    crossOriginEmbedderPolicy: false,
    // 别把内网/代理地址泄露到第三方
    referrerPolicy: { policy: 'no-referrer' },
    // 只在生产开 HSTS：本地开发是 http，开了会把 localhost 钉死成 https
    hsts: isProd ? { maxAge: 15552000, includeSubDomains: true } : false,
  };
}
