#!/bin/sh
set -eu

mode="${1:-}"
root_dir="${HONO_DEPLOY_ROOT_DIR:-/opt/mahoshojo-hono}"
releases_dir="$root_dir/releases"
lock_file="$root_dir/deploy.lock"

case "$root_dir" in
  /) echo "部署根目录不得为文件系统根目录" >&2; exit 2 ;;
  /*) ;;
  *) echo "部署根目录必须是绝对路径" >&2; exit 2 ;;
esac

for required_command in find flock mktemp realpath; do
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

verify_release_id() {
  verified_release_id="$1"
  case "$verified_release_id" in
    ''|*[!0-9a-f]*) return 1 ;;
  esac
  [ "${#verified_release_id}" -eq 64 ]
}

verify_uploaded_tuple() {
  verified_dir="$1"
  verified_release_id="$2"
  [ -d "$verified_dir" ] && [ ! -L "$verified_dir" ] || return 1
  [ "$(realpath -e "$verified_dir")" = "$verified_dir" ] || return 1
  [ "$(find "$verified_dir" -mindepth 1 -maxdepth 1 -printf '%f\n' | wc -l \
    | tr -d ' ')" -eq 5 ] || return 1

  for verified_file in \
    index.mjs compose.yml deploy-bundle.sh release.manifest release.sha256
  do
    [ -f "$verified_dir/$verified_file" ] \
      && [ ! -L "$verified_dir/$verified_file" ] || return 1
  done
  [ "$(wc -l < "$verified_dir/release.sha256" | tr -d ' ')" -eq 1 ] || return 1
  [ "$(sed -n '1p' "$verified_dir/release.sha256")" \
    = "$verified_release_id  release.manifest" ] || return 1
  [ "$(wc -l < "$verified_dir/release.manifest" | tr -d ' ')" -eq 3 ] || return 1
  grep -Eq '^[0-9a-f]{64}  index\.mjs$' "$verified_dir/release.manifest" || return 1
  grep -Eq '^[0-9a-f]{64}  compose\.yml$' "$verified_dir/release.manifest" || return 1
  grep -Eq '^[0-9a-f]{64}  deploy-bundle\.sh$' "$verified_dir/release.manifest" || return 1
  (cd "$verified_dir" && sha256sum -c release.sha256 >/dev/null)
  (cd "$verified_dir" && sha256sum -c release.manifest >/dev/null)
}

remove_staging() {
  removed_staging_dir="$1"
  rm -f \
    "$removed_staging_dir/index.mjs" \
    "$removed_staging_dir/compose.yml" \
    "$removed_staging_dir/deploy-bundle.sh" \
    "$removed_staging_dir/release.manifest" \
    "$removed_staging_dir/release.sha256" || return 1
  rmdir "$removed_staging_dir"
}

case "$mode" in
  create)
    [ "$#" -eq 1 ] || exit 2
    umask 077
    mktemp -d "$releases_dir/.upload.XXXXXX"
    ;;
  install)
    [ "$#" -eq 3 ] || exit 2
    release_id="$2"
    staging_dir="$3"
    verify_release_id "$release_id" || {
      echo "release id 必须是 64 位 SHA-256" >&2
      exit 1
    }
    case "$staging_dir" in
      "$releases_dir"/.upload.*) ;;
      *) echo "上传 staging 不属于受管 releases 目录" >&2; exit 1 ;;
    esac
    verify_uploaded_tuple "$staging_dir" "$release_id" || {
      echo "上传 tuple 校验失败" >&2
      exit 1
    }

    prepare_lock_file || {
      echo "deploy.lock 必须是受管普通文件" >&2
      exit 1
    }
    exec 9>>"$lock_file"
    flock -n 9 || {
      echo "另一个部署或安装事务正在执行" >&2
      exit 1
    }
    verify_uploaded_tuple "$staging_dir" "$release_id" || {
      echo "持锁复验上传 tuple 失败" >&2
      exit 1
    }

    final_dir="$releases_dir/$release_id"
    reuse_final=false
    if [ -e "$final_dir" ] || [ -L "$final_dir" ]; then
      reuse_final=true
    else
      mv -Tn "$staging_dir" "$final_dir" || exit 1
      if [ -e "$staging_dir" ] || [ -L "$staging_dir" ]; then
        reuse_final=true
      fi
    fi
    if [ "$reuse_final" = true ]; then
      verify_uploaded_tuple "$final_dir" "$release_id" || {
        echo "既有最终 release 非法，拒绝覆盖" >&2
        exit 1
      }
      for compared_file in \
        index.mjs compose.yml deploy-bundle.sh release.manifest release.sha256
      do
        cmp -s "$staging_dir/$compared_file" "$final_dir/$compared_file" || {
          echo "既有最终 release 与上传 tuple 不一致" >&2
          exit 1
        }
      done
      remove_staging "$staging_dir" || exit 1
    fi
    verify_uploaded_tuple "$final_dir" "$release_id" || {
      echo "最终 release 在原子纳管后复验失败" >&2
      exit 1
    }
    chmod 755 "$final_dir/deploy-bundle.sh" || exit 1
    printf '%s\n' "$final_dir"
    ;;
  *)
    echo "用法：$0 create | install <release-id> <staging-dir>" >&2
    exit 2
    ;;
esac
