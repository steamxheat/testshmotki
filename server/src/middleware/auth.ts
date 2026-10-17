import type { NextFunction, Request, Response } from 'express';
import { config, isSuperadmin } from '../config.js';
import { prisma } from '../db.js';
import { unauthorized } from '../lib/http.js';
import { verifyInitData, type TelegramUser } from '../telegram/initData.js';

/**
 * Авторизация по Telegram WebApp initData (§10).
 * Клиент присылает подписанную строку в заголовке `X-Init-Data`.
 * Сервер проверяет подпись и срок; доверять данным «просто с клиента» нельзя.
 *
 * В dev-режиме (без BOT_TOKEN) допускается заголовок `X-Dev-User` с JSON
 * `{id, first_name, username}` — только для локальной отладки в браузере.
 */
export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  let tgUser: TelegramUser | null = null;
  let startParam: string | undefined;

  const initData = req.header('x-init-data');
  if (initData) {
    const verified = verifyInitData(initData);
    if (!verified) return next(unauthorized('Неверная или просроченная подпись Telegram'));
    tgUser = verified.user;
    startParam = verified.startParam;
  } else if (config.isDev && req.header('x-dev-user')) {
    // dev-пользователь приходит в base64 (значение заголовка — ISO-8859-1)
    const raw = req.header('x-dev-user') as string;
    const decoded = Buffer.from(raw, 'base64').toString('utf8');
    try {
      tgUser = JSON.parse(decoded);
    } catch {
      try {
        tgUser = JSON.parse(raw);
      } catch {
        return next(unauthorized('Некорректный X-Dev-User'));
      }
    }
  }

  if (!tgUser?.id) return next(unauthorized('Нужны данные Telegram'));

  const telegramId = BigInt(tgUser.id);
  const user = await prisma.user.upsert({
    where: { telegramId },
    create: {
      telegramId,
      username: tgUser.username ?? null,
      firstName: tgUser.first_name ?? null,
      lastName: tgUser.last_name ?? null,
      avatarUrl: tgUser.photo_url ?? null,
    },
    update: {
      username: tgUser.username ?? null,
      firstName: tgUser.first_name ?? null,
      lastName: tgUser.last_name ?? null,
      avatarUrl: tgUser.photo_url ?? null,
      lastSeenAt: new Date(),
    },
  });

  req.auth = { user, telegramId, username: tgUser.username, startParam };
  req.isSuperadmin = isSuperadmin(telegramId);
  next();
}

export function requireSuperadmin(req: Request, _res: Response, next: NextFunction) {
  if (!req.isSuperadmin) return next(unauthorized('Только для суперадминистратора'));
  next();
}
