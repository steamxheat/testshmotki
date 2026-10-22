import type {
  Category,
  Order,
  OrderStatusHistory,
  Product,
  ProductImage,
  ProductVariant,
  OrderItem,
  Shipment,
  Review,
  Store,
  User,
} from '@prisma/client';
import { discountPercent, kopecksToRubles } from './money.js';

type ProductWithImages = Product & { images?: ProductImage[]; variants?: ProductVariant[] };

export function presentStoreSettings(store: Store) {
  const s = (store.settings ?? {}) as Record<string, unknown>;
  const legalName = typeof s.legalName === 'string' ? s.legalName.trim() : '';
  const legalInn = typeof s.legalInn === 'string' ? s.legalInn.trim() : '';
  const legalAddress = typeof s.legalAddress === 'string' ? s.legalAddress.trim() : '';
  const legalEmail = typeof s.legalEmail === 'string' ? s.legalEmail.trim() : '';
  return {
    deliveryMethods: (s.deliveryMethods as string[]) ?? ['meetup', 'cdek', 'russian_post', 'discuss'],
    cdekMode: s.cdekMode === 'manual' || s.cdekMode === 'automatic' ? s.cdekMode : s.cdekConnection ? 'automatic' : 'manual',
    responseSchedule: (s.responseSchedule as string) ?? null,
    reservationRules: (s.reservationRules as string) ?? null,
    socialLinks: (s.socialLinks as Record<string, string>) ?? {},
    accentColor: s.accentColor === '#ff5a1f' ? '#486876' : (s.accentColor as string) ?? '#486876',
    backgroundUrl: (s.backgroundUrl as string) ?? null,
    privacyUrl: (s.privacyUrl as string) ?? null,
    termsUrl: (s.termsUrl as string) ?? null,
    legalName: legalName || null,
    legalInn: legalInn || null,
    legalAddress: legalAddress || null,
    legalEmail: legalEmail || null,
    legalReady: legalName.length >= 2 && /^(\d{10}|\d{12})$/.test(legalInn) && legalAddress.length >= 5 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(legalEmail),
    deliveryOptions: (s.deliveryOptions as Record<string, unknown>[]) ?? [],
    showSold: (s.showSold as boolean) ?? true,
    blocks: (s.blocks as Record<string, boolean>) ?? {
      newArrivals: true,
      discounted: true,
      recent: true,
    },
    slugChangedAt: (s.slugChangedAt as string) ?? null,
  };
}

export function presentStore(
  store: Store,
  extra: { rating?: number; reviewsCount?: number } = {},
) {
  return {
    id: store.id,
    slug: store.slug,
    name: store.name,
    description: store.description,
    logoUrl: store.logoUrl,
    coverUrl: store.coverUrl,
    city: store.city,
    contactUsername: store.contactUsername,
    status: store.status,
    settings: presentStoreSettings(store),
    rating: extra.rating ?? 0,
    reviewsCount: extra.reviewsCount ?? 0,
    createdAt: store.createdAt,
  };
}

export function presentProduct(
  p: ProductWithImages,
  extra: { isFavorite?: boolean } = {},
) {
  const images = (p.images ?? []).slice().sort((a, b) => a.sortOrder - b.sortOrder);
  return {
    id: p.id,
    storeId: p.storeId,
    categoryId: p.categoryId,
    title: p.title,
    description: p.description,
    price: kopecksToRubles(p.priceAmount),
    priceAmount: p.priceAmount,
    oldPrice: p.oldPriceAmount != null ? kopecksToRubles(p.oldPriceAmount) : null,
    oldPriceAmount: p.oldPriceAmount,
    discountPercent: discountPercent(p.priceAmount, p.oldPriceAmount),
    brand: p.brand,
    size: p.size,
    variants: (p.variants ?? []).map((v) => ({ id: v.id, size: v.size, stock: v.stockQuantity, available: v.stockQuantity - v.reservedQuantity - v.soldQuantity })),
    color: p.color,
    condition: p.condition,
    defects: p.defects,
    sellerSku: p.sellerSku,
    status: p.status,
    isReserved: p.status === 'reserved',
    isSold: p.status === 'sold',
    isAvailable: p.status === 'published',
    images: images.map((i) => ({ id: i.id, url: i.url, sortOrder: i.sortOrder })),
    coverUrl: images[0]?.url ?? null,
    publishedAt: p.publishedAt,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    isFavorite: extra.isFavorite ?? false,
  };
}

export function presentCategory(c: Category & { _count?: { products: number } }) {
  return {
    id: c.id,
    parentId: c.parentId,
    name: c.name,
    sortOrder: c.sortOrder,
    status: c.status,
    productCount: c._count?.products,
  };
}

export function presentOrder(
  o: Order & { history?: OrderStatusHistory[]; items?: OrderItem[]; product?: ProductWithImages | null; review?: { id: string } | null; shipment?: Shipment | null },
  paymentDetails?: string | null,
) {
  return {
    id: o.id,
    publicNumber: o.publicNumber,
    storeId: o.storeId,
    productId: o.productId,
    buyerId: o.buyerId,
    productTitle: o.productTitleSnapshot,
    price: kopecksToRubles(o.priceAmountSnapshot),
    priceAmount: o.priceAmountSnapshot,
    buyerName: o.buyerName,
    buyerUsername: o.buyerUsername,
    buyerPhone: o.buyerPhone,
    buyerEmail: o.buyerEmail,
    city: o.city,
    deliveryAddress: o.deliveryAddress,
    deliveryPoint: o.deliveryPoint,
    deliveryPointCode: o.deliveryPointCode,
    deliveryCityCode: o.deliveryCityCode,
    deliveryTariff: o.deliveryTariff,
    deliveryPrice: o.deliveryPriceAmount == null ? null : kopecksToRubles(o.deliveryPriceAmount),
    deliveryLat: o.deliveryLat,
    deliveryLon: o.deliveryLon,
    deliveryMethod: o.deliveryMethod,
    shipment: o.shipment ? { state: o.shipment.state, mode: o.shipment.mode, requestUuid: o.shipment.requestUuid, trackingNumber: o.shipment.trackingNumber, originPoint: o.shipment.originPoint, tariffName: o.shipment.tariffName, price: o.shipment.priceAmount == null ? null : kopecksToRubles(o.shipment.priceAmount), error: o.shipment.error } : null,
    items: (o.items ?? []).map((i) => ({ productId: i.productId, variantId: i.variantId, title: i.titleSnapshot, size: i.sizeSnapshot, quantity: i.quantity, price: kopecksToRubles(i.priceAmountSnapshot) })),
    receiptSubmittedAt: o.receiptSubmittedAt,
    paymentConfirmedAt: o.paymentConfirmedAt,
    paymentDetails: o.status === 'confirmed' && (o.deliveryMethod !== 'cdek' || o.deliveryPriceAmount != null) ? paymentDetails ?? null : null,
    comment: o.comment,
    status: o.status,
    reservedUntil: o.reservedUntil,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
    cover: o.product?.images?.[0]?.url ?? null,
    hasReview: Boolean(o.review),
    history: o.history?.map((hst) => ({
      oldStatus: hst.oldStatus,
      newStatus: hst.newStatus,
      createdAt: hst.createdAt,
    })),
  };
}

export function presentReview(
  r: Review & { author?: Pick<User, 'firstName' | 'avatarUrl'> | null },
) {
  return {
    id: r.id,
    orderId: r.orderId,
    rating: r.rating,
    text: r.text,
    photos: (r.photos as string[]) ?? [],
    sellerReply: r.sellerReply,
    status: r.status,
    authorName: r.author?.firstName ?? 'Покупатель',
    authorAvatar: r.author?.avatarUrl ?? null,
    createdAt: r.createdAt,
  };
}
