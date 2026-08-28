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
bind_port="${HONO_BIND_PORT:-8080}"
redis_key_prefix="${HONO_REDIS_KEY_PREFIX:-}"
redis_network_name="${HONO_REDIS_NETWORK_NAME:-mahoshojo-redis}"
hosted_api_environment="${HONO_HOSTED_API_ENVIRONMENT:-}"
runtime_image='node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32'
case "$root_dir" in
  /) echo "部署根目录不得为文件系统根目录" >&2; exit 2 ;;
  /*) ;;
  *) echo "部署根目录必须是绝对路径" >&2; exit 2 ;;
esac
case "$bind_port" in
  ''|*[!0-9]*) echo "HONO_BIND_PORT 必须是数字" >&2; exit 2 ;;
esac
case "$redis_network_name" in
  ''|*[!A-Za-z0-9_.-]*) echo "HONO_REDIS_NETWORK_NAME 必须是安全的 Docker network 名称" >&2; exit 2 ;;
esac
case "$hosted_api_environment" in
  production|preview|local|test) ;;
  *) echo "HONO_HOSTED_API_ENVIRONMENT 必须是 production、preview、local 或 test" >&2; exit 2 ;;
esac
case "$hosted_api_environment" in
  production)
    [ -z "$redis_key_prefix" ] || {
      echo "production target 必须保持 HONO_REDIS_KEY_PREFIX 为空" >&2
      exit 2
    }
    [ "$public_base_url" = 'https://homura.colanns.me' ] || {
      echo "production target 必须使用 https://homura.colanns.me" >&2
      exit 2
    }
    [ "$root_dir" = '/opt/mahoshojo-hono' ] || {
      echo "production target 必须使用 /opt/mahoshojo-hono" >&2
      exit 2
    }
    ;;
  preview)
    [ "$redis_key_prefix" = 'preview' ] || {
      echo "preview target 必须显式设置 HONO_REDIS_KEY_PREFIX=preview" >&2
      exit 2
    }
    [ "$public_base_url" = 'https://homura-preview.colanns.me' ] || {
      echo "preview target 必须使用 https://homura-preview.colanns.me" >&2
      exit 2
    }
    [ "$root_dir" = '/opt/mahoshojo-hono-preview' ] || {
      echo "preview target 必须使用 /opt/mahoshojo-hono-preview" >&2
      exit 2
    }
    ;;
esac

releases_dir="$root_dir/releases"
release_dir="$releases_dir/$release_id"
compose_file="$release_dir/compose.yml"
runtime_env="$root_dir/.env.hono"
release_env="$root_dir/.env"
transaction_file="$root_dir/deploy.transaction"
format_file="$root_dir/deployment-format"
lock_file="$root_dir/deploy.lock"
previous_release_dir=''
had_previous=false
transaction_active=false
active_child_pid=''
probe_dir=''
probe_headers=''
probe_body=''
probe_status_file=''

cleanup_probe() {
  if [ -n "$probe_dir" ]; then
    rm -f "$probe_headers" "$probe_body" "$probe_status_file"
    rmdir "$probe_dir" 2>/dev/null || true
  fi
}

prepare_lock_file() {
  if [ -e "$lock_file" ] || [ -L "$lock_file" ]; then
    [ -f "$lock_file" ] && [ ! -L "$lock_file" ] || return 1
    return 0
  fi

  lock_temp="$(mktemp "$root_dir/.deploy.lock.next.XXXXXX")" || return 1
  chmod 600 "$lock_temp" || {
    rm -f "$lock_temp"
    return 1
  }
  if ! ln "$lock_temp" "$lock_file" 2>/dev/null; then
    rm -f "$lock_temp"
    [ -f "$lock_file" ] && [ ! -L "$lock_file" ]
    return
  fi
  rm -f "$lock_temp"
}

is_managed_release_dir() {
  candidate_release_dir="$1"
  candidate_release_id="${candidate_release_dir##*/}"
  case "$candidate_release_id" in
    ''|*[!0-9a-f]*) return 1 ;;
  esac
  [ "${#candidate_release_id}" -eq 64 ] || return 1
  [ "$candidate_release_dir" = "$releases_dir/$candidate_release_id" ] || return 1
  [ -d "$candidate_release_dir" ] && [ ! -L "$candidate_release_dir" ]
}

verify_release_tuple() {
  tuple_dir="$1"
  is_managed_release_dir "$tuple_dir" || {
    echo "release 不属于受管 content-addressed 目录" >&2
    return 1
  }
  tuple_id="${tuple_dir##*/}"
  for release_file in \
    index.mjs \
    compose.yml \
    deploy-bundle.sh \
    release.manifest \
    release.sha256
  do
    [ -f "$tuple_dir/$release_file" ] && [ ! -L "$tuple_dir/$release_file" ] || {
      echo "release tuple 缺少受管普通文件：$release_file" >&2
      return 1
    }
  done

  expected_release_line="$tuple_id  release.manifest"
  [ "$(wc -l < "$tuple_dir/release.sha256" | tr -d ' ')" -eq 1 ] || return 1
  [ "$(sed -n '1p' "$tuple_dir/release.sha256")" = "$expected_release_line" ] || {
    echo "release id 与 release.manifest 摘要不匹配" >&2
    return 1
  }

  manifest_lines="$(wc -l < "$tuple_dir/release.manifest" | tr -d ' ')"
  optional_manifest_lines=0
  arena_gate_lines="$(grep -Ec '^[0-9a-f]{64}  arena-room-release-gate\.json$' \
    "$tuple_dir/release.manifest" || true)"
  case "$arena_gate_lines" in
    0)
      [ ! -e "$tuple_dir/arena-room-release-gate.json" ] \
        && [ ! -L "$tuple_dir/arena-room-release-gate.json" ] || return 1
      ;;
    1)
      optional_manifest_lines=$((optional_manifest_lines + 1))
      [ -f "$tuple_dir/arena-room-release-gate.json" ] \
        && [ ! -L "$tuple_dir/arena-room-release-gate.json" ] || return 1
      ;;
    *) return 1 ;;
  esac
  arena_gate_validator_lines="$(grep -Ec \
    '^[0-9a-f]{64}  arena-room-release-gate-schema\.mjs$' \
    "$tuple_dir/release.manifest" || true)"
  case "$arena_gate_validator_lines" in
    0)
      [ ! -e "$tuple_dir/arena-room-release-gate-schema.mjs" ] \
        && [ ! -L "$tuple_dir/arena-room-release-gate-schema.mjs" ] || return 1
      ;;
    1)
      optional_manifest_lines=$((optional_manifest_lines + 1))
      [ -f "$tuple_dir/arena-room-release-gate-schema.mjs" ] \
        && [ ! -L "$tuple_dir/arena-room-release-gate-schema.mjs" ] || return 1
      ;;
    *) return 1 ;;
  esac
  legacy_manifest_lines="$(grep -Ec '^[0-9a-f]{64}  legacy-layout$' \
    "$tuple_dir/release.manifest" || true)"
  case "$legacy_manifest_lines" in
    0)
      [ ! -e "$tuple_dir/legacy-layout" ] && [ ! -L "$tuple_dir/legacy-layout" ] || return 1
      ;;
    1)
      optional_manifest_lines=$((optional_manifest_lines + 1))
      [ -f "$tuple_dir/legacy-layout" ] && [ ! -L "$tuple_dir/legacy-layout" ] || return 1
      legacy_marker="$(cat "$tuple_dir/legacy-layout")"
      case "$legacy_marker" in
        root-release-layout-v1:*) ;;
        *) return 1 ;;
      esac
      ;;
    *) return 1 ;;
  esac
  if [ "$arena_gate_lines" -eq 1 ] && [ "$legacy_manifest_lines" -eq 1 ]; then
    echo "legacy adoption tuple 不得声明 Arena Room reader capability" >&2
    return 1
  fi
  if [ "$arena_gate_validator_lines" -eq 1 ] && [ "$arena_gate_lines" -ne 1 ]; then
    echo "release gate schema validator 必须与 release gate 同时出现" >&2
    return 1
  fi
  if [ "$manifest_lines" -ne $((3 + optional_manifest_lines)) ]; then
      echo "release.manifest 必须只覆盖规范 tuple 文件" >&2
      return 1
  fi
  [ "$(grep -Ec '^[0-9a-f]{64}  index\.mjs$' "$tuple_dir/release.manifest")" -eq 1 ] || return 1
  [ "$(grep -Ec '^[0-9a-f]{64}  compose\.yml$' "$tuple_dir/release.manifest")" -eq 1 ] || return 1
  [ "$(grep -Ec '^[0-9a-f]{64}  deploy-bundle\.sh$' "$tuple_dir/release.manifest")" -eq 1 ] || return 1

  (cd "$tuple_dir" && sha256sum -c release.sha256 >/dev/null)
  (cd "$tuple_dir" && sha256sum -c release.manifest >/dev/null)
}

verify_legacy_release() {
  legacy_release_dir="$1"
  is_managed_release_dir "$legacy_release_dir" || return 1
  legacy_release_id="${legacy_release_dir##*/}"
  [ -f "$legacy_release_dir/index.mjs" ] \
    && [ ! -L "$legacy_release_dir/index.mjs" ] \
    && [ -f "$legacy_release_dir/index.mjs.sha256" ] \
    && [ ! -L "$legacy_release_dir/index.mjs.sha256" ] || return 1
  [ "$(wc -l < "$legacy_release_dir/index.mjs.sha256" | tr -d ' ')" -eq 1 ] || return 1
  [ "$(sed -n '1p' "$legacy_release_dir/index.mjs.sha256")" \
    = "$legacy_release_id  index.mjs" ] || return 1
  for forbidden_legacy_file in \
    compose.yml deploy-bundle.sh release.manifest release.sha256 legacy-layout
  do
    [ ! -e "$legacy_release_dir/$forbidden_legacy_file" ] \
      && [ ! -L "$legacy_release_dir/$forbidden_legacy_file" ] || return 1
  done
  (cd "$legacy_release_dir" && sha256sum -c index.mjs.sha256 >/dev/null)
}

verify_legacy_source_if_needed() {
  tuple_dir="$1"
  if [ ! -f "$tuple_dir/legacy-layout" ]; then
    return 0
  fi
  legacy_marker="$(cat "$tuple_dir/legacy-layout")"
  legacy_source_id="${legacy_marker#root-release-layout-v1:}"
  case "$legacy_source_id" in
    ''|*[!0-9a-f]*) return 1 ;;
  esac
  [ "${#legacy_source_id}" -eq 64 ] || return 1
  legacy_source_dir="$releases_dir/$legacy_source_id"
  verify_legacy_release "$legacy_source_dir" || {
    echo "legacy source release 已漂移，拒绝伪回滚" >&2
    return 1
  }
  cmp -s "$legacy_source_dir/index.mjs" "$tuple_dir/index.mjs" || {
    echo "legacy source index.mjs 已漂移，拒绝伪回滚" >&2
    return 1
  }
  [ -f "$root_dir/compose.yml" ] && [ ! -L "$root_dir/compose.yml" ] || return 1
  cmp -s "$root_dir/compose.yml" "$tuple_dir/compose.yml" || {
    echo "legacy root compose.yml 已漂移，拒绝伪回滚" >&2
    return 1
  }
}

validate_release_compose() {
  tuple_dir="$1"
  run_cancellable env HONO_RELEASE_DIR="$tuple_dir" docker compose \
    --project-directory "$root_dir" \
    -f "$tuple_dir/compose.yml" config >/dev/null
}

validate_release_runtime() {
  tuple_dir="$1"
  run_cancellable docker run --rm \
    --network "$redis_network_name" \
    --env-file "$runtime_env" \
    -e NODE_ENV=production \
    -e HOSTED_API_ENVIRONMENT="$hosted_api_environment" \
    -e HONO_AUTH_MODE=bearer \
    -e HONO_CORS_ORIGINS='https://*.colanns.me' \
    -e REDIS_HOST=redis \
    -e REDIS_PORT=6379 \
    -e REDIS_REQUIRED=true \
    -e REDIS_KEY_PREFIX="$redis_key_prefix" \
    -e D1_REQUIRED=true \
    -e HONO_CONFIG_CHECK_ONLY=true \
    -v "$tuple_dir/index.mjs:/app/index.mjs:ro" \
    "$runtime_image" node /app/index.mjs >/dev/null
}

write_release_env() {
  target_release_dir="$1"
  release_env_temp="$(mktemp "$root_dir/.env.next.XXXXXX")" || return 1
  if ! printf 'HONO_RELEASE_DIR=%s\n' "$target_release_dir" > "$release_env_temp" \
    || ! chmod 600 "$release_env_temp" \
    || ! mv -f "$release_env_temp" "$release_env"; then
    rm -f "$release_env_temp"
    return 1
  fi
}

verify_deployment_format() {
  [ -f "$format_file" ] && [ ! -L "$format_file" ] || return 1
  [ "$(wc -l < "$format_file" | tr -d ' ')" -eq 1 ] || return 1
  [ "$(cat "$format_file")" = 'release-tuple-v2' ]
}

ensure_deployment_format() {
  if [ -e "$format_file" ] || [ -L "$format_file" ]; then
    verify_deployment_format
    return
  fi
  format_temp="$(mktemp "$root_dir/.deployment-format.next.XXXXXX")" || return 1
  if ! printf 'release-tuple-v2\n' > "$format_temp" \
    || ! chmod 644 "$format_temp" \
    || ! mv -f "$format_temp" "$format_file"; then
    rm -f "$format_temp"
    return 1
  fi
}

point_current_to() {
  target_release_dir="$1"
  rm -f "$root_dir/current.next" || return 1
  ln -s "$target_release_dir" "$root_dir/current.next" || return 1
  mv -Tf "$root_dir/current.next" "$root_dir/current" || return 1
}

remove_current_if_target() {
  target_release_dir="$1"
  if [ -L "$root_dir/current" ]; then
    current_target="$(readlink "$root_dir/current")"
    if [ "$current_target" = "$target_release_dir" ]; then
      rm -f "$root_dir/current"
      return
    fi
    return 1
  fi
  [ ! -e "$root_dir/current" ]
}

run_cancellable() {
  "$@" &
  active_child_pid=$!
  if wait "$active_child_pid"; then
    child_status=0
  else
    child_status=$?
  fi
  active_child_pid=''
  return "$child_status"
}

wait_for_local_readiness() {
  attempt=0
  while [ "$attempt" -lt 24 ]; do
    if run_cancellable curl --fail --silent --show-error --connect-timeout 2 --max-time 4 \
      "http://127.0.0.1:$bind_port/health/ready" >/dev/null; then
      return 0
    fi
    attempt=$((attempt + 1))
    run_cancellable sleep 5 || return 1
  done
  return 1
}

restore_previous_tuple() {
  target_release_dir="$1"
  verify_release_tuple "$target_release_dir" || return 1
  verify_legacy_source_if_needed "$target_release_dir" || return 1
  validate_release_compose "$target_release_dir" || return 1
  validate_release_runtime "$target_release_dir" || return 1
  write_release_env "$target_release_dir" || return 1
  run_cancellable docker compose \
    --project-directory "$root_dir" -f "$target_release_dir/compose.yml" \
    up -d --force-recreate hono || return 1
  wait_for_local_readiness || return 1
  if [ -L "$root_dir/current" ] \
    && [ "$(readlink "$root_dir/current")" = "$target_release_dir" ]; then
    return 0
  fi
  point_current_to "$target_release_dir"
}

rollback_transaction() {
  failed_release_dir="$1"
  rollback_had_previous="$2"
  rollback_previous_release_dir="$3"
  echo "新 release 未通过完整 contract，开始回滚 tuple" >&2
  verify_release_tuple "$failed_release_dir" || {
    echo "failed release tuple 已漂移，拒绝读取 rollback gate" >&2
    return 1
  }
  if [ "$rollback_had_previous" = true ]; then
    verify_arena_room_rollback_gate \
      "$failed_release_dir" "$rollback_previous_release_dir" || return 1
    restore_previous_tuple "$rollback_previous_release_dir" || return 1
    rm -f "$root_dir/current.next" || return 1
    return 0
  fi

  validate_release_compose "$failed_release_dir" || return 1
  run_cancellable docker compose \
    --project-directory "$root_dir" -f "$failed_release_dir/compose.yml" \
    down || return 1
  remove_current_if_target "$failed_release_dir" || return 1
  rm -f "$root_dir/current.next" || return 1
  rm -f "$release_env" || return 1
  rm -f "$format_file" || return 1
}

validate_arena_room_release_gate() {
  validated_gate="$1"
  validated_schema="$2"
  shift 2
  [ -f "$validated_gate" ] && [ ! -L "$validated_gate" ] || return 1
  if [ -e "$validated_schema" ] || [ -L "$validated_schema" ]; then
    [ -f "$validated_schema" ] && [ ! -L "$validated_schema" ] || return 1
    run_cancellable docker run --rm \
      --network none \
      --read-only \
      --cap-drop ALL \
      --security-opt no-new-privileges \
      -v "$validated_gate:/gate.json:ro" \
      -v "$validated_schema:/gate-schema.mjs:ro" \
      "$runtime_image" node /gate-schema.mjs --manifest /gate.json "$@" >/dev/null
    return
  fi

  # GMR-09 schema validator first appeared after the initial gate-only tuple
  # rollout.  Keep a deliberately narrow compatibility reader for those
  # immutable historical tuples: only the exact writer-disabled gate is
  # accepted, and no caller may ask this path to attest another contract.
  [ "$#" -eq 0 ] || return 1
  if ! run_cancellable docker run --rm \
    --network none \
    --read-only \
    --cap-drop ALL \
    --security-opt no-new-privileges \
    -v "$validated_gate:/gate.json:ro" \
    "$runtime_image" node --input-type=module -e '
import { readFileSync } from "node:fs";

const candidate = JSON.parse(readFileSync(process.argv[1], "utf8"));
const expectedGate = {
  schemaVersion: 1,
  checkpointContract: "arena-room-authority-v2-generation-payload-digest-v1",
  writerActivation: "disabled",
  compatibleReaderRolloutRequired: true,
  productionGoNoGoRequired: true,
  rollback: {
    minimumReaderContract: "arena-room-authority-v2-generation-payload-digest-v1",
    generationStartMustBeDisabled: true,
  },
  rolloutOrder: [
    "compatible-reader",
    "writer-disabled-validation",
    "production-go-no-go",
    "writer-activation",
  ],
  evidence: {
    legacyCheckpointReaderTest: "GMR-09 mixed-version checkpoint gate",
    productionFeatureGateTest: "GMR-09 mixed-version gate",
    rollbackShellGate: "verify_arena_room_rollback_gate",
  },
};
const normalize = (value) => {
  if (Array.isArray(value)) return value.map(normalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, normalize(value[key])]));
  }
  return value;
};
if (JSON.stringify(normalize(candidate)) !== JSON.stringify(normalize(expectedGate))) {
  console.error("[arena-room-release-gate-compat] gate fields are not the exact writer-disabled schema");
  process.exit(1);
}
console.log(JSON.stringify({
  gate: "ARENA_ROOM_RELEASE_GATE_COMPAT",
  writerActivation: candidate.writerActivation,
  checkpointContract: candidate.checkpointContract,
  status: "PASS",
}));
' /gate.json >/dev/null; then
    echo "历史 gate-only release gate 兼容校验失败" >&2
    return 1
  fi
}

verify_arena_room_rollback_gate() {
  failed_release_dir="$1"
  target_release_dir="$2"
  [ -f "$runtime_env" ] && [ ! -L "$runtime_env" ] || return 1
  arena_generation_start_state="$(
    sed -n 's/^ARENA_MULTIPLAYER_ENABLED=//p' "$runtime_env" | tail -n 1
  )"
  case "$arena_generation_start_state" in
    ''|0|false|no|off) ;;
    *)
      echo "Arena multiplayer generation start 未关闭，拒绝自动回滚旧 reader" >&2
      return 1
      ;;
  esac
  failed_gate="$failed_release_dir/arena-room-release-gate.json"
  if [ ! -e "$failed_gate" ] && [ ! -L "$failed_gate" ]; then
    return 0
  fi
  [ -f "$failed_gate" ] && [ ! -L "$failed_gate" ] || return 1
  failed_gate_schema="$failed_release_dir/arena-room-release-gate-schema.mjs"
  validate_arena_room_release_gate "$failed_gate" "$failed_gate_schema" || {
    echo "Arena Room release gate schema 校验失败" >&2
    return 1
  }
  writer_activation="$(
    sed -n 's/^[[:space:]]*"writerActivation":[[:space:]]*"\([a-z]*\)"[,]*[[:space:]]*$/\1/p' \
      "$failed_gate"
  )"
  case "$writer_activation" in
    disabled) return 0 ;;
    enabled) ;;
    *)
      echo "Arena Room release gate writerActivation 非法" >&2
      return 1
      ;;
  esac
  verify_release_tuple "$target_release_dir" || return 1
  target_gate="$target_release_dir/arena-room-release-gate.json"
  [ -f "$target_gate" ] && [ ! -L "$target_gate" ] || {
    echo "rollback target reader contract 不兼容" >&2
    return 1
  }
  validate_arena_room_release_gate \
    "$target_gate" "$failed_gate_schema" \
    --expect-contract 'arena-room-authority-v2-generation-payload-digest-v1' || {
      echo "rollback target reader contract schema 不兼容" >&2
      return 1
    }
  target_reader_contract="$(
    sed -n 's/^[[:space:]]*"checkpointContract":[[:space:]]*"\([A-Za-z0-9._:-]*\)"[,]*[[:space:]]*$/\1/p' \
      "$target_gate"
  )"
  [ "$target_reader_contract" \
    = 'arena-room-authority-v2-generation-payload-digest-v1' ] || {
    echo "rollback target reader contract 不兼容" >&2
    return 1
  }
}

write_transaction() {
  transaction_temp="$(mktemp "$root_dir/.deploy.transaction.next.XXXXXX")" || return 1
  printf '%s\n' \
    'TRANSACTION_STATE=pending' \
    "TARGET_RELEASE_DIR=$release_dir" \
    "HAD_PREVIOUS=$had_previous" \
    "PREVIOUS_RELEASE_DIR=$previous_release_dir" \
    > "$transaction_temp" || {
      rm -f "$transaction_temp"
      return 1
    }
  if ! chmod 600 "$transaction_temp" \
    || ! mv -f "$transaction_temp" "$transaction_file"; then
    rm -f "$transaction_temp"
    return 1
  fi
  transaction_active=true
}

clear_transaction() {
  rm -f "$transaction_file" || return 1
  transaction_active=false
}

read_transaction_field() {
  transaction_key="$1"
  [ "$(grep -c "^$transaction_key=" "$transaction_file")" -eq 1 ] || return 1
  sed -n "s/^$transaction_key=//p" "$transaction_file"
}

recover_pending_transaction() {
  if [ ! -e "$transaction_file" ] && [ ! -L "$transaction_file" ]; then
    return 0
  fi
  [ -f "$transaction_file" ] && [ ! -L "$transaction_file" ] || return 1
  [ "$(wc -l < "$transaction_file" | tr -d ' ')" -eq 4 ] || return 1
  recovery_state="$(read_transaction_field TRANSACTION_STATE)" || return 1
  recovery_target="$(read_transaction_field TARGET_RELEASE_DIR)" || return 1
  recovery_had_previous="$(read_transaction_field HAD_PREVIOUS)" || return 1
  recovery_previous="$(read_transaction_field PREVIOUS_RELEASE_DIR)" || return 1
  [ "$recovery_state" = pending ] || return 1
  is_managed_release_dir "$recovery_target" || return 1
  case "$recovery_had_previous" in
    true) is_managed_release_dir "$recovery_previous" || return 1 ;;
    false) [ -z "$recovery_previous" ] || return 1 ;;
    *) return 1 ;;
  esac

  echo "发现未完成部署事务，先恢复 previous tuple" >&2
  rollback_transaction "$recovery_target" "$recovery_had_previous" "$recovery_previous" || {
    echo "未完成事务恢复失败，保留 journal 并 fail closed" >&2
    return 1
  }
  clear_transaction
}

adopt_legacy_layout() {
  legacy_release_dir="$1"
  legacy_release_id="${legacy_release_dir##*/}"
  legacy_index="$legacy_release_dir/index.mjs"
  legacy_compose="$root_dir/compose.yml"
  verify_legacy_release "$legacy_release_dir" || return 1
  [ -f "$legacy_compose" ] && [ ! -L "$legacy_compose" ] || return 1
  [ -f "$root_dir/deploy-bundle.sh" ] \
    && [ ! -L "$root_dir/deploy-bundle.sh" ] || return 1

  umask 077
  adoption_staging="$(mktemp -d "$releases_dir/.legacy-adopt.XXXXXX")" || return 1
  cp "$legacy_index" "$adoption_staging/index.mjs" || return 1
  cp "$legacy_compose" "$adoption_staging/compose.yml" || return 1
  cp "$release_dir/deploy-bundle.sh" "$adoption_staging/deploy-bundle.sh" || return 1
  chmod 755 "$adoption_staging/deploy-bundle.sh" || return 1
  printf 'root-release-layout-v1:%s\n' \
    "$legacy_release_id" > "$adoption_staging/legacy-layout" || return 1
  (cd "$adoption_staging" && sha256sum \
    index.mjs compose.yml deploy-bundle.sh legacy-layout > release.manifest) || return 1
  adoption_id="$(sha256sum "$adoption_staging/release.manifest" | awk '{print $1}')"
  adoption_dir="$releases_dir/$adoption_id"
  printf '%s  release.manifest\n' "$adoption_id" > "$adoption_staging/release.sha256" || return 1

  reuse_adoption=false
  if [ -e "$adoption_dir" ] || [ -L "$adoption_dir" ]; then
    reuse_adoption=true
  else
    mv -Tn "$adoption_staging" "$adoption_dir" || return 1
    if [ -e "$adoption_staging" ] || [ -L "$adoption_staging" ]; then
      reuse_adoption=true
    fi
  fi
  if [ "$reuse_adoption" = true ]; then
    verify_release_tuple "$adoption_dir" || return 1
    [ -f "$adoption_dir/legacy-layout" ] || return 1
    rm -rf "$adoption_staging" || return 1
  fi
  verify_release_tuple "$adoption_dir" || return 1
  verify_legacy_source_if_needed "$adoption_dir" || return 1
  validate_release_compose "$adoption_dir" || return 1
  validate_release_runtime "$adoption_dir" || return 1
  write_release_env "$adoption_dir" || return 1
  point_current_to "$adoption_dir" || return 1
  ensure_deployment_format || return 1
  adopted_release_dir="$adoption_dir"
}

resolve_previous_release() {
  has_managed_format=false
  if [ -e "$format_file" ] || [ -L "$format_file" ]; then
    verify_deployment_format || {
      echo "deployment-format 非法，拒绝推断部署状态" >&2
      return 1
    }
    has_managed_format=true
  fi

  if [ -e "$release_env" ] || [ -L "$release_env" ]; then
    [ -f "$release_env" ] && [ ! -L "$release_env" ] || {
      echo "当前 release 环境文件不是受管普通文件" >&2
      return 1
    }
    [ "$(wc -l < "$release_env" | tr -d ' ')" -eq 1 ] || {
      echo "当前 release 环境文件必须只有一个规范字段" >&2
      return 1
    }
    candidate_previous="$(sed -n 's/^HONO_RELEASE_DIR=//p' "$release_env")"
    [ -n "$candidate_previous" ] && is_managed_release_dir "$candidate_previous" || {
      echo "当前 release 环境文件指向非法目录" >&2
      return 1
    }

    if [ -e "$candidate_previous/release.manifest" ] \
      || [ -L "$candidate_previous/release.manifest" ]; then
      verify_release_tuple "$candidate_previous" \
        && verify_legacy_source_if_needed "$candidate_previous" || {
          echo "当前 managed release tuple 无法验证" >&2
          return 1
        }

      if [ -L "$root_dir/current" ]; then
        [ "$(readlink "$root_dir/current")" = "$candidate_previous" ] || {
          echo "current 与 release 环境文件不一致" >&2
          return 1
        }
      elif [ "$has_managed_format" = false ] \
        && [ ! -e "$root_dir/current" ] \
        && [ -f "$candidate_previous/legacy-layout" ]; then
        echo "恢复未完成的 legacy 纳管元数据" >&2
        point_current_to "$candidate_previous" || return 1
      else
        echo "current 缺失或不是受管符号链接" >&2
        return 1
      fi

      ensure_deployment_format || return 1
      previous_release_dir="$candidate_previous"
      had_previous=true
      return 0
    fi

    [ "$has_managed_format" = false ] || {
      echo "managed format 不得降级纳管旧 release" >&2
      return 1
    }
    [ ! -e "$root_dir/current" ] && [ ! -L "$root_dir/current" ] || {
      echo "旧布局不应存在 current 指针" >&2
      return 1
    }
    verify_legacy_release "$candidate_previous" || {
      echo "旧 release 不符合可纳管 schema" >&2
      return 1
    }
    adopt_legacy_layout "$candidate_previous" || return 1
    previous_release_dir="$adopted_release_dir"
    had_previous=true
    return 0
  fi

  if [ "$has_managed_format" = true ]; then
    echo "managed format 缺少 release 环境文件" >&2
    return 1
  fi
  if [ -e "$root_dir/current" ] || [ -L "$root_dir/current" ]; then
    echo "current 存在但缺少 release 环境文件" >&2
    return 1
  fi

  if [ -e "$root_dir/compose.yml" ] || [ -L "$root_dir/compose.yml" ] \
    || [ -e "$root_dir/deploy-bundle.sh" ] || [ -L "$root_dir/deploy-bundle.sh" ]; then
    echo "检测到不完整旧布局，缺少可校验 .env，拒绝无回滚发布" >&2
    return 1
  fi
}

activate_release() {
  write_release_env "$release_dir" || return 1
  run_cancellable docker compose --project-directory "$root_dir" -f "$compose_file" \
    up -d --force-recreate hono || return 1
  wait_for_local_readiness
}

verify_public_contract() {
  run_cancellable curl --fail --silent --show-error --retry 6 --retry-delay 5 \
    --connect-timeout 5 --max-time 15 \
    "$public_base_url/health/ready" >/dev/null || return 1
  if ! run_cancellable curl --silent --show-error --retry 6 --retry-delay 5 \
    --connect-timeout 5 --max-time 15 \
    --dump-header "$probe_headers" --output "$probe_body" \
    --write-out '%{http_code}' \
    --request POST "$public_base_url/api/generate-magical-girl" \
    --header 'Origin: https://mahoshojo.colanns.me' \
    --header 'Content-Type: application/json' \
    --data '{}' > "$probe_status_file"; then
    return 1
  fi
  probe_status="$(cat "$probe_status_file")"
  [ "$probe_status" = '400' ] || return 1
  grep -Fq '"error":"Name is required"' "$probe_body" || return 1
  grep -Fqi 'Access-Control-Allow-Origin: https://mahoshojo.colanns.me' "$probe_headers" || return 1
}

promote_release() {
  point_current_to "$release_dir"
}

handle_signal() {
  signal_exit_code="$1"
  trap - HUP INT TERM
  if [ -n "$active_child_pid" ]; then
    kill -TERM "$active_child_pid" 2>/dev/null || true
    wait "$active_child_pid" 2>/dev/null || true
    active_child_pid=''
  fi
  if [ "$transaction_active" = true ]; then
    if rollback_transaction "$release_dir" "$had_previous" "$previous_release_dir"; then
      clear_transaction
    fi
  fi
  exit "$signal_exit_code"
}

trap cleanup_probe 0
trap 'handle_signal 129' HUP
trap 'handle_signal 130' INT
trap 'handle_signal 143' TERM

for required_command in flock id mktemp realpath stat; do
  command -v "$required_command" >/dev/null 2>&1 || {
    echo "部署主机缺少必需工具：$required_command" >&2
    exit 1
  }
done
[ -d "$root_dir" ] && [ ! -L "$root_dir" ] \
  && [ -d "$releases_dir" ] && [ ! -L "$releases_dir" ] || {
  echo "部署根目录或 releases 目录不存在" >&2
  exit 1
}
[ "$(realpath -e "$root_dir")" = "$root_dir" ] \
  && [ "$(realpath -e "$releases_dir")" = "$releases_dir" ] || {
  echo "部署根目录与 releases 必须是无符号链接的 canonical 路径" >&2
  exit 1
}
[ -f "$runtime_env" ] && [ ! -L "$runtime_env" ] || {
  echo "Hono runtime env 不存在或不是普通文件" >&2
  exit 1
}
runtime_env_mode="$(stat -c '%a' "$runtime_env")"
runtime_env_owner_uid="$(stat -c '%u' "$runtime_env")"
deploy_uid="$(id -u)"
[ "$runtime_env_mode" = '600' ] && [ "$runtime_env_owner_uid" = "$deploy_uid" ] || {
  echo "Hono runtime env 必须由当前部署用户所有且权限为 0600" >&2
  exit 1
}
prepare_lock_file || {
  echo "deploy.lock 必须是受管普通文件" >&2
  exit 1
}
exec 9>>"$lock_file"
if ! flock -n 9; then
  echo "另一个部署事务正在执行" >&2
  exit 1
fi

probe_dir="$(mktemp -d /tmp/mahoshojo-hono-probe.XXXXXX)"
probe_headers="$probe_dir/headers"
probe_body="$probe_dir/body"
probe_status_file="$probe_dir/status"

recover_pending_transaction
verify_release_tuple "$release_dir"
validate_arena_room_release_gate \
  "$release_dir/arena-room-release-gate.json" \
  "$release_dir/arena-room-release-gate-schema.mjs"
validate_release_compose "$release_dir"
validate_release_runtime "$release_dir"
resolve_previous_release
if [ "$had_previous" = true ]; then
  verify_release_tuple "$previous_release_dir"
  verify_legacy_source_if_needed "$previous_release_dir"
  validate_release_compose "$previous_release_dir"
  validate_release_runtime "$previous_release_dir"
fi

write_transaction
if activate_release && verify_public_contract && promote_release; then
  ensure_deployment_format
  clear_transaction
  echo "Hono 已发布：$release_id"
  exit 0
fi

if rollback_transaction "$release_dir" "$had_previous" "$previous_release_dir"; then
  clear_transaction
fi
exit 1
