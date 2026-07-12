#!/usr/bin/env bash

set -Eeuo pipefail

readonly image="${1:?Usage: deploy.sh <image>}"
readonly deploy_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly env_file="${deploy_dir}/.env"
readonly previous_file="${deploy_dir}/.previous-image"

cd "${deploy_dir}"

previous_image=""
if [[ -f "${env_file}" ]]; then
  previous_image="$(sed -n 's/^APP_IMAGE=//p' "${env_file}" | head -n 1)"
fi

if [[ -n "${previous_image}" && "${previous_image}" != "${image}" ]]; then
  printf '%s\n' "${previous_image}" > "${previous_file}"
fi

printf 'APP_IMAGE=%s\n' "${image}" > "${env_file}.tmp"
mv "${env_file}.tmp" "${env_file}"

rollback() {
  if [[ ! -s "${previous_file}" ]]; then
    echo "Deployment failed and no previous image is available." >&2
    return 1
  fi

  local rollback_image
  rollback_image="$(head -n 1 "${previous_file}")"
  echo "Deployment failed. Rolling back to ${rollback_image}." >&2
  printf 'APP_IMAGE=%s\n' "${rollback_image}" > "${env_file}"
  docker compose pull app
  docker compose up -d --no-build --remove-orphans
}

trap rollback ERR

docker compose pull app
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
