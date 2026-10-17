import 'dotenv/config';

function num(v: string | undefined, def: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

export const config = {
  env: process.env.NODE_ENV ?? 'development',
  isDev: (process.env.NODE_ENV ?? 'development') === 'development',
  port: num(process.env.PORT, 4000),
  publicApiUrl: process.env.PUBLIC_API_URL ?? 'http://localhost:4000',
  webappUrl: process.env.WEBAPP_URL ?? 'http://localhost:5173',
  webOrigin: process.env.WEB_ORIGIN ?? 'http://localhost:5173',

  botToken: process.env.BOT_TOKEN ?? '',
  botUsername: process.env.BOT_USERNAME ?? 'shmotki_app_bot',
  botPolling: process.env.BOT_POLLING !== '0',
  initDataMaxAgeSec: num(process.env.INITDATA_MAX_AGE_SEC, 86400),

  superadminIds: (process.env.SUPERADMIN_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  reservationHours: num(process.env.RESERVATION_HOURS, 24),
};

export function isSuperadmin(telegramId: bigint | number | string): boolean {
  return config.superadminIds.includes(String(telegramId));
}
