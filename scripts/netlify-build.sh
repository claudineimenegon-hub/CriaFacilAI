#!/usr/bin/env bash

set -euo pipefail

readonly REQUIRED_FLUTTER_VERSION="${FLUTTER_VERSION:-3.47.0}"
readonly REQUIRED_FLUTTER_REVISION="${FLUTTER_REVISION:-4cf24164269a5ebf0c16a028a00727d0e77bbb05}"
readonly FLUTTER_CACHE_ROOT="${HOME}/.cache/criafacilai"
readonly FLUTTER_SDK_DIR="${FLUTTER_CACHE_ROOT}/flutter-${REQUIRED_FLUTTER_VERSION}"

fail() {
  printf 'Netlify build error: %s\n' "$1" >&2
  exit 1
}

validate_api_base_url() {
  [[ -n "${API_BASE_URL:-}" ]] || fail \
    'API_BASE_URL is required. Configure the public HTTPS backend URL in Netlify environment variables.'

  [[ "${API_BASE_URL}" =~ ^https://[^[:space:]]+$ ]] || fail \
    'API_BASE_URL must be a public HTTPS URL.'

  local host
  host="${API_BASE_URL#https://}"
  host="${host%%/*}"
  host="${host%%:*}"

  case "${host,,}" in
    localhost|127.*|0.0.0.0|10.*|192.168.*|169.254.*|*.local)
      fail 'API_BASE_URL must not point to localhost or a private/local address.'
      ;;
  esac

  if [[ "${host}" =~ ^172\.([1][6-9]|2[0-9]|3[0-1])\. ]]; then
    fail 'API_BASE_URL must not point to a private/local address.'
  fi
}

install_flutter() {
  mkdir -p "${FLUTTER_CACHE_ROOT}"

  if [[ ! -x "${FLUTTER_SDK_DIR}/bin/flutter" ]]; then
    rm -rf "${FLUTTER_SDK_DIR}"
    git clone --quiet --depth 1 --branch "${REQUIRED_FLUTTER_VERSION}" \
      https://github.com/flutter/flutter.git "${FLUTTER_SDK_DIR}" || \
      fail "Unable to download Flutter ${REQUIRED_FLUTTER_VERSION}."
  fi

  local actual_revision
  actual_revision="$(git -C "${FLUTTER_SDK_DIR}" rev-parse HEAD)"
  [[ "${actual_revision}" == "${REQUIRED_FLUTTER_REVISION}" ]] || fail \
    "Flutter revision mismatch for ${REQUIRED_FLUTTER_VERSION}."

  export PATH="${FLUTTER_SDK_DIR}/bin:${PATH}"
  flutter config --no-analytics >/dev/null
  flutter --version
}

validate_api_base_url
install_flutter

flutter pub get
flutter build web --release --dart-define="API_BASE_URL=${API_BASE_URL}"

