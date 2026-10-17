import type { NextFunction, Request, Response } from 'express';
import { prisma } from '../db.js';
import { forbidden, notFound } from '../lib/http.js';

function slugFromStartParam(p?: string): string | undefined {
  if (!p) return undefined;
  return p.startsWith('store_') ? p.slice('store_'.length) : p;
}

/**
 * Определяет магазин витрины по (в порядке приоритета):
 *   1) query/header `store` (slug),
 *   2) start_param из initData (`store_<slug>`),
 * и кладёт его в req.store. Заблокированный магазин недоступен покупателям (§9.7),
 * но суперадмин может его открыть.
 */
export function resolveStore(opts: { optional?: boolean } = {}) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const slug =
      (req.query.store as string | undefined) ||
      req.header('x-store-slug') ||
      slugFromStartParam(req.auth?.startParam);

    if (!slug) {
      if (opts.optional) return next();
      return next(notFound('Не указан магазин'));
    }

    const store = await prisma.store.findUnique({ where: { slug } });
    if (!store) return next(notFound('Магазин не найден'));

    if (store.status === 'blocked' && !req.isSuperadmin) {
      return next(forbidden('Магазин временно недоступен'));
    }

    req.store = store;
    next();
  };
}

/**
 * Доступ к админ-панели магазина: пользователь должен быть owner/manager
 * этого магазина (ID добавлен владельцем/суперадмином) — либо суперадмин (§7, §9.8).
 * Магазин берётся из параметра :storeId либо из resolveStore.
 */
export function requireStoreMember(req: Request, _res: Response, next: NextFunction) {
  const run = async () => {
    const storeId = req.params.storeId || req.store?.id || (req.query.storeId as string);
    if (!storeId) return next(notFound('Не указан магазин'));

    const store = req.store?.id === storeId ? req.store : await prisma.store.findUnique({ where: { id: storeId } });
    if (!store) return next(notFound('Магазин не найден'));
    req.store = store;

    if (req.isSuperadmin) return next();

    const member = await prisma.storeMember.findUnique({
      where: { storeId_userId: { storeId, userId: req.auth!.user.id } },
    });
    if (!member) return next(forbidden('Нет прав на эту админ-панель'));
    next();
  };
  run().catch(next);
}
