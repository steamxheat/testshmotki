import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { MulterError } from 'multer';
import { AppError } from '../lib/http.js';

// Логи ошибок без записи токенов и лишних персональных данных (§Надёжность).
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof MulterError) {
    return res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({
      error: { code: err.code, message: err.code === 'LIMIT_FILE_SIZE' ? 'Файл слишком большой' : 'Не удалось загрузить файл' },
    });
  }
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: { code: 'validation', message: 'Некорректные данные', details: err.flatten() },
    });
  }
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message } });
  }
  // multer и прочие ошибки с .status
  const anyErr = err as { status?: number; message?: string; code?: string };
  if (anyErr?.status && anyErr.status < 500) {
    return res.status(anyErr.status).json({
      error: { code: anyErr.code ?? 'error', message: anyErr.message ?? 'Ошибка' },
    });
  }

  console.error('[error]', err instanceof Error ? err.message : err);
  return res.status(500).json({ error: { code: 'internal', message: 'Внутренняя ошибка' } });
}
