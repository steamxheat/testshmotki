import type {
  Category,
  Order,
  OrderStatusHistory,
  Product,
  ProductImage,
  Review,
  Store,
  User,
} from '@prisma/client';
import { discountPercent, kopecksToRubles } from './money.js';

type ProductWithImages = Product & { images?: ProductImage[] };

export function presentStoreSettings(store: Store) {
  const s = (store.settings ?? {}) as Record<string, unknown>;
  return {
    deliveryMethods: (s.deliveryMethods as string[]) ?? ['meetup', 'cdek', 'russian_post', 'discuss'],
    responseSchedule: (s.responseSchedule as string) ?? null,
    reservationRules: (s.reservationRules as string) ?? null,
    socialLinks: (s.socialLinks as Record<string, string>) ?? {},
    accentColor: (s.accentColor as string) ?? '#111827',
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
  o: Order & { history?: OrderStatusHistory[]; product?: ProductWithImages | null },
) {
  return {
    id: o.id,
    publicNumber: o.publicNumber,
    storeId: o.storeId,
    productId: o.productId,
    productTitle: o.productTitleSnapshot,
    price: kopecksToRubles(o.priceAmountSnapshot),
    priceAmount: o.priceAmountSnapshot,
    buyerName: o.buyerName,
    buyerUsername: o.buyerUsername,
    buyerPhone: o.buyerPhone,
    city: o.city,
    deliveryMethod: o.deliveryMethod,
    comment: o.comment,
    status: o.status,
    reservedUntil: o.reservedUntil,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
    cover: o.product?.images?.[0]?.url ?? null,
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
