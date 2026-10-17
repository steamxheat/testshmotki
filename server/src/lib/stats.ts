import { type EventType, Prisma } from '@prisma/client';
import { prisma } from '../db.js';

// Средний рейтинг считается только по опубликованным отзывам (§6.9, §9.6).
export async function getStoreRating(storeId: string): Promise<{ rating: number; reviewsCount: number }> {
  const agg = await prisma.review.aggregate({
    where: { storeId, status: 'published' },
    _avg: { rating: true },
    _count: { _all: true },
  });
  return {
    rating: agg._avg.rating ? Math.round(agg._avg.rating * 10) / 10 : 0,
    reviewsCount: agg._count._all,
  };
}

// Логирование аналитического события (§16). Без персональных данных в поиске.
export function logEvent(input: {
  storeId?: string | null;
  userId?: string | null;
  productId?: string | null;
  type: EventType;
  meta?: Record<string, unknown>;
}): void {
  prisma.event
    .create({
      data: {
        storeId: input.storeId ?? null,
        userId: input.userId ?? null,
        productId: input.productId ?? null,
        type: input.type,
        meta: (input.meta ?? {}) as Prisma.InputJsonValue,
      },
    })
    .catch((e) => console.warn('[event] не записано:', (e as Error).message));
}
