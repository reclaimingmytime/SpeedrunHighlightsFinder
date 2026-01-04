import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Request, Response } from 'express';

@Catch()
export class RenderExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    const render = (status: number, error: string) =>
      res.status(status).render('index', {
        user: req.query?.user,
        vods: [],
        lastMatchId: undefined,
        error,
      });

    if (!(exception instanceof HttpException)) {
      this.log(exception);
      return render(HttpStatus.INTERNAL_SERVER_ERROR, 'Unexpected error');
    }

    const status = exception.getStatus();

    if (status === 404) {
      return render(HttpStatus.NOT_FOUND, this.extractMessage(exception));
    }

    if (status === 400) {
      return render(HttpStatus.BAD_REQUEST, this.extractMessage(exception));
    }

    this.log(exception);
    return render(HttpStatus.INTERNAL_SERVER_ERROR, 'Unexpected error');
  }

  private extractMessage(exception: HttpException): string {
    const response = exception.getResponse();

    if (typeof response === 'string') return response;
    if (typeof response === 'object' && response !== null) {
      return (
        (response as { message?: string }).message ?? JSON.stringify(response)
      );
    }

    return 'Unexpected error';
  }

  private log(exception: unknown) {
    if (exception instanceof Error) {
      console.error('Unhandled exception:', exception.message);
      console.error(exception.stack);
    } else {
      console.error('Unhandled non-Error exception:', exception);
    }
  }
}
