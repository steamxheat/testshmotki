import { authHeaders, getStoreSlug } from './telegram';
import type {
  Category,
  ChatPage,
  ChatThreadSummary,
  Filters,
  Order,
  Product,
  Profile,
  Review,
  Store,
} from '../types';

// В проде VITE_API_URL пустой → API на том же origin (за nginx-прокси).
// В dev — http://localhost:4000 из .env.
const BASE = (import.meta.env.VITE_API_URL || new URL(import.meta.env.BASE_URL, window.location.origin).href).replace(/\/$/, '');

export class ApiError extends Error {
  code: string;
  status: number;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function request<T>(path: string, opts: RequestInit & { query?: Record<string, unknown> } = {}): Promise<T> {
  const url = new URL(BASE + path, window.location.origin);
  // магазин витрины прокидываем и в query, и в заголовок
  const slug = getStoreSlug();
  url.searchParams.set('store', slug);
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v == null || v === '') continue;
      if (Array.isArray(v)) v.forEach((x) => url.searchParams.append(k, String(x)));
      else url.searchParams.set(k, String(v));
    }
  }

  const res = await fetch(url.toString(), {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      'X-Store-Slug': slug,
      ...authHeaders(),
      ...(opts.headers ?? {}),
    },
  });

  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const err = data?.error ?? {};
    throw new ApiError(res.status, err.code ?? 'error', err.message ?? 'Ошибка запроса');
  }
  return data as T;
}

const get = <T>(path: string, query?: Record<string, unknown>) => request<T>(path, { method: 'GET', query });
const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined });
const patch = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: 'PATCH', body: body ? JSON.stringify(body) : undefined });
const put = <T>(path: string, body: unknown) => request<T>(path, { method: 'PUT', body: JSON.stringify(body) });
const del = <T>(path: string) => request<T>(path, { method: 'DELETE' });

// ---------- Витрина покупателя ----------

export const api = {
  store: () => get<{ store: Store }>('/api/store'),
  legalNotice: () => get<{ version: string; decision: 'accepted' | 'dismissed' | null }>('/api/store/legal-notice'),
  setLegalNotice: (decision: 'accepted' | 'dismissed') => post<{ version: string; decision: string }>('/api/store/legal-notice', { decision }),
  categories: () => get<{ categories: Category[] }>('/api/store/categories'),
  home: () => get<{ newArrivals: Product[]; discounted: Product[]; recent: Product[] }>('/api/catalog/home'),
  filters: () => get<Filters>('/api/catalog/filters'),
  catalog: (query: Record<string, unknown>) =>
    get<{ items: Product[]; total: number; page: number; pageSize: number; hasMore: boolean }>('/api/catalog', query),
  product: (id: string) => get<{ product: Product }>(`/api/catalog/product/${id}`),

  favorites: () => get<{ items: Product[] }>('/api/favorites'),
  addFavorite: (id: string) => post<{ isFavorite: boolean }>(`/api/favorites/${id}`),
  removeFavorite: (id: string) => del<{ isFavorite: boolean }>(`/api/favorites/${id}`),
  clearFavorites: () => del<{ ok: boolean }>('/api/favorites'),

  createOrder: (body: unknown) => post<{ order: Order }>('/api/orders', body),
  cdekStatus: () => get<{ connected: boolean }>('/api/delivery/cdek/status'),
  cdekCities: (query: string) => get<{ cities: { code: number; city: string; region: string }[] }>('/api/delivery/cdek/cities', { query }),
  cdekPoints: (cityCode: number) => get<{ points: { code: string; name: string; address: string; city: string; cityCode: number; lat?: number; lon?: number }[] }>('/api/delivery/cdek/points', { cityCode }),
  cdekQuote: (cityCode: number, pointCode: string) => post<{ available: boolean; quote?: { tariffCode: number; tariffName: string; price: number; periodMin?: number; periodMax?: number } }>('/api/delivery/cdek/quote', { cityCode, pointCode }),
  orders: () => get<{ items: Order[] }>('/api/orders'),
  uploadReceipt: async (id: string, file: File) => {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch(`${BASE}/api/orders/${id}/receipt?store=${getStoreSlug()}`, { method: 'POST', headers: authHeaders(), body: form });
    const data = await res.json();
    if (!res.ok) throw new ApiError(res.status, data?.error?.code ?? 'upload', data?.error?.message ?? 'Чек не загружен');
  },
  receipt: async (id: string) => {
    const res = await fetch(`${BASE}/api/orders/${id}/receipt?store=${getStoreSlug()}`, { headers: authHeaders() });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new ApiError(res.status, data?.error?.code ?? 'receipt', data?.error?.message ?? 'Чек не найден');
    }
    return res.blob();
  },
  chat: (before?: string) => get<ChatPage>('/api/chat', { before }),
  sendChat: (text: string, productId?: string, media?: { mediaUrl: string; mediaType: 'image' | 'video' }) => post<{ id: string }>('/api/chat', { text, productId, ...media }),
  uploadChatMedia: async (file: File): Promise<{ mediaUrl: string; mediaType: 'image' | 'video' }> => {
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch(`${BASE}/api/chat/media?store=${getStoreSlug()}`, { method: 'POST', headers: authHeaders(), body: fd });
    const data = await res.json();
    if (!res.ok) throw new ApiError(res.status, data?.error?.code ?? 'upload', data?.error?.message ?? 'Не удалось загрузить вложение');
    return { mediaUrl: data.url, mediaType: data.mediaType };
  },
  chatMedia: async (id: string) => {
    const res = await fetch(`${BASE}/api/chat/media/${id}?store=${getStoreSlug()}`, { headers: authHeaders() });
    if (!res.ok) throw new ApiError(res.status, 'chat_media', 'Вложение недоступно');
    return res.blob();
  },

  reviews: () => get<{ items: Review[]; rating: number; reviewsCount: number }>('/api/reviews'),
  createReview: (body: unknown) => post<{ review: Review }>('/api/reviews', body),

  profile: () => get<Profile>('/api/profile'),
  logEvent: (type: string, productId?: string) => post('/api/events', { type, productId }).catch(() => undefined),
  upload: async (files: FileList | File[], orderId?: string): Promise<string[]> => {
    const fd = new FormData();
    Array.from(files).forEach((f) => fd.append('files', f));
    const params = new URLSearchParams({ store: getStoreSlug(), purpose: orderId ? 'review' : 'store' });
    if (orderId) params.set('orderId', orderId);
    const res = await fetch(`${BASE}/api/uploads?${params}`, {
      method: 'POST',
      headers: { ...authHeaders() },
      body: fd,
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new ApiError(res.status, data?.error?.code ?? 'upload', data?.error?.message ?? 'Не удалось загрузить фото');
    }
    return (await res.json()).urls as string[];
  },
};

// ---------- Админ-панель продавца ----------

export const adminApi = {
  overview: (storeId: string) => get(`/api/admin/${storeId}/overview`),
  products: (storeId: string, query?: Record<string, unknown>) =>
    get<{ items: Product[]; hasMore: boolean }>(`/api/admin/${storeId}/products`, query),
  product: (storeId: string, id: string) => get<{ product: Product }>(`/api/admin/${storeId}/products/${id}`),
  createProduct: (storeId: string, body: unknown) => post<{ product: Product }>(`/api/admin/${storeId}/products`, body),
  updateProduct: (storeId: string, id: string, body: unknown) =>
    patch<{ product: Product }>(`/api/admin/${storeId}/products/${id}`, body),
  setStatus: (storeId: string, id: string, status: string) =>
    post(`/api/admin/${storeId}/products/${id}/status`, { status }),
  duplicate: (storeId: string, id: string) => post(`/api/admin/${storeId}/products/${id}/duplicate`),
  archive: (storeId: string, id: string) => post(`/api/admin/${storeId}/products/${id}/archive`),
  bulkArchive: (storeId: string, ids: string[]) => post(`/api/admin/${storeId}/products/bulk-archive`, { ids }),

  categories: (storeId: string) => get<{ categories: Category[] }>(`/api/admin/${storeId}/categories`),
  createCategory: (storeId: string, body: unknown) => post(`/api/admin/${storeId}/categories`, body),
  updateCategory: (storeId: string, id: string, body: unknown) => patch(`/api/admin/${storeId}/categories/${id}`, body),
  archiveCategory: (storeId: string, id: string) => post(`/api/admin/${storeId}/categories/${id}/archive`),

  orders: (storeId: string, query?: Record<string, unknown>) =>
    get<{ items: Order[]; hasMore: boolean }>(`/api/admin/${storeId}/orders`, query),
  orderAction: (storeId: string, id: string, action: 'accept' | 'reject' | 'send' | 'complete' | 'payment-confirm') =>
    post(`/api/admin/${storeId}/orders/${id}/${action}`),
  orderRefund: (storeId: string, id: string, reference: string) => post(`/api/admin/${storeId}/orders/${id}/refund`, { reference }),
  manualShipment: (storeId: string, id: string, trackingNumber: string) => post(`/api/admin/${storeId}/orders/${id}/manual-shipment`, { trackingNumber }),
  cdekConnection: (storeId: string) => get<{ connection: { connected: boolean; clientId?: string; mode?: 'test' | 'live'; originCityCode?: number; originPoint?: string; senderName?: string; senderPhone?: string; weight?: number; length?: number; width?: number; height?: number } }>(`/api/admin/${storeId}/delivery/cdek`),
  saveCdekConnection: (storeId: string, body: unknown) => put<{ connected: boolean; mode: 'test' | 'live' }>(`/api/admin/${storeId}/delivery/cdek`, body),
  removeCdekConnection: (storeId: string) => del(`/api/admin/${storeId}/delivery/cdek`),
  cdekQuote: (storeId: string, id: string) => post<{ quote: { originPoint: string; tariffCode: number; tariffName: string; price: number; periodMin?: number; periodMax?: number }; mode: 'test' | 'live' }>(`/api/admin/${storeId}/orders/${id}/cdek/quote`),
  cdekCreate: (storeId: string, id: string, mode: 'test' | 'live', tariffCode: number, priceAmount: number) => post(`/api/admin/${storeId}/orders/${id}/cdek/create`, { mode, tariffCode, priceAmount, confirmed: true }),
  cdekCheck: (storeId: string, id: string) => post(`/api/admin/${storeId}/orders/${id}/cdek/check`),
  cdekManualPrice: (storeId: string, id: string, price: number) => post(`/api/admin/${storeId}/orders/${id}/cdek/manual-price`, { price }),
  cdekManualTracking: (storeId: string, id: string, trackingNumber: string) => post(`/api/admin/${storeId}/orders/${id}/cdek/manual-tracking`, { trackingNumber }),
  chats: (storeId: string) => get<{ items: ChatThreadSummary[] }>(`/api/admin/${storeId}/chats`),
  chat: (storeId: string, buyerId: string, before?: string) => get<ChatPage>(`/api/admin/${storeId}/chats/${buyerId}`, { before }),
  sendChat: (storeId: string, buyerId: string, text: string, media?: { mediaUrl: string; mediaType: 'image' | 'video' }, productId?: string) => post<{ id: string }>(`/api/admin/${storeId}/chats/${buyerId}`, { text, productId, ...media }),

  reviews: (storeId: string) => get<{ items: Review[] }>(`/api/admin/${storeId}/reviews`),
  replyReview: (storeId: string, id: string, reply: string) => post(`/api/admin/${storeId}/reviews/${id}/reply`, { reply }),
  setReviewVisibility: (storeId: string, id: string, status: 'published' | 'hidden') =>
    post(`/api/admin/${storeId}/reviews/${id}/visibility`, { status }),

  settings: (storeId: string) => get<{ store: Store; paymentDetails: string; myRole: 'owner' | 'manager'; members: { userId: string; role: string; telegramId: string; firstName: string | null; username: string | null }[] }>(`/api/admin/${storeId}/settings`),
  updateSettings: (storeId: string, body: unknown) => patch<{ store: Store }>(`/api/admin/${storeId}/settings`, body),
  addMember: (storeId: string, telegramId: string) => post(`/api/admin/${storeId}/members`, { telegramId }),
  removeMember: (storeId: string, userId: string) => del(`/api/admin/${storeId}/members/${userId}`),
};

export async function downloadReceipt(id: string) {
  const blob = await api.receipt(id);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `receipt-${id}.${blob.type === 'application/pdf' ? 'pdf' : 'webp'}`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
