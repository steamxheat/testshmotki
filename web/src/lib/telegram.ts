// Обёртка над Telegram WebApp SDK (§10). В обычном браузере (dev) используется
// заглушка пользователя, чтобы отлаживать интерфейс без Telegram.

interface TgUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
}

interface TelegramWebApp {
  initData: string;
  initDataUnsafe: { user?: TgUser; start_param?: string };
  colorScheme: 'light' | 'dark';
  themeParams: Record<string, string>;
  ready: () => void;
  expand: () => void;
  onEvent?: (event: string, callback: () => void) => void;
  HapticFeedback?: { impactOccurred: (s: string) => void; notificationOccurred: (s: string) => void };
  setHeaderColor?: (c: string) => void;
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

export const tg = window.Telegram?.WebApp ?? null;
export const isTelegram = !!tg && !!tg.initData;

// Бэйр-slug магазина по умолчанию для dev-браузера (без startapp).
const DEFAULT_STORE = import.meta.env.VITE_DEFAULT_STORE ?? 'nikita';

// В dev-браузере генерируем и запоминаем стабильный id пользователя,
// чтобы избранное и заказы сохранялись между перезагрузками.
function devUser(): TgUser {
  const override = localStorage.getItem('devTelegramId');
  let id = Number(override);
  if (!id) {
    const saved = localStorage.getItem('devUserId');
    id = saved ? Number(saved) : Math.floor(500_000 + Math.random() * 400_000);
    localStorage.setItem('devUserId', String(id));
  }
  return { id, first_name: override ? 'Продавец' : 'Гость', username: override ? undefined : 'guest' };
}

export function getUser(): TgUser {
  return tg?.initDataUnsafe?.user ?? devUser();
}

function parseStartParam(): string | undefined {
  const url = new URL(window.location.href);
  if (url.searchParams.get('store')) return url.searchParams.get('store') ?? undefined;
  if (tg?.initDataUnsafe?.start_param) return tg.initDataUnsafe.start_param;
  // Telegram прокидывает стартовый параметр как tgWebAppStartParam
  return (
    url.searchParams.get('tgWebAppStartParam') ??
    url.searchParams.get('startapp') ??
    url.searchParams.get('store') ??
    undefined
  );
}

export function getStoreSlug(): string {
  const explicit = new URL(window.location.href).searchParams.get('store');
  if (explicit) return explicit;
  const p = parseStartParam();
  const initial = p ? (p.startsWith('store_') ? p.slice('store_'.length) : p) : DEFAULT_STORE;
  try { return sessionStorage.getItem(`store_slug_override_${initial}`) ?? initial; }
  catch { return initial; }
}

export function setCurrentStoreSlug(slug: string): void {
  const url = new URL(window.location.href);
  if (url.searchParams.has('store')) {
    url.searchParams.set('store', slug);
    window.history.replaceState(window.history.state, '', url);
    return;
  }
  const p = parseStartParam();
  const initial = p ? (p.startsWith('store_') ? p.slice('store_'.length) : p) : DEFAULT_STORE;
  try { sessionStorage.setItem(`store_slug_override_${initial}`, slug); } catch { /* storage unavailable */ }
}

// Заголовки авторизации для API (§10): либо подписанный initData, либо dev-пользователь.
// Dev-пользователя кодируем в base64 — значения HTTP-заголовков должны быть ISO-8859-1,
// а имя может содержать кириллицу.
function b64utf8(s: string): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(s)));
}
export function authHeaders(): Record<string, string> {
  if (isTelegram) return { 'X-Init-Data': tg!.initData };
  return { 'X-Dev-User': b64utf8(JSON.stringify(getUser())) };
}

// Применяем тему Telegram к CSS-переменным (§10, §15 — светлая и тёмная темы)
export function applyTheme(): void {
  const scheme = isTelegram ? tg!.colorScheme : (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  document.documentElement.dataset.theme = scheme;
  const p = isTelegram ? tg!.themeParams : {};
  const root = document.documentElement.style;
  const map: Record<string, string | undefined> = {
    '--tg-bg': p.bg_color,
    '--tg-text': p.text_color,
    '--tg-hint': p.hint_color,
    '--tg-link': p.link_color,
    '--tg-button': p.button_color,
    '--tg-button-text': p.button_text_color,
    '--tg-secondary-bg': p.secondary_bg_color,
  };
  for (const [k, v] of Object.entries(map)) if (v) root.setProperty(k, v);
}

export function initTelegram(): void {
  if (tg) {
    tg.ready();
    tg.expand();
    tg.onEvent?.('themeChanged', applyTheme);
  }
  applyTheme();
}

export function haptic(type: 'light' | 'medium' | 'heavy' | 'success' | 'error' = 'light'): void {
  try {
    if (type === 'success' || type === 'error') tg?.HapticFeedback?.notificationOccurred(type);
    else tg?.HapticFeedback?.impactOccurred(type);
  } catch {
    /* no-op */
  }
}
