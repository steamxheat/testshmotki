import crypto from 'node:crypto';
import fs from 'node:fs';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import sharp from 'sharp';
import { prisma } from '../db.js';
import { badRequest } from './http.js';

// Для MVP изображения хранятся на локальном диске в /uploads.
// Абстракция (publicUrl) позволяет позже заменить на S3 без изменения роутов (§13).
export const UPLOAD_DIR = path.resolve(process.cwd(), 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);
const MAX_BYTES = 6 * 1024 * 1024; // максимум 60 МБ на запрос из 10 фото

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
export async function processUploads(files: Express.Multer.File[], prefix = ''): Promise<ProcessedImage[]> {
  const out: ProcessedImage[] = [];
  const written: string[] = [];
  try {
   for (const file of files) {
    const id = `${prefix}${crypto.randomUUID()}`;
    let meta;
    try {
      meta = await sharp(file.buffer, { failOn: 'error', limitInputPixels: 40_000_000 }).rotate().metadata();
    } catch {
      throw badRequest('Файл не является корректным изображением', 'bad_image');
    }
    if (!meta.width || !meta.height) throw badRequest('Не удалось прочитать изображение', 'bad_image');

    const fullName = `${id}.webp`;
    const thumbName = `${id}_thumb.webp`;
    const disk = await fsp.statfs(UPLOAD_DIR);
    if (disk.bavail * disk.bsize < 1024 ** 3 + file.size) throw badRequest('Недостаточно места для фото');

    written.push(path.join(UPLOAD_DIR, fullName));
    await sharp(file.buffer, { limitInputPixels: 40_000_000 })
      .rotate()
      .resize(FULL_MAX, FULL_MAX, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82 })
      .toFile(path.join(UPLOAD_DIR, fullName));

    written.push(path.join(UPLOAD_DIR, thumbName));
    await sharp(file.buffer, { limitInputPixels: 40_000_000 })
      .rotate()
      .resize(THUMB_MAX, THUMB_MAX, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 72 })
      .toFile(path.join(UPLOAD_DIR, thumbName));

    out.push({ url: publicUrl(fullName), thumbUrl: publicUrl(thumbName) });
   }
  } catch (error) {
    await Promise.all(written.map((filename) => fsp.unlink(filename).catch(() => undefined)));
    throw error;
  }
  return out;
}

// Удаляем только наши UUID-файлы (включая фото отзывов с префиксом заказа) старше недели: открытая форма создания товара
// или отзыва может не быть сохранена сразу после загрузки.
export async function removeUnusedUploads(): Promise<number> {
  const [products, images, stores, reviews, messages] = await Promise.all([
    prisma.product.findMany({ select: { defectImages: true, videoUrl: true } }),
    prisma.productImage.findMany({ select: { url: true } }),
    prisma.store.findMany({ select: { logoUrl: true, coverUrl: true, settings: true } }),
    prisma.review.findMany({ select: { photos: true } }),
    prisma.chatMessage.findMany({ where: { mediaUrl: { not: null } }, select: { mediaUrl: true } }),
  ]);
  const references = new Set<string>();
  const add = (value: unknown) => {
    if (typeof value !== 'string') return;
    for (const match of value.matchAll(/\/uploads\/([\w-]+\.(?:webp|mp4|webm|mov))/g)) references.add(match[1]);
  };
  images.forEach((image) => add(image.url));
  products.forEach((product) => { add(JSON.stringify(product.defectImages)); add(product.videoUrl); });
  stores.forEach((store) => { add(store.logoUrl); add(store.coverUrl); add(JSON.stringify(store.settings)); });
  reviews.forEach((review) => add(JSON.stringify(review.photos)));
  messages.forEach((message) => add(message.mediaUrl));
  let removed = 0;
  for (const file of await fsp.readdir(UPLOAD_DIR)) {
    const match = /^((?:[a-z0-9]+_[a-z0-9]+_)?[0-9a-f]{8}-[0-9a-f-]{27,36})(?:_thumb)?\.(webp|mp4|webm|mov)$/i.exec(file);
    if (!match || references.has(file) || references.has(`${match[1]}.webp`) || references.has(`${match[1]}_thumb.webp`)) continue;
    const filename = path.join(UPLOAD_DIR, file);
    const stat = await fsp.stat(filename).catch(() => null);
    if (stat && stat.mtimeMs < Date.now() - 7 * 864e5) {
      await fsp.unlink(filename);
      removed++;
    }
  }
  return removed;
}

export function publicUrl(filename: string): string {
  return `/uploads/${filename}`;
}
