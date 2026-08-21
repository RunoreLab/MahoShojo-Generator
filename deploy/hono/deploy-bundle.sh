#!/bin/sh
set -eu

release_id="${1:-}"
case "$release_id" in
  ''|*[!0-9a-f]*)
    echo "用法：$0 <64 位 SHA-256>" >&2
    exit 2
    ;;
esac
if [ "${#release_id}" -ne 64 ]; then
  echo "release id 必须是 64 位 SHA-256" >&2
  exit 2
fi

root_dir=/opt/mahoshojo-hono
release_dir="$root_dir/releases/$release_id"
compose_file="$root_dir/compose.yml"
runtime_env="$root_dir/.env.hono"
release_env="$root_dir/.env"
previous_env="$root_dir/.env.previous"

test -f "$release_dir/index.mjs"
test -f "$release_dir/index.mjs.sha256"
test -f "$compose_file"
test -f "$runtime_env"

expected_line="$release_id  index.mjs"
actual_line="$(sed -n '1p' "$release_dir/index.mjs.sha256")"
if [ "$actual_line" != "$expected_line" ]; then
  echo "校验文件内容不匹配" >&2
  exit 1
fi
(cd "$release_dir" && sha256sum -c index.mjs.sha256)

docker run --rm \
  --network mahoshojo-redis \
  --env-file "$runtime_env" \
  -e NODE_ENV=production \
  -e HONO_AUTH_MODE=bearer \
  -e HONO_CORS_ORIGINS=https://homura.colanns.me \
  -e REDIS_HOST=redis \
  -e REDIS_PORT=6379 \
  -e REDIS_REQUIRED=true \
  -e D1_REQUIRED=true \
  -e HONO_CONFIG_CHECK_ONLY=true \
  -v "$release_dir/index.mjs:/app/index.mjs:ro" \
  node:22-alpine node /app/index.mjs

had_previous=false
if [ -f "$release_env" ]; then
  cp "$release_env" "$previous_env"
  had_previous=true
fi
printf 'HONO_RELEASE_DIR=%s\n' "$release_dir" > "$release_env"

if docker compose --project-directory "$root_dir" -f "$compose_file" up -d --force-recreate hono; then
  attempt=0
  while [ "$attempt" -lt 24 ]; do
    if curl --fail --silent --show-error http://127.0.0.1:8080/health/ready >/dev/null; then
      echo "Hono 已发布：$release_id"
      exit 0
    fi
    attempt=$((attempt + 1))
    sleep 5
  done
fi

echo "新版本未就绪，开始回滚" >&2
if [ "$had_previous" = true ]; then
  mv "$previous_env" "$release_env"
  docker compose --project-directory "$root_dir" -f "$compose_file" up -d --force-recreate hono
else
  docker compose --project-directory "$root_dir" -f "$compose_file" down
  rm -f "$release_env"
fi
exit 1
