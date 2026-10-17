#!/bin/sh
set -e

echo "[entrypoint] Применяю миграции БД…"
npx prisma migrate deploy

# Опциональный сид демо-данных при первом запуске: SEED_ON_START=1
if [ "$SEED_ON_START" = "1" ]; then
  echo "[entrypoint] Сидирование демо-данных…"
  node --import tsx prisma/seed.ts || echo "[entrypoint] Сид пропущен"
fi

echo "[entrypoint] Запуск сервера…"
exec node dist/index.js
