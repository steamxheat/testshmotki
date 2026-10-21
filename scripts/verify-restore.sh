#!/usr/bin/env bash
set -euo pipefail
: "${BACKUP_SET:?Укажите полный путь к архиву BACKUP_SET}"
: "${RESTORE_DATABASE_URL:?Укажите URL пустой тестовой базы RESTORE_DATABASE_URL}"
case "$RESTORE_DATABASE_URL" in
  */shmotki_restore_[a-zA-Z0-9_]*) ;;
  *) echo 'Название тестовой БД должно начинаться с shmotki_restore_' >&2; exit 1 ;;
esac
pg_url="$(node -e 'const u = new URL(process.env.RESTORE_DATABASE_URL); u.searchParams.delete("schema"); process.stdout.write(u.toString())')"
server_major="$(psql "$pg_url" -Atqc 'SHOW server_version_num' | awk '{print int($1 / 10000)}')"
restore_major="$(pg_restore --version | sed -E 's/.* ([0-9]+)\..*/\1/')"
[[ "$server_major" == "$restore_major" ]] || { echo "Нужен pg_restore версии тестового PostgreSQL ($server_major), найден $restore_major" >&2; exit 1; }
[[ -f "$BACKUP_SET/database.dump" && -f "$BACKUP_SET/media.tar.gz" && -f "$BACKUP_SET/SHA256SUMS" ]] || { echo 'Неполный архив' >&2; exit 1; }
(
  cd "$BACKUP_SET"
  if command -v sha256sum >/dev/null; then sha256sum -c SHA256SUMS
  else shasum -a 256 -c SHA256SUMS; fi
)
tar -tzf "$BACKUP_SET/media.tar.gz" >/dev/null
pg_restore --list "$BACKUP_SET/database.dump" >/dev/null
tables="$(psql "$pg_url" -Atqc "SELECT COUNT(*) FROM pg_tables WHERE schemaname='public'")"
[[ "$tables" == 0 ]] || { echo 'Тестовая БД не пуста — ничего не восстановлено' >&2; exit 1; }
pg_restore --no-owner --no-privileges --exit-on-error --dbname="$pg_url" "$BACKUP_SET/database.dump"
psql "$pg_url" -Atqc 'SELECT COUNT(*) FROM stores' >/dev/null
echo 'Пробное восстановление БД прошло. Медиаархив и контрольные суммы проверены.'
