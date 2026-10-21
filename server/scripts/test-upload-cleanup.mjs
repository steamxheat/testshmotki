import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const original = process.cwd();
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'shmotki-upload-test-'));
try {
  process.chdir(temp);
  const { removeUnusedUploads, UPLOAD_DIR } = await import('../dist/lib/upload.js');
  const old = crypto.randomUUID();
  const recent = crypto.randomUUID();
  for (const filename of [`${old}.webp`, `${old}_thumb.webp`, `${recent}.webp`]) {
    await fs.writeFile(path.join(UPLOAD_DIR, filename), 'test');
  }
  const weekAgo = new Date(Date.now() - 8 * 864e5);
  for (const filename of [`${old}.webp`, `${old}_thumb.webp`]) await fs.utimes(path.join(UPLOAD_DIR, filename), weekAgo, weekAgo);
  assert.equal(await removeUnusedUploads(), 2);
  assert.deepEqual(await fs.readdir(UPLOAD_DIR), [`${recent}.webp`]);
  console.log('OK: старые неиспользуемые фото удалены, свежие сохранены');
} finally {
  process.chdir(original);
  await fs.rm(temp, { recursive: true, force: true });
}
