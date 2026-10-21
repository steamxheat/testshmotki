#!/usr/bin/env bash
set -euo pipefail
umask 077

# DATABASE_URL и BACKUP_DIR передаются окружением. Секреты не записываются в архив.
: "${DATABASE_URL:?Укажите DATABASE_URL}"
: "${BACKUP_DIR:?Укажите отдельный каталог BACKUP_DIR}"
command -v pg_dump >/dev/null || { echo 'Не найден pg_dump' >&2; exit 1; }
command -v pg_restore >/dev/null || { echo 'Не найден pg_restore' >&2; exit 1; }
pg_url="$(node -e 'const u = new URL(process.env.DATABASE_URL); u.searchParams.delete("schema"); process.stdout.write(u.toString())')"
server_major="$(psql "$pg_url" -Atqc 'SHOW server_version_num' | awk '{print int($1 / 10000)}')"
dump_major="$(pg_dump --version | sed -E 's/.* ([0-9]+)\..*/\1/')"
[[ "$server_major" == "$dump_major" ]] || { echo "Нужен pg_dump версии сервера PostgreSQL ($server_major), найден $dump_major" >&2; exit 1; }
project_root="$(cd "$(dirname "$0")/.." && pwd -P)"
mkdir -p -- "$BACKUP_DIR"
backup_root="$(cd "$BACKUP_DIR" && pwd -P)"
case "$backup_root" in
  /|"$project_root"|"$project_root"/*) echo 'BACKUP_DIR должен быть вне папки приложения' >&2; exit 1 ;;
esac

pending="$(mktemp -d "$backup_root/.pending-XXXXXXXX")"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
pg_dump --format=custom --file="$pending/database.dump" "$pg_url"
pg_restore --list "$pending/database.dump" >/dev/null
entries=()
for item in server/uploads .runtime/receipts .runtime/chat-media; do
  if [[ -d "$project_root/$item" ]]; then entries+=("$item"); fi
done
if (( ${#entries[@]} )); then
  tar -czf "$pending/media.tar.gz" -C "$project_root" "${entries[@]}"
else
  tar -czf "$pending/media.tar.gz" -T /dev/null
fi
tar -tzf "$pending/media.tar.gz" >/dev/null
(
  cd "$pending"
  if command -v sha256sum >/dev/null; then sha256sum database.dump media.tar.gz > SHA256SUMS
  else shasum -a 256 database.dump media.tar.gz > SHA256SUMS; fi
)
final="$backup_root/$stamp"
if [[ -e "$final" ]]; then echo 'Архив с этой меткой времени уже существует' >&2; exit 1; fi
mv -- "$pending" "$final"
echo "Резервная копия готова: $final"
