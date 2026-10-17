import cron from 'node-cron';
import { prisma } from '../db.js';
import { notifyBuyer, notifySeller } from '../telegram/notify.js';

/**
 * Снятие просроченной брони (§6.7, §9). Если продавец не принял заявку за
 * отведённое время — бронь снимается, товар снова публикуется, заявка → «бронь истекла».
 * Восстановление после ошибки не должно повторно менять статус: условные updateMany
 * и проверки статуса делают операцию идемпотентной (§Надёжность).
 */
export async function expireOverdueReservations(): Promise<void> {
  const overdue = await prisma.order.findMany({
    where: { status: 'pending', reservedUntil: { lt: new Date() } },
    include: { buyer: true, store: { include: { members: { where: { role: 'owner' }, include: { user: true }, take: 1 } } } },
  });

  for (const order of overdue) {
    try {
      await prisma.$transaction(async (tx) => {
        const upd = await tx.order.updateMany({
          where: { id: order.id, status: 'pending' },
          data: { status: 'expired' },
        });
        if (upd.count === 0) return; // кто-то уже обработал
        await tx.orderStatusHistory.create({
          data: { orderId: order.id, oldStatus: 'pending', newStatus: 'expired', changedByUserId: null },
        });
        await tx.product.updateMany({ where: { id: order.productId, status: 'reserved' }, data: { status: 'published' } });
      });
      const owner = order.store.members[0]?.user;
      if (owner) notifySeller.reservationExpiringSoon(owner.telegramId, order.publicNumber);
    } catch (e) {
      console.error('[cron] expire error', (e as Error).message);
    }
  }
}

/**
 * Предупреждение «бронь скоро истечёт» (§8). Узкое окно в 1 минуту, чтобы
 * уведомление отправилось примерно один раз за час до конца брони.
 */
export async function notifyExpiringSoon(): Promise<void> {
  const now = Date.now();
  const from = new Date(now + 59 * 60 * 1000);
  const to = new Date(now + 60 * 60 * 1000);
  const soon = await prisma.order.findMany({
    where: { status: { in: ['pending', 'confirmed'] }, reservedUntil: { gt: from, lte: to } },
    include: { buyer: true, store: { include: { members: { where: { role: 'owner' }, include: { user: true }, take: 1 } } } },
  });
  for (const order of soon) {
    notifyBuyer.reservationExpiringSoon(order.buyer.telegramId, order.publicNumber);
    const owner = order.store.members[0]?.user;
    if (owner) notifySeller.reservationExpiringSoon(owner.telegramId, order.publicNumber);
  }
}

export function startReservationCron(): void {
  // каждую минуту
  cron.schedule('* * * * *', () => {
    expireOverdueReservations().catch((e) => console.error('[cron]', e));
    notifyExpiringSoon().catch((e) => console.error('[cron]', e));
  });
  console.log('[cron] планировщик брони запущен (каждую минуту)');
}
