import crypto from 'node:crypto';
import { config } from '../config.js';

export interface TelegramUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  language_code?: string;
}

export interface VerifiedInitData {
  user: TelegramUser;
  startParam?: string;
  authDate: number;
}

/**
 * Проверка подписи Telegram WebApp initData (§10 ТЗ).
 * Алгоритм: secret = HMAC_SHA256(bot_token, "WebAppData");
 * hash = HMAC_SHA256(data_check_string, secret), где data_check_string —
 * пары key=value (кроме hash), отсортированные по ключу и склеенные через \n.
 * Доверять данным только с клиента запрещено — сервер обязательно проверяет подпись.
 */
export function verifyInitData(initData: string): VerifiedInitData | null {
  if (!config.botToken) return null;

  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');

  const dataCheckString = [...params.entries()]
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join('\n');

  const secretKey = crypto
    .createHmac('sha256', 'WebAppData')
    .update(config.botToken)
    .digest();
  const computedHash = crypto
    .createHmac('sha256', secretKey)
    .update(dataCheckString)
    .digest('hex');

  // сравнение в постоянном времени — защита от timing-атак
  const a = Buffer.from(computedHash, 'hex');
  const b = Buffer.from(hash, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  // ограничение срока действия initData (§10, §Безопасность)
  const authDate = Number(params.get('auth_date') ?? 0);
  const ageSec = Math.floor(Date.now() / 1000) - authDate;
  if (!authDate || ageSec > config.initDataMaxAgeSec) return null;

  const userRaw = params.get('user');
  if (!userRaw) return null;
  let user: TelegramUser;
  try {
    user = JSON.parse(userRaw);
  } catch {
    return null;
  }
  if (!user?.id) return null;

  return {
    user,
    startParam: params.get('start_param') ?? undefined,
    authDate,
  };
}
