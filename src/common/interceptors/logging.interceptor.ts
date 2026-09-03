import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Request, Response } from 'express';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

/**
 * Logs every request in the form:
 *   [API] GET /customers 200 124ms
 *   [API] POST /auth/login 200 238ms
 *   [API] GET /customers/123 401 31ms
 *
 * Deliberately logs ONLY method, path, status, duration, timestamp (added
 * automatically by Nest's Logger) and request id — never the request body,
 * query string values, or any header (which would risk leaking a password,
 * an Authorization bearer token, or KYC data submitted in a body). Route
 * params like an id are fine (already visible in the URL path itself, not
 * secret), but nothing from the body/headers is ever included here.
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('API');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const httpContext = context.switchToHttp();
    const req = httpContext.getRequest<Request & { requestId?: string }>();
    const res = httpContext.getResponse<Response>();

    const { method, path: reqPath } = req;
    const requestId = req.requestId ?? '-';
    const startedAt = Date.now();

    return next.handle().pipe(
      tap({
        next: () => this.logCompletion(method, reqPath, res.statusCode, startedAt, requestId),
        error: (err: { status?: number }) =>
          this.logCompletion(method, reqPath, err?.status ?? 500, startedAt, requestId),
      }),
    );
  }

  private logCompletion(method: string, path: string, status: number, startedAt: number, requestId: string): void {
    const durationMs = Date.now() - startedAt;
    const line = `${method} ${path} ${status} ${durationMs}ms reqId=${requestId}`;

    if (status >= 500) {
      this.logger.error(line);
    } else if (status >= 400) {
      this.logger.warn(line);
    } else {
      this.logger.log(line);
    }
  }
}
