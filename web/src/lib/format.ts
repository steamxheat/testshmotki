import type { Condition, Currency, DeliveryMethod, OrderStatus } from '../types';

export const conditionLabel: Record<Condition, string> = {
  new_with_tag: 'Новое с биркой',
  new_no_tag: 'Новое без бирки',
  excellent: 'Отличное',
  good: 'Хорошее',
  has_issues: 'Есть нюансы',
};

export const deliveryLabel: Record<DeliveryMethod, string> = {
  meetup: 'Встреча',
  cdek: 'СДЭК',
  russian_post: 'Почта России',
  yandex_delivery: 'Яндекс Доставка',
  dhl: 'DHL',
  discuss: 'Обсудить с продавцом',
};

export const orderStatusLabel: Record<OrderStatus, string> = {
  pending: 'Ожидает подтверждения',
  confirmed: 'Подтверждён',
  sent: 'Отправлен',
  rejected: 'Отклонён',
  completed: 'Завершён',
  cancelled: 'Отменён',
  expired: 'Бронь истекла',
};

// статусы не кодируются только цветом — к цвету всегда идёт текст (§Доступность)
export const orderStatusTone: Record<OrderStatus, string> = {
  pending: 'tone-wait',
  confirmed: 'tone-ok',
  sent: 'tone-ok',
  rejected: 'tone-bad',
  completed: 'tone-done',
  cancelled: 'tone-muted',
  expired: 'tone-muted',
};

export function money(amount: number, currency: Currency = 'RUB'): string {
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency, minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(amount);
}

export function dateShort(iso: string): string {
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso));
}

export function timeLeft(iso: string | null): string | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return null;
  const h = Math.floor(ms / 3.6e6);
  const m = Math.floor((ms % 3.6e6) / 6e4);
  return h > 0 ? `${h} ч ${m} мин` : `${m} мин`;
}
