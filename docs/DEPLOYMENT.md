# Деплой «Шмотки» в прод

> Устаревшая инструкция для прежней Docker-конфигурации с суперадмином. Текущий продукт — одна установка на одного продавца без суперадмина. Для нового клиента используйте [SELLER_LAUNCH.md](./SELLER_LAUNCH.md). Не выполняйте команды ниже на действующем сервере.

Прод-сборка состоит из трёх контейнеров (см. [`docker-compose.prod.yml`](../docker-compose.prod.yml)):

- **db** — PostgreSQL 16 (том `pgdata`);
- **server** — Node API + Telegram-бот + cron брони (том `uploads` для изображений);
- **web** — nginx со статикой Mini App; проксирует `/api` и `/uploads` на server.

Клиент и API живут на одном домене, поэтому CORS и смешанные origin не нужны.

## 1. Требования

- Хост с Docker и Docker Compose v2.
- Домен с HTTPS (Telegram Mini App работает **только по HTTPS**).
- Бот, созданный у [@BotFather](https://t.me/BotFather), и его `BOT_TOKEN`.

## 2. Настройка окружения

```bash
cp .env.prod.example .env.prod
# отредактируйте .env.prod:
#   PUBLIC_URL      — публичный HTTPS-адрес (https://shop.example.com)
#   BOT_TOKEN       — токен бота
#   BOT_USERNAME    — username бота без @
#   SUPERADMIN_IDS  — ваш Telegram ID (узнать: @userinfobot)
#   POSTGRES_PASSWORD — задайте надёжный пароль
#   SEED_ON_START=1 — если нужен демо-магазин при первом запуске
```

`PUBLIC_URL` должен совпадать с адресом, который вы укажете в @BotFather, и использоваться
для абсолютных ссылок на картинки, поэтому укажите именно внешний HTTPS-домен.

## 3. Запуск

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --build
```

При старте контейнер server автоматически применяет миграции (`prisma migrate deploy`).
Проверка: `curl https://<домен>/api/health` → `{"ok":true,...}`.

Логи: `docker compose -f docker-compose.prod.yml logs -f server`.

## 4. HTTPS

Контейнер `web` слушает 80 по HTTP. Поставьте перед ним TLS-терминатор:

**Вариант A — Caddy (проще всего):**

```caddyfile
shop.example.com {
    reverse_proxy localhost:80
}
```

**Вариант B — nginx/Traefik** на хосте: проксируйте 443 → `web:80`.
Или добавьте в compose отдельный caddy/traefik-сервис. Главное — чтобы внешний адрес
был HTTPS и совпадал с `PUBLIC_URL`.

> Если TLS-прокси занимает порт 80/443, поставьте `WEB_PORT=8080` в `.env.prod`
> и проксируйте на этот порт.

## 5. Регистрация Mini App в @BotFather

1. `/newapp` → выберите бота → задайте название, описание, иконку.
2. **Web App URL** = `PUBLIC_URL` (например `https://shop.example.com`).
3. Ссылка на витрину продавца: `https://t.me/<BOT_USERNAME>/app?startapp=store_<slug>`.
4. (Необязательно) `/setmenubutton` — кнопка «Открыть магазин».

Бот сам отвечает на `/start` и `/start store_<slug>` кнопкой запуска Mini App.

## 6. Первичное наполнение

Магазины создаёт суперадмин (ваш `SUPERADMIN_IDS`): откройте Mini App → Профиль →
«Панель суперадмина» → «Создать магазин» (slug, название, Telegram ID владельца).
Либо `SEED_ON_START=1` для демо-магазина `store_nikita`.

## 7. Резервное копирование БД (§11 Надёжность)

Ежедневный дамп по cron на хосте:

```bash
0 3 * * * docker exec $(docker ps -qf name=db) \
  pg_dump -U shmotki shmotki | gzip > /backups/shmotki_$(date +\%F).sql.gz
```

Восстановление:

```bash
gunzip -c backup.sql.gz | docker exec -i <db-container> psql -U shmotki -d shmotki
```

Том `uploads` с изображениями копируйте отдельно (`docker run --rm -v <proj>_uploads:/d -v $PWD:/b alpine tar czf /b/uploads.tgz -C /d .`).

## 8. Обновление версии

```bash
git pull
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --build
```

Новые миграции применятся автоматически при старте server.

## 9. Изображения

Загруженные фото обрабатываются `sharp`: авто-ориентация, ресайз (полное ≤1600px,
миниатюра ≤500px), конвертация в WebP, удаление EXIF. Хранятся в томе `uploads`.
Для масштабирования вынесите хранение в S3/объектное хранилище — точка замены
в [`server/src/lib/upload.ts`](../server/src/lib/upload.ts) (`processUploads`/`publicUrl`).

## 10. Производственные заметки

- `BOT_POLLING=1` — бот работает через long polling (просто и надёжно для одного инстанса).
  Для нескольких реплик server переключитесь на webhook и оставьте polling только на одном.
- Cron снятия брони работает внутри каждого инстанса server; при нескольких репликах
  оставьте его на одном (операции идемпотентны, но лишние проверки не нужны).
- Секреты только в `.env.prod` (не коммитится). Логи не содержат токенов и лишних ПДн.
