import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { isErrorCode, localizeMessage, normalizeLang } from '../i18n/messages';

/**
 * 把服务里抛出的错误码换成请求语言对应的句子。
 *
 * 语言来源：客户端自己选的 `X-Lang`（网页端和 App 都会带上）；没有就退回浏览器的
 * `Accept-Language`，再没有就用中文。响应里同时保留 `code`，客户端想自己翻译也可以。
 *
 * 不认识的消息原样透传，所以还没改造成错误码的地方不会受影响。
 */
@Catch()
export class I18nExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('HttpException');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    // WebSocket / 定时任务等非 HTTP 上下文没有 response，交回 Nest 默认处理
    if (!res || typeof res.status !== 'function') throw exception;

    const lang = normalizeLang(
      (req?.headers?.['x-lang'] as string) || (req?.headers?.['accept-language'] as string),
    );

    if (!(exception instanceof HttpException)) {
      // 未预期的错误：不把内部细节返回给客户端，只记日志
      this.logger.error(
        `${req?.method} ${req?.url} -> ${(exception as any)?.stack || String(exception)}`,
      );
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: localizeMessage('INTERNAL_ERROR', lang) === 'INTERNAL_ERROR'
          ? lang === 'en'
            ? 'Something went wrong — please try again'
            : '服务出错了，请稍后重试'
          : localizeMessage('INTERNAL_ERROR', lang),
      });
      return;
    }

    const status = exception.getStatus();
    const payload = exception.getResponse();
    const body: Record<string, any> =
      typeof payload === 'string' ? { statusCode: status, message: payload } : { ...(payload as object) };

    const raw = body.message;
    if (typeof raw === 'string' && isErrorCode(raw)) {
      body.code = raw;
      body.message = localizeMessage(raw, lang);
    } else if (Array.isArray(raw)) {
      // ValidationPipe 返回的是字符串数组，逐条尝试本地化
      body.message = raw.map((m) => (typeof m === 'string' ? localizeMessage(m, lang) : m));
    }

    body.statusCode = status;
    res.status(status).json(body);
  }
}
