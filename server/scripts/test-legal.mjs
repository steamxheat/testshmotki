import assert from 'node:assert/strict';
import { legalVersion } from '../dist/lib/legal.js';
import { presentStoreSettings } from '../dist/lib/present.js';

const store = { settings: { legalName: 'ИП Тестов Тест Тестович', legalInn: '123456789012', legalAddress: 'Россия, Москва, Тестовая, 1', legalEmail: 'shop@example.ru' } };
assert.equal(presentStoreSettings(store).legalReady, true);
assert.equal(presentStoreSettings({ settings: {} }).legalReady, false);
assert.equal(legalVersion(store), legalVersion(store));
assert.notEqual(legalVersion(store), legalVersion({ settings: { ...store.settings, legalEmail: 'new@example.ru' } }));
console.log('OK: legal details and notice version');
