#!/usr/bin/env bash

set -Eeuo pipefail

readonly deploy_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly previous_file="${deploy_dir}/.previous-image"

if [[ ! -s "${previous_file}" ]]; then
  echo "No previous image is available for rollback." >&2
  exit 1
fi

exec "${deploy_dir}/deploy.sh" "$(head -n 1 "${previous_file}")"
