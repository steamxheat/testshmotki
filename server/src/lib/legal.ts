import { createHash } from 'node:crypto';
import type { Store } from '@prisma/client';
import { presentStoreSettings } from './present.js';

// Менять при содержательном изменении текстов политики или условий покупки.
const TEXT_VERSION = '2026-10-22-2';

export function legalVersion(store: Store) {
  const s = presentStoreSettings(store);
  const identity = [s.legalName, s.legalInn, s.legalAddress, s.legalEmail].join('|');
  return `${TEXT_VERSION}-${createHash('sha256').update(identity).digest('hex').slice(0, 12)}`;
}
