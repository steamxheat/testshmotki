export type ProductStatus = 'draft' | 'published' | 'reserved' | 'sold' | 'archived';
export type Condition = 'new_with_tag' | 'new_no_tag' | 'excellent' | 'good' | 'has_issues';
export type OrderStatus = 'pending' | 'confirmed' | 'rejected' | 'completed' | 'cancelled' | 'expired';
export type DeliveryMethod = 'meetup' | 'cdek' | 'russian_post' | 'discuss';

export interface Image {
  id: string;
  url: string;
  sortOrder: number;
}

export interface Product {
  id: string;
  storeId: string;
  categoryId: string | null;
  title: string;
  description: string | null;
  price: number;
  priceAmount: number;
  oldPrice: number | null;
  discountPercent: number | null;
  brand: string | null;
  size: string | null;
  color: string | null;
  condition: Condition;
  defects: string | null;
  sellerSku: string | null;
  status: ProductStatus;
  isReserved: boolean;
  isSold: boolean;
  isAvailable: boolean;
  images: Image[];
  coverUrl: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  isFavorite: boolean;
}

export interface StoreSettings {
  deliveryMethods: DeliveryMethod[];
  responseSchedule: string | null;
  reservationRules: string | null;
  socialLinks: Record<string, string>;
  accentColor: string;
  showSold: boolean;
  blocks: { newArrivals: boolean; discounted: boolean; recent: boolean };
  slugChangedAt: string | null;
}

export interface Store {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  logoUrl: string | null;
  coverUrl: string | null;
  city: string | null;
  contactUsername: string | null;
  status: 'active' | 'blocked';
  settings: StoreSettings;
  rating: number;
  reviewsCount: number;
}

export interface Category {
  id: string;
  name: string;
  parentId: string | null;
  sortOrder?: number;
  status?: string;
  productCount?: number;
}

export interface Filters {
  categories: { id: string; name: string; parentId: string | null }[];
  brands: string[];
  sizes: string[];
  colors: string[];
  conditions: Condition[];
  priceMin: number;
  priceMax: number;
  hasDiscounted: boolean;
}

export interface Order {
  id: string;
  publicNumber: string;
  storeId: string;
  productId: string;
  productTitle: string;
  price: number;
  buyerName: string;
  buyerUsername: string | null;
  buyerPhone: string | null;
  city: string | null;
  deliveryMethod: DeliveryMethod;
  comment: string | null;
  status: OrderStatus;
  reservedUntil: string | null;
  createdAt: string;
  updatedAt: string;
  cover: string | null;
  orderNumber?: string;
  history?: { oldStatus: OrderStatus | null; newStatus: OrderStatus; createdAt: string }[];
}

export interface Review {
  id: string;
  orderId: string;
  rating: number;
  text: string | null;
  photos: string[];
  sellerReply: string | null;
  status: 'published' | 'hidden';
  authorName: string;
  authorAvatar: string | null;
  createdAt: string;
  orderNumber?: string;
}

export interface Profile {
  user: {
    telegramId: string;
    firstName: string | null;
    lastName: string | null;
    username: string | null;
    avatarUrl: string | null;
    phone: string | null;
  };
  ordersCount: number;
  isSuperadmin: boolean;
  stores: { id: string; slug: string; name: string; logoUrl: string | null; role: string }[];
}
