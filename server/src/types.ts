import type { Store, User } from '@prisma/client';

export interface AuthContext {
  user: User;
  telegramId: bigint;
  username?: string;
  startParam?: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
      store?: Store;
    }
  }
}

export {};
