import assert from 'node:assert/strict';
import { parsePrice } from './price.ts';

assert.equal(parsePrice('1500,50'), 1500.5);
assert.equal(parsePrice('1 500,50'), 1500.5);
assert.equal(parsePrice(''), 0);
assert.equal(Number.isNaN(parsePrice('1,2,3')), true);
