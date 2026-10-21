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
  // Dev identities are never accepted alongside a real bot token.
  allowDevAuth: process.env.NODE_ENV === 'development' && process.env.ALLOW_DEV_AUTH === '1' && !process.env.BOT_TOKEN,
  botUsername: process.env.BOT_USERNAME ?? 'shmotki_app_bot',
  botPolling: process.env.BOT_POLLING !== '0',
  initDataMaxAgeSec: num(process.env.INITDATA_MAX_AGE_SEC, 86400),

  cdekClientId: process.env.CDEK_CLIENT_ID ?? '',
  cdekClientSecret: process.env.CDEK_CLIENT_SECRET ?? '',
  cdekApiUrl: process.env.CDEK_API_URL ?? 'https://api.cdek.ru/v2',

  reservationHours: num(process.env.RESERVATION_HOURS, 24),
};

export function assertRuntimeConfig() {
  if (!['development', 'production', 'test'].includes(config.env)) throw new Error('NODE_ENV must be development, test or production');
  if (config.allowDevAuth && process.env.HOST && !['127.0.0.1', 'localhost', '::1'].includes(process.env.HOST)) {
    throw new Error('ALLOW_DEV_AUTH requires a loopback HOST');
  }
  if (config.env !== 'production' && config.botToken && !process.env.NODE_ENV) {
    throw new Error('Set NODE_ENV explicitly before starting a server with BOT_TOKEN');
  }
  if (config.env === 'production' && (!config.botToken || !config.webappUrl.startsWith('https://'))) {
    throw new Error('Production requires BOT_TOKEN and an HTTPS WEBAPP_URL');
  }
}
