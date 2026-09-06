#!/usr/bin/env bash

set -Eeuo pipefail

readonly image="${1:?Usage: deploy.sh <image>}"
readonly deploy_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly env_file="${deploy_dir}/.env"
readonly previous_file="${deploy_dir}/.previous-image"

cd "${deploy_dir}"

# APP_IMAGE 한 줄만 갈아 끼운다. .env 에는 DATABASE_URL 같은 배포와
# 무관한 설정도 함께 들어 있어서, 파일 전체를 새로 쓰면 그 값들이 지워진다.
set_app_image() {
  local value="$1"
  touch "${env_file}"
  if grep -q '^APP_IMAGE=' "${env_file}"; then
    sed -i "s|^APP_IMAGE=.*|APP_IMAGE=${value}|" "${env_file}"
  else
    printf 'APP_IMAGE=%s\n' "${value}" >> "${env_file}"
  fi
}

previous_image=""
if [[ -f "${env_file}" ]]; then
  previous_image="$(sed -n 's/^APP_IMAGE=//p' "${env_file}" | head -n 1)"
fi

if [[ -n "${previous_image}" && "${previous_image}" != "${image}" ]]; then
  printf '%s\n' "${previous_image}" > "${previous_file}"
fi

set_app_image "${image}"

rollback() {
  if [[ ! -s "${previous_file}" ]]; then
    echo "Deployment failed and no previous image is available." >&2
    return 1
  fi

  local rollback_image
  rollback_image="$(head -n 1 "${previous_file}")"
  echo "Deployment failed. Rolling back to ${rollback_image}." >&2
  set_app_image "${rollback_image}"
  docker compose pull
  docker compose up -d --no-build --remove-orphans
}

trap rollback ERR

docker compose pull
docker compose up -d --no-build --remove-orphans

container_id="$(docker compose ps -q app)"
if [[ -z "${container_id}" ]]; then
  echo "The application container was not created." >&2
  exit 1
fi

for _ in {1..30}; do
  health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "${container_id}")"
  case "${health}" in
    healthy)
      trap - ERR
      echo "Deployment completed: ${image}"
      docker image prune -f
      exit 0
      ;;
    unhealthy|exited|dead)
      echo "Container entered ${health} state." >&2
      exit 1
      ;;
  esac
  sleep 5
done

echo "Container health check timed out." >&2
exit 1
