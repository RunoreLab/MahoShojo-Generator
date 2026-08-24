#!/bin/sh
set -eu

release_id="${1:-}"
public_base_url="${2:-}"
case "$release_id" in
  ''|*[!0-9a-f]*)
    echo "用法：$0 <64 位 SHA-256> <https://public-origin>" >&2
    exit 2
    ;;
esac
if [ "${#release_id}" -ne 64 ]; then
  echo "release id 必须是 64 位 SHA-256" >&2
  exit 2
fi
case "$public_base_url" in
  https://*) public_base_url="${public_base_url%/}" ;;
  *)
    echo "公网 contract probe 必须使用明确的 HTTPS origin" >&2
    exit 2
    ;;
esac

root_dir="${HONO_DEPLOY_ROOT_DIR:-/opt/mahoshojo-hono}"
case "$root_dir" in
  /) echo "部署根目录不得为文件系统根目录" >&2; exit 2 ;;
  /*) ;;
  *) echo "部署根目录必须是绝对路径" >&2; exit 2 ;;
esac
release_dir="$root_dir/releases/$release_id"
compose_file="$release_dir/compose.yml"
runtime_env="$root_dir/.env.hono"
release_env="$root_dir/.env"
release_env_next="$root_dir/.env.next"
previous_release_dir=''
previous_compose_file=''
had_previous=false
probe_headers="/tmp/mahoshojo-hono-probe-headers.$$"
probe_body="/tmp/mahoshojo-hono-probe-body.$$"

cleanup_probe() {
  rm -f "$probe_headers" "$probe_body"
}
trap cleanup_probe 0

for release_file in \
  index.mjs \
  compose.yml \
  deploy-bundle.sh \
  release.manifest \
  release.sha256
do
  test -f "$release_dir/$release_file"
done
test -f "$runtime_env"

expected_release_line="$release_id  release.manifest"
actual_release_line="$(sed -n '1p' "$release_dir/release.sha256")"
if [ "$actual_release_line" != "$expected_release_line" ]; then
  echo "release id 与 release.manifest 摘要不匹配" >&2
  exit 1
fi
(cd "$release_dir" && sha256sum -c release.sha256)
(cd "$release_dir" && sha256sum -c release.manifest)

if [ -f "$release_env" ]; then
  previous_release_dir="$(sed -n 's/^HONO_RELEASE_DIR=//p' "$release_env")"
  if [ -z "$previous_release_dir" ]; then
    echo "当前 release 环境文件缺少 HONO_RELEASE_DIR" >&2
    exit 1
  fi
  case "$previous_release_dir" in
    "$root_dir"/releases/*) ;;
    *) echo "当前 release 不属于受管 releases 目录" >&2; exit 1 ;;
  esac
  previous_compose_file="$previous_release_dir/compose.yml"
  if [ ! -f "$previous_compose_file" ]; then
    echo "当前 release 缺少 release-local compose，拒绝进入不可回滚事务" >&2
    exit 1
  fi
  had_previous=true
fi

docker run --rm \
  --network mahoshojo-redis \
  --env-file "$runtime_env" \
  -e NODE_ENV=production \
  -e HONO_AUTH_MODE=bearer \
  -e HONO_CORS_ORIGINS='https://*.colanns.me' \
  -e REDIS_HOST=redis \
  -e REDIS_PORT=6379 \
  -e REDIS_REQUIRED=true \
  -e D1_REQUIRED=true \
  -e HONO_CONFIG_CHECK_ONLY=true \
  -v "$release_dir/index.mjs:/app/index.mjs:ro" \
  node:22-alpine node /app/index.mjs

write_release_env() {
  target_release_dir="$1"
  printf 'HONO_RELEASE_DIR=%s\n' "$target_release_dir" > "$release_env_next" || return 1
  chmod 600 "$release_env_next" || return 1
  mv -f "$release_env_next" "$release_env" || return 1
}

wait_for_local_readiness() {
  attempt=0
  while [ "$attempt" -lt 24 ]; do
    if curl --fail --silent --show-error --connect-timeout 2 --max-time 4 \
      http://127.0.0.1:8080/health/ready >/dev/null; then
      return 0
    fi
    attempt=$((attempt + 1))
    sleep 5
  done
  return 1
}

activate_release() {
  write_release_env "$release_dir" || return 1
  docker compose --project-directory "$root_dir" -f "$compose_file" \
    up -d --force-recreate hono || return 1
  wait_for_local_readiness
}

verify_public_contract() {
  curl --fail --silent --show-error --retry 6 --retry-delay 5 \
    --connect-timeout 5 --max-time 15 \
    "$public_base_url/health/ready" >/dev/null || return 1
  if ! probe_status="$(curl --silent --show-error --retry 6 --retry-delay 5 \
    --connect-timeout 5 --max-time 15 \
    --dump-header "$probe_headers" --output "$probe_body" \
    --write-out '%{http_code}' \
    --request POST "$public_base_url/api/generate-magical-girl" \
    --header 'Origin: https://mahoshojo.colanns.me' \
    --header 'Content-Type: application/json' \
    --data '{}')"; then
    return 1
  fi
  test "$probe_status" = '400' || return 1
  grep -Fq '"error":"Name is required"' "$probe_body" || return 1
  grep -Fqi 'Access-Control-Allow-Origin: https://mahoshojo.colanns.me' "$probe_headers" || return 1
}

promote_release() {
  rm -f "$root_dir/current.next" || return 1
  ln -s "$release_dir" "$root_dir/current.next" || return 1
  mv -Tf "$root_dir/current.next" "$root_dir/current" || return 1
}

rollback_release() {
  echo "新 release 未通过完整 contract，开始回滚 tuple" >&2
  rm -f "$root_dir/current.next"
  if [ "$had_previous" = true ]; then
    write_release_env "$previous_release_dir" || return 1
    docker compose --project-directory "$root_dir" -f "$previous_compose_file" \
      up -d --force-recreate hono || return 1
    wait_for_local_readiness || return 1
  else
    docker compose --project-directory "$root_dir" -f "$compose_file" down || true
    rm -f "$release_env" "$release_env_next"
  fi
}

if activate_release && verify_public_contract && promote_release; then
  echo "Hono 已发布：$release_id"
  exit 0
fi

rollback_release
exit 1
