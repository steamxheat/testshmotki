import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import sharp from 'sharp';
import { config } from '../config.js';
import { badRequest } from './http.js';

// Для MVP изображения хранятся на локальном диске в /uploads.
// Абстракция (publicUrl) позволяет позже заменить на S3 без изменения роутов (§13).
export const UPLOAD_DIR = path.resolve(process.cwd(), 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);
const MAX_BYTES = 12 * 1024 * 1024; // 12 МБ на входе (после сжатия файл станет меньше)

// Размеры на выходе (§11: изображения уменьшаются и отдаются в подходящем размере)
const FULL_MAX = 1600; // для карточки товара/галереи
const THUMB_MAX = 500; // для списков/сетки

// Храним файлы в памяти, чтобы обработать через sharp перед записью на диск.
export const uploadImages = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 10 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED.has(file.mimetype)) {
      cb(badRequest('Допустимы только JPEG, PNG, WebP, HEIC', 'bad_image'));
      return;
    }
    cb(null, true);
  },
});

export interface ProcessedImage {
  url: string;
  thumbUrl: string;
}

/**
 * Обрабатывает загруженные изображения: авто-ориентация, ресайз, конвертация в WebP,
 * удаление метаданных (EXIF). sharp бросает ошибку на не-изображении — это и есть
 * проверка содержимого файла (§Безопасность). Возвращает URL полноразмерной и миниатюры.
 */
export async function processUploads(files: Express.Multer.File[]): Promise<ProcessedImage[]> {
  const out: ProcessedImage[] = [];
  for (const file of files) {
    const id = crypto.randomUUID();
    const base = sharp(file.buffer, { failOn: 'error' }).rotate(); // авто-ориентация по EXIF

    let meta;
    try {
      meta = await base.metadata();
    } catch {
      throw badRequest('Файл не является корректным изображением', 'bad_image');
    }
    if (!meta.width || !meta.height) throw badRequest('Не удалось прочитать изображение', 'bad_image');

    const fullName = `${id}.webp`;
    const thumbName = `${id}_thumb.webp`;

    await sharp(file.buffer)
      .rotate()
      .resize(FULL_MAX, FULL_MAX, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82 })
      .toFile(path.join(UPLOAD_DIR, fullName));

    await sharp(file.buffer)
      .rotate()
      .resize(THUMB_MAX, THUMB_MAX, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 72 })
      .toFile(path.join(UPLOAD_DIR, thumbName));

    out.push({ url: publicUrl(fullName), thumbUrl: publicUrl(thumbName) });
  }
  return out;
}

export function publicUrl(filename: string): string {
  return `${config.publicApiUrl}/uploads/${filename}`;
}
