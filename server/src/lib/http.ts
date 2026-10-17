import type { NextFunction, Request, Response } from 'express';

export class AppError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const badRequest = (msg: string, code = 'bad_request') => new AppError(400, code, msg);
export const unauthorized = (msg = 'Не авторизовано') => new AppError(401, 'unauthorized', msg);
export const forbidden = (msg = 'Нет доступа') => new AppError(403, 'forbidden', msg);
export const notFound = (msg = 'Не найдено') => new AppError(404, 'not_found', msg);
export const conflict = (msg: string, code = 'conflict') => new AppError(409, code, msg);

// обёртка, пробрасывающая ошибки async-роутов в error middleware
export function h(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}
