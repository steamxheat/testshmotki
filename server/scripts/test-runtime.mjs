import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const code = "import { config, assertRuntimeConfig } from './dist/config.js'; assertRuntimeConfig(); console.log(config.allowDevAuth)";
function check(env, success, devAuth) {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { ...process.env, NODE_ENV: '', BOT_TOKEN: '', ALLOW_DEV_AUTH: '', HOST: '', ...env },
  });
  assert.equal(result.status === 0, success, result.stderr);
  if (success) assert.equal(result.stdout.trim(), String(devAuth));
}

check({ NODE_ENV: 'development' }, true, false);
check({ NODE_ENV: 'development', ALLOW_DEV_AUTH: '1' }, true, true);
check({ NODE_ENV: 'development', ALLOW_DEV_AUTH: '1', HOST: '0.0.0.0' }, false);
check({ NODE_ENV: 'development', ALLOW_DEV_AUTH: '1', BOT_TOKEN: 'test' }, true, false);
check({ BOT_TOKEN: 'test' }, false);
check({ NODE_ENV: 'production', WEBAPP_URL: 'http://localhost:5173', BOT_TOKEN: 'test' }, false);
check({ NODE_ENV: 'production', WEBAPP_URL: 'https://shop.example.org', BOT_TOKEN: 'test' }, true, false);
console.log('OK: runtime auth configuration');
