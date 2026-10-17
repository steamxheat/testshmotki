import { authHeaders, getStoreSlug } from './telegram';
import type {
  Category,
  Filters,
  Order,
  Product,
  Profile,
  Review,
  Store,
} from '../types';

// В проде VITE_API_URL пустой → API на том же origin (за nginx-прокси).
// В dev — http://localhost:4000 из .env.
const BASE = import.meta.env.VITE_API_URL || window.location.origin;

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
  const url = new URL(BASE + path);
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
const del = <T>(path: string) => request<T>(path, { method: 'DELETE' });

// ---------- Витрина покупателя ----------

export const api = {
  store: () => get<{ store: Store }>('/api/store'),
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

  createOrder: (body: unknown) => post<{ order: Order; chatUrl: string | null }>('/api/orders', body),
  orders: () => get<{ items: Order[] }>('/api/orders'),
  cancelOrder: (id: string) => post<{ ok: boolean }>(`/api/orders/${id}/cancel`),

  reviews: () => get<{ items: Review[]; rating: number; reviewsCount: number }>('/api/reviews'),
  createReview: (body: unknown) => post<{ review: Review }>('/api/reviews', body),

  profile: () => get<Profile>('/api/profile'),
  logEvent: (type: string, productId?: string) => post('/api/events', { type, productId }).catch(() => undefined),
  upload: async (files: FileList | File[]): Promise<string[]> => {
    const fd = new FormData();
    Array.from(files).forEach((f) => fd.append('files', f));
    const res = await fetch(`${BASE}/api/uploads?store=${getStoreSlug()}`, {
      method: 'POST',
      headers: { ...authHeaders() },
      body: fd,
    });
    if (!res.ok) throw new ApiError(res.status, 'upload', 'Не удалось загрузить фото');
    return (await res.json()).urls as string[];
  },
};

// ---------- Админ-панель продавца ----------

export const adminApi = {
  overview: (storeId: string) => get(`/api/admin/${storeId}/overview`),
  products: (storeId: string, query?: Record<string, unknown>) =>
    get<{ items: Product[] }>(`/api/admin/${storeId}/products`, query),
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
    get<{ items: Order[] }>(`/api/admin/${storeId}/orders`, query),
  orderAction: (storeId: string, id: string, action: 'accept' | 'reject' | 'complete') =>
    post(`/api/admin/${storeId}/orders/${id}/${action}`),

  reviews: (storeId: string) => get<{ items: Review[] }>(`/api/admin/${storeId}/reviews`),
  replyReview: (storeId: string, id: string, reply: string) => post(`/api/admin/${storeId}/reviews/${id}/reply`, { reply }),
  reportReview: (storeId: string, id: string, reason?: string) => post(`/api/admin/${storeId}/reviews/${id}/report`, { reason }),

  settings: (storeId: string) => get<{ store: Store; members: { userId: string; role: string; telegramId: string; firstName: string | null; username: string | null }[] }>(`/api/admin/${storeId}/settings`),
  updateSettings: (storeId: string, body: unknown) => patch<{ store: Store }>(`/api/admin/${storeId}/settings`, body),
  addMember: (storeId: string, telegramId: string) => post(`/api/admin/${storeId}/members`, { telegramId }),
  removeMember: (storeId: string, userId: string) => del(`/api/admin/${storeId}/members/${userId}`),
};

// ---------- Суперадмин ----------

export const superApi = {
  stores: () => get<{ stores: any[] }>('/api/superadmin/stores'),
  createStore: (body: unknown) => post('/api/superadmin/stores', body),
  block: (id: string) => post(`/api/superadmin/stores/${id}/block`),
  unblock: (id: string) => post(`/api/superadmin/stores/${id}/unblock`),
  setOwner: (id: string, telegramId: string) => post(`/api/superadmin/stores/${id}/owner`, { telegramId }),
  reports: () => get<{ reports: any[] }>('/api/superadmin/reports'),
  moderate: (body: unknown) => post('/api/superadmin/moderate', body),
  stats: () => get('/api/superadmin/stats'),
  audit: () => get<{ logs: any[] }>('/api/superadmin/audit'),
};
