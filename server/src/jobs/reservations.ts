import cron from 'node-cron';
import { prisma } from '../db.js';
import { releaseOrderStock } from '../lib/inventory.js';
import { refreshCdekShipment } from '../lib/shipment.js';
import { removeUnusedUploads } from '../lib/upload.js';
import { removeUnusedChatMedia } from '../routes/chat.js';
import { deliverPendingNotifications, notifyBuyer, notifySeller } from '../telegram/notify.js';

/**
 * Снятие просроченной брони (§6.7, §9). Если продавец не принял заявку за
 * отведённое время — бронь снимается, товар снова публикуется, заявка → «бронь истекла».
 * Восстановление после ошибки не должно повторно менять статус: условные updateMany
 * и проверки статуса делают операцию идемпотентной (§Надёжность).
 */
export async function expireOverdueReservations(): Promise<void> {
  const overdue = await prisma.order.findMany({
    where: { status: { in: ['pending', 'confirmed'] }, paymentConfirmedAt: null, receiptSubmittedAt: null, reservedUntil: { lt: new Date() } },
    include: { buyer: true, store: { include: { members: { where: { role: 'owner' }, include: { user: true }, take: 1 } } } },
  });

  for (const order of overdue) {
    try {
      const expired = await prisma.$transaction(async (tx) => {
        const upd = await tx.order.updateMany({
          where: { id: order.id, status: order.status, paymentConfirmedAt: null, receiptSubmittedAt: null, reservedUntil: { lt: new Date() } },
          data: { status: 'expired' },
        });
        if (upd.count === 0) return false; // кто-то уже обработал
        await tx.orderStatusHistory.create({
        data: { orderId: order.id, oldStatus: order.status, newStatus: 'expired', changedByUserId: null },
        });
        await releaseOrderStock(tx, order.id, false);
        return true;
      });
      if (!expired) continue;
      notifyBuyer.reservationExpired(order.buyer.telegramId, order.publicNumber, order.store.slug);
      const owner = order.store.members[0]?.user;
      if (owner) notifySeller.reservationExpired(owner.telegramId, order.publicNumber, order.store.slug);
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
    where: { status: { in: ['pending', 'confirmed'] }, paymentConfirmedAt: null, receiptSubmittedAt: null, reservedUntil: { gt: from, lte: to } },
    include: { buyer: true, store: { include: { members: { where: { role: 'owner' }, include: { user: true }, take: 1 } } } },
  });
  for (const order of soon) {
    notifyBuyer.reservationExpiringSoon(order.buyer.telegramId, order.publicNumber, order.store.slug);
    const owner = order.store.members[0]?.user;
    if (owner) notifySeller.reservationExpiringSoon(owner.telegramId, order.publicNumber, order.store.slug);
  }
}

export async function remindUnreviewedReceipts(): Promise<void> {
  const cutoff = new Date(Date.now() - 24 * 3600_000);
  const orders = await prisma.order.findMany({
    where: { status: 'confirmed', receiptSubmittedAt: { lte: cutoff }, paymentConfirmedAt: null,
      OR: [{ receiptReviewRemindedAt: null }, { receiptReviewRemindedAt: { lte: cutoff } }] },
    include: { store: { include: { members: { where: { role: 'owner' }, include: { user: true }, take: 1 } } } },
    take: 50,
  });
  for (const order of orders) {
    const owner = order.store.members[0]?.user;
    if (!owner) continue;
    const changed = await prisma.order.updateMany({ where: { id: order.id, status: 'confirmed', paymentConfirmedAt: null, receiptSubmittedAt: { lte: cutoff },
      OR: [{ receiptReviewRemindedAt: null }, { receiptReviewRemindedAt: { lte: cutoff } }] }, data: { receiptReviewRemindedAt: new Date() } });
    if (changed.count) notifySeller.paymentReviewReminder(owner.telegramId, order.publicNumber, order.store.slug);
  }
}

let refreshingShipments = false;
export async function refreshPendingShipments(): Promise<void> {
  if (refreshingShipments) return;
  refreshingShipments = true;
  try {
    const shipments = await prisma.shipment.findMany({ where: { carrier: 'cdek', state: 'submitted', externalUuid: { not: null } }, orderBy: { updatedAt: 'asc' }, take: 20, select: { id: true } });
    for (const shipment of shipments) {
      try { await refreshCdekShipment(shipment.id); }
      catch (error) { console.error('[cron] CDEK status error', shipment.id, (error as Error).message); }
    }
  } finally { refreshingShipments = false; }
}

export function startReservationCron(): void {
  // каждую минуту
  cron.schedule('* * * * *', () => {
    expireOverdueReservations().catch((e) => console.error('[cron]', e));
    notifyExpiringSoon().catch((e) => console.error('[cron]', e));
    remindUnreviewedReceipts().catch((e) => console.error('[cron] receipt review', e));
    deliverPendingNotifications().catch((e) => console.error('[cron] notification delivery', e));
  });
  cron.schedule('*/5 * * * *', () => refreshPendingShipments().catch((e) => console.error('[cron] CDEK status', e)));
  cron.schedule('17 3 * * *', () => {
    removeUnusedUploads().catch((e) => console.error('[cron] upload cleanup', e));
    removeUnusedChatMedia().catch((e) => console.error('[cron] chat media cleanup', e));
  });
  console.log('[cron] планировщик брони запущен (каждую минуту)');
}
