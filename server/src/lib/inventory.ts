import { Prisma } from '@prisma/client';
import { conflict } from './http.js';

type Tx = Prisma.TransactionClient;

export async function lockProducts(tx: Tx, ids: string[]) {
  if (!ids.length) return;
  await tx.$queryRaw`SELECT id FROM products WHERE id IN (${Prisma.join([...new Set(ids)].sort())}) ORDER BY id FOR UPDATE`;
}

export async function reserveVariant(tx: Tx, variantId: string, quantity: number) {
  const changed = await tx.$queryRaw<{ id: string }[]>`
    UPDATE product_variants SET reserved_quantity = reserved_quantity + ${quantity}
    WHERE id = ${variantId} AND stock_quantity - reserved_quantity - sold_quantity >= ${quantity}
    RETURNING id`;
  if (!changed.length) throw conflict('Выбранного размера уже нет в нужном количестве', 'out_of_stock');
}

export async function syncProductStatus(tx: Tx, productIds: string[]) {
  for (const id of [...new Set(productIds)]) {
    const product = await tx.product.findUnique({ where: { id }, select: { status: true, variants: true } });
    if (!product || product.status === 'draft' || product.status === 'archived') continue;
    const available = product.variants.reduce((n, v) => n + v.stockQuantity - v.reservedQuantity - v.soldQuantity, 0);
    const reserved = product.variants.reduce((n, v) => n + v.reservedQuantity, 0);
    const sold = product.variants.reduce((n, v) => n + v.soldQuantity, 0);
    const status = available > 0 ? 'published' : reserved > 0 ? 'reserved' : sold > 0 ? 'sold' : 'draft';
    if (product.status !== status) await tx.product.update({ where: { id }, data: { status } });
  }
}

export async function releaseOrderStock(tx: Tx, orderId: string, sold: boolean) {
  const items = await tx.orderItem.findMany({ where: { orderId } });
  await lockProducts(tx, items.map((i) => i.productId));
  for (const item of items) {
    await tx.productVariant.update({ where: { id: item.variantId }, data: {
      reservedQuantity: { decrement: item.quantity },
      ...(sold ? { soldQuantity: { increment: item.quantity } } : {}),
    } });
  }
  await syncProductStatus(tx, items.map((i) => i.productId));
}
