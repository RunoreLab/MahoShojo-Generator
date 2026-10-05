#!/bin/sh
set -eu

usage() {
  echo "用法：$0 publish <64 位 SHA-256> <https://public-origin>" >&2
  echo "   或：$0 rollback <64 位 SHA-256> <https://public-origin>" >&2
  exit 2
}

[ "$#" -eq 3 ] || usage
mode="$1"
release_id="$2"
public_base_url="$3"
case "$mode" in publish|rollback) ;; *) usage ;; esac
case "$release_id" in
  ''|*[!0-9a-f]*) echo 'release id 必须是 64 位小写十六进制 SHA-256' >&2; exit 2 ;;
esac
[ "${#release_id}" -eq 64 ] || {
  echo 'release id 必须是 64 位小写十六进制 SHA-256' >&2
  exit 2
}
case "$public_base_url" in
  https://*) public_base_url="${public_base_url%/}" ;;
  *) echo '公网 probe 必须使用明确的 HTTPS origin' >&2; exit 2 ;;
esac

root_dir="${HONO_DEPLOY_ROOT_DIR:-/opt/mahoshojo-hono}"
bind_port="${HONO_BIND_PORT:-8080}"
redis_key_prefix="${HONO_REDIS_KEY_PREFIX:-}"
redis_network_name="${HONO_REDIS_NETWORK_NAME:-mahoshojo-redis}"
hosted_api_environment="${HONO_HOSTED_API_ENVIRONMENT:-}"
container_name="${HONO_CONTAINER_NAME:-mahoshojo-hono}"
runtime_image='node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32'
web_origin='https://mahoshojo.colanns.me'
preview_web_origin='https://maho-preview.colanns.me'
preview_cors_origin='https://*.colanns.me'
preview_cloudflare_web_origin='https://mahoshojo-next-preview.719147538.workers.dev'
cors_origins="$web_origin"
room_allowed_origins="$web_origin"

case "$root_dir" in /|''|[!/]*) echo '部署根目录必须是非根绝对路径' >&2; exit 2 ;; esac
case "$bind_port" in ''|*[!0-9]*) echo 'HONO_BIND_PORT 必须是数字' >&2; exit 2 ;; esac
case "$redis_network_name" in
  ''|*[!A-Za-z0-9_.-]*) echo 'HONO_REDIS_NETWORK_NAME 非法' >&2; exit 2 ;;
esac
case "$container_name" in
  ''|*[!A-Za-z0-9_.-]*) echo 'HONO_CONTAINER_NAME 非法' >&2; exit 2 ;;
esac

case "$hosted_api_environment" in
  production)
    [ "$root_dir" = '/opt/mahoshojo-hono' ] \
      && [ "$public_base_url" = 'https://homura.colanns.me' ] \
      && [ -z "$redis_key_prefix" ] || {
      echo 'production target 路径、origin 或 Redis prefix 非法' >&2
      exit 2
    }
    ;;
  preview)
    [ "$root_dir" = '/opt/mahoshojo-hono-preview' ] \
      && [ "$public_base_url" = 'https://homura-preview.colanns.me' ] \
      && [ "$redis_key_prefix" = 'preview' ] || {
      echo 'preview target 路径、origin 或 Redis prefix 非法' >&2
      exit 2
    }
    cors_origins="$web_origin,$preview_cors_origin,$preview_cloudflare_web_origin"
    room_allowed_origins="$web_origin,$preview_web_origin,$preview_cloudflare_web_origin"
    ;;
  test)
    case "$root_dir" in
      /opt/mahoshojo-hono|/opt/mahoshojo-hono-preview)
        if [ "$mode" = rollback ]; then
          echo '显式 rollback 只允许 production/preview target' >&2
        else
          echo 'test target 不得使用 production/preview 受管根' >&2
        fi
        exit 2
        ;;
    esac
    ;;
  *) echo 'HONO_HOSTED_API_ENVIRONMENT 必须是 production、preview 或 test' >&2; exit 2 ;;
esac
export HONO_DEPLOY_CORS_ORIGINS="$cors_origins"

releases_dir="$root_dir/releases"
release_dir="$releases_dir/$release_id"
runtime_env="$root_dir/.env.hono"
current_link="$root_dir/current"
lock_file="$root_dir/deploy.lock"
previous_release_dir=''
had_previous=false

is_release_dir() {
  candidate="$1"
  candidate_id="${candidate##*/}"
  case "$candidate_id" in ''|*[!0-9a-f]*) return 1 ;; esac
  [ "${#candidate_id}" -eq 64 ] \
    && [ "$candidate" = "$releases_dir/$candidate_id" ] \
    && [ -d "$candidate" ] \
    && [ ! -L "$candidate" ]
}

verify_release_identity() {
  candidate="$1"
  is_release_dir "$candidate" || {
    echo 'release 不属于受管目录' >&2
    return 1
  }
  candidate_id="${candidate##*/}"
  for asset in index.mjs compose.yml deploy-bundle.sh release.manifest release.sha256; do
    [ -f "$candidate/$asset" ] && [ ! -L "$candidate/$asset" ] || {
      echo "release 缺少普通文件：$asset" >&2
      return 1
    }
  done
  [ "$(wc -l < "$candidate/release.sha256" | tr -d ' ')" -eq 1 ] || return 1
  [ "$(cat "$candidate/release.sha256")" = "$candidate_id  release.manifest" ] || {
    echo 'release id 与 manifest 摘要不一致' >&2
    return 1
  }
  for asset in index.mjs compose.yml deploy-bundle.sh; do
    [ "$(grep -Ec "^[0-9a-f]{64}  ${asset}$" "$candidate/release.manifest")" -eq 1 ] \
      || return 1
  done
  (cd "$candidate" && sha256sum -c release.sha256 >/dev/null)
}

verify_release() {
  candidate="$1"
  verify_release_identity "$candidate" || return 1
  [ "$(wc -l < "$candidate/release.manifest" | tr -d ' ')" -eq 3 ] || return 1
  (cd "$candidate" && sha256sum -c release.manifest >/dev/null)
}

verify_previous_release() {
  candidate="$1"
  verify_release_identity "$candidate" || return 1
  manifest_lines="$(wc -l < "$candidate/release.manifest" | tr -d ' ')"
  case "$manifest_lines" in
    3) ;;
    4)
      [ "$(grep -Ec '^[0-9a-f]{64}  legacy-layout$' "$candidate/release.manifest")" -eq 1 ] \
        && [ -f "$candidate/legacy-layout" ] \
        && [ ! -L "$candidate/legacy-layout" ] || return 1
      ;;
    5)
      for retired_asset in arena-room-release-gate.json arena-room-release-gate-schema.mjs; do
        [ "$(grep -Ec "^[0-9a-f]{64}  ${retired_asset}$" "$candidate/release.manifest")" -eq 1 ] \
          && [ -f "$candidate/$retired_asset" ] \
          && [ ! -L "$candidate/$retired_asset" ] || return 1
      done
      ;;
    *)
      echo 'previous release manifest 不是可迁移格式' >&2
      return 1
      ;;
  esac
  (cd "$candidate" && sha256sum -c release.manifest >/dev/null)
}

read_runtime_value() {
  key="$1"
  count="$(grep -Ec "^${key}=" "$runtime_env" || true)"
  [ "$count" -le 1 ] || {
    echo "Hono runtime env 存在重复键：$key" >&2
    return 1
  }
  [ "$count" -eq 1 ] && sed -n "s/^${key}=//p" "$runtime_env" || true
}

multiplayer_is_enabled() {
  value="$(read_runtime_value ARENA_MULTIPLAYER_ENABLED)" || return 1
  value="$(printf '%s' "$value" | tr '[:upper:]' '[:lower:]')"
  case "$value" in
    1|true|yes|on) return 0 ;;
    ''|0|false|no|off) return 1 ;;
    *) echo 'ARENA_MULTIPLAYER_ENABLED 必须是 boolean 值' >&2; return 2 ;;
  esac
}

validate_arena_room_runtime_allowed_origins() {
  _release_dir="$1"
  if multiplayer_is_enabled; then
    multiplayer_status=0
  else
    multiplayer_status=$?
  fi
  [ "$multiplayer_status" -ne 2 ] || return 1
  [ "$multiplayer_status" -eq 0 ] || return 0
  case "$hosted_api_environment" in production|preview) ;; *) return 0 ;; esac
  configured_origins="$(read_runtime_value ARENA_ROOM_ALLOWED_ORIGINS)" || return 1
  [ "$configured_origins" = "$room_allowed_origins" ] || {
    echo 'ARENA_ROOM_ALLOWED_ORIGINS 与 target exact-set 不一致' >&2
    return 1
  }
}

validate_release_config() {
  candidate="$1"
  HONO_RELEASE_DIR="$candidate" docker compose \
    --project-directory "$root_dir" -f "$candidate/compose.yml" config >/dev/null
  docker run --rm \
    --network "$redis_network_name" \
    --env-file "$runtime_env" \
    -e NODE_ENV=production \
    -e HOSTED_API_ENVIRONMENT="$hosted_api_environment" \
    -e HONO_AUTH_MODE=bearer \
    -e HONO_CORS_ORIGINS="$cors_origins" \
    -e REDIS_HOST=redis \
    -e REDIS_PORT=6379 \
    -e REDIS_REQUIRED=true \
    -e REDIS_KEY_PREFIX="$redis_key_prefix" \
    -e D1_REQUIRED=true \
    -e HONO_CONFIG_CHECK_ONLY=true \
    -v "$candidate/index.mjs:/app/index.mjs:ro" \
    "$runtime_image" node /app/index.mjs >/dev/null
}

activate_release() {
  candidate="$1"
  HONO_RELEASE_DIR="$candidate" docker compose \
    --project-directory "$root_dir" -f "$candidate/compose.yml" \
    up -d --force-recreate hono
  attempt=0
  while [ "$attempt" -lt 30 ]; do
    if curl --fail --silent --show-error --connect-timeout 2 --max-time 4 \
      "http://127.0.0.1:$bind_port/health/ready" >/dev/null; then
      return 0
    fi
    attempt=$((attempt + 1))
    sleep 2
  done
  return 1
}

point_current_to() {
  candidate="$1"
  rm -f "$root_dir/current.next"
  ln -s "$candidate" "$root_dir/current.next"
  mv -Tf "$root_dir/current.next" "$current_link"
}

verify_public_health() {
  curl --fail --silent --show-error --retry 6 --retry-delay 2 \
    --connect-timeout 5 --max-time 15 \
    "$public_base_url/api/health/ready" >/dev/null
}

probe_dir=''
cleanup_probe() {
  [ -z "$probe_dir" ] || rm -rf "$probe_dir"
}
trap cleanup_probe EXIT

verify_public_contract() {
  verify_public_health || return 1
  probe_dir="$(mktemp -d /tmp/mahoshojo-hono-probe.XXXXXX)" || return 1
  probe_headers="$probe_dir/headers"
  probe_body="$probe_dir/body"
  probe_status="$probe_dir/status"
  normalized_headers="$probe_dir/headers.normalized"

  curl --silent --show-error --retry 6 --retry-delay 2 \
    --connect-timeout 5 --max-time 15 \
    --dump-header "$probe_headers" --output "$probe_body" --write-out '%{http_code}' \
    --request POST "$public_base_url/api/generate-magical-girl" \
    --header "Origin: $web_origin" --header 'Content-Type: application/json' \
    --data '{}' > "$probe_status" || return 1
  [ "$(cat "$probe_status")" = 400 ] \
    && grep -Fq '"error":"Name is required"' "$probe_body" \
    && grep -Fqi "Access-Control-Allow-Origin: $web_origin" "$probe_headers" \
    || return 1

  if multiplayer_is_enabled; then
    multiplayer_status=0
  else
    multiplayer_status=$?
  fi
  [ "$multiplayer_status" -ne 2 ] || return 1
  room_probe_origins="$web_origin"
  [ "$hosted_api_environment" != preview ] \
    || room_probe_origins="$web_origin $preview_web_origin $preview_cloudflare_web_origin"
  for room_probe_origin in $room_probe_origins; do
    curl --silent --show-error --retry 6 --retry-delay 2 \
      --connect-timeout 5 --max-time 15 \
      --dump-header "$probe_headers" --output "$probe_body" --write-out '%{http_code}' \
      --header "Origin: $room_probe_origin" \
      "$public_base_url/api/arena/rooms/v1" > "$probe_status" || return 1
    room_status="$(cat "$probe_status")"
    if [ "$multiplayer_status" -eq 0 ]; then
      [ "$room_status" = 401 ] || return 1
      tr -d '\r' < "$probe_headers" > "$normalized_headers"
      grep -Fixq "Access-Control-Allow-Origin: $room_probe_origin" "$normalized_headers" \
        || return 1
    else
      case "$room_status" in 101|2??) return 1 ;; esac
    fi

    websocket_key="$(head -c 16 /dev/urandom | base64)" || return 1
    curl --silent --show-error --retry 6 --retry-delay 2 --http1.1 \
      --connect-timeout 5 --max-time 15 \
      --dump-header "$probe_headers" --output "$probe_body" --write-out '%{http_code}' \
      --header "Origin: $room_probe_origin" \
      --header 'Connection: Upgrade' --header 'Upgrade: websocket' \
      --header 'Sec-WebSocket-Version: 13' \
      --header "Sec-WebSocket-Key: $websocket_key" \
      --header 'Sec-WebSocket-Protocol: mahoshojo.arena-room.v1' \
      "$public_base_url/api/arena/rooms/v1/ws" > "$probe_status" || return 1
    websocket_status="$(cat "$probe_status")"
    if [ "$multiplayer_status" -eq 0 ]; then
      [ "$websocket_status" = 401 ] || return 1
    else
      case "$websocket_status" in 101|2??) return 1 ;; esac
    fi
  done
}

restore_previous() {
  if [ "$had_previous" = true ]; then
    echo 'candidate 未通过部署检查，恢复 previous release' >&2
    activate_release "$previous_release_dir" && verify_public_health
    return
  fi
  echo '首次发布未通过部署检查，停止 candidate' >&2
  HONO_RELEASE_DIR="$release_dir" docker compose \
    --project-directory "$root_dir" -f "$release_dir/compose.yml" down
}

for command_name in base64 curl docker flock head id mktemp realpath sha256sum stat; do
  command -v "$command_name" >/dev/null 2>&1 || {
    echo "部署主机缺少必需工具：$command_name" >&2
    exit 1
  }
done
[ -d "$root_dir" ] && [ ! -L "$root_dir" ] \
  && [ -d "$releases_dir" ] && [ ! -L "$releases_dir" ] \
  && [ "$(realpath -e "$root_dir")" = "$root_dir" ] \
  && [ "$(realpath -e "$releases_dir")" = "$releases_dir" ] || {
  echo '部署根目录与 releases 必须是 canonical 普通目录' >&2
  exit 1
}
[ -f "$runtime_env" ] && [ ! -L "$runtime_env" ] \
  && [ "$(stat -c '%a' "$runtime_env")" = 600 ] \
  && [ "$(stat -c '%u' "$runtime_env")" = "$(id -u)" ] || {
  echo 'Hono runtime env 必须是当前用户所有的 0600 普通文件' >&2
  exit 1
}
verify_release "$release_dir"
validate_arena_room_runtime_allowed_origins "$release_dir"

if [ -e "$current_link" ] || [ -L "$current_link" ]; then
  [ -L "$current_link" ] || {
    echo 'current 必须是指向 release 的符号链接' >&2
    exit 1
  }
  previous_release_dir="$(readlink "$current_link")"
  is_release_dir "$previous_release_dir" && verify_previous_release "$previous_release_dir" || {
    echo 'current 指向的 previous release 无法验证' >&2
    exit 1
  }
  had_previous=true
fi
[ "$mode" != rollback ] || [ "$had_previous" = true ] || {
  echo '显式 rollback 需要已存在的 current release' >&2
  exit 1
}

[ ! -L "$lock_file" ] || { echo 'deploy.lock 不得是符号链接' >&2; exit 1; }
: >> "$lock_file"
chmod 600 "$lock_file"
exec 9> "$lock_file"
flock -n 9 || { echo '已有 Hono 部署正在运行' >&2; exit 1; }

if [ "$had_previous" = true ]; then
  validate_release_config "$previous_release_dir"
fi
validate_release_config "$release_dir"
if activate_release "$release_dir" && verify_public_contract; then
  point_current_to "$release_dir"
  if [ "$mode" = rollback ]; then
    echo "ROLLBACK_RELEASE_ID=$release_id"
  else
    echo "RELEASE_ID=$release_id"
  fi
  exit 0
fi

restore_previous || {
  echo 'candidate 失败且 previous release 恢复失败，请人工处理' >&2
  exit 1
}
exit 1
