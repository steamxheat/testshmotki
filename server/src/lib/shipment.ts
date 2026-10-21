import { prisma } from '../db.js';
import { connectionFromSettings, sellerCdekRequest } from './cdek.js';
import { badRequest, notFound } from './http.js';
import { notifyBuyer } from '../telegram/notify.js';

export function parseCdekShipmentResponse(result: Record<string, any>) {
  const entity = result.entity;
  const request = result.requests?.[0];
  const tracking = typeof entity?.cdek_number === 'string' || typeof entity?.cdek_number === 'number' ? String(entity.cdek_number) : null;
  const state = tracking ? 'created' : request?.state === 'INVALID' ? 'invalid' : 'submitted';
  return { state, tracking, externalUuid: typeof entity?.uuid === 'string' ? entity.uuid : null,
    error: state === 'invalid' ? String(request?.errors?.[0]?.message || 'СДЭК отклонил заказ').slice(0, 300) : null };
}

export async function refreshCdekShipment(id: string) {
  const shipment = await prisma.shipment.findUnique({ where: { id }, include: { order: { include: { buyer: true, store: true } } } });
  if (!shipment) throw notFound('Отправление не найдено');
  if (!shipment.externalUuid) throw badRequest('СДЭК не вернул номер запроса. Проверьте отправление через поддержку перевозчика, чтобы не создать дубль.');
  const connection = connectionFromSettings(shipment.order.store.settings);
  if (!connection || connection.mode !== shipment.mode) throw badRequest('Восстановите подключение СДЭК в той же среде');
  const result = await sellerCdekRequest(connection, `/orders/${encodeURIComponent(shipment.externalUuid)}`);
  const { state, tracking, externalUuid, error } = parseCdekShipmentResponse(result);
  const changed = await prisma.shipment.updateMany({ where: { id, trackingNumber: shipment.trackingNumber }, data: {
    state, externalUuid: externalUuid || shipment.externalUuid, trackingNumber: tracking, error,
  } });
  if (changed.count && tracking && tracking !== shipment.trackingNumber && shipment.mode === 'live') {
    notifyBuyer.shipmentRegistered(shipment.order.buyer.telegramId, shipment.order.publicNumber, tracking, shipment.order.store.slug);
  }
  const updated = await prisma.shipment.findUniqueOrThrow({ where: { id } });
  return { state: updated.state, mode: updated.mode, trackingNumber: updated.trackingNumber, error: updated.error, originPoint: updated.originPoint };
}
