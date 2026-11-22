#!/bin/sh
# ATLAS Social one-command connect.
# Usage:
#   curl -fsSL https://atlascalls.xyz/connect.sh | sh -s ATC-XXXX
#   curl -fsSL https://atlascalls.xyz/connect.sh | sh -s -- pay ATC-XXXX
#
# Installs Node.js only when a user-level installer is already present (nvm, fnm, volta, brew).
# Otherwise it tells you how to install Node 18+. Then it runs atlas-social-connect, which
# installs the official Binance Agentic Wallet CLI if needed and logs you in (preview first).
set -eu

SITE="${ATLAS_SITE:-https://atlascalls.xyz}"
PKG_NAME="atlas-social-connect"
CMD="login"
CODE=""
API=""

ok() { printf '%s\n' "$*"; }
die() { printf 'atlas-connect: %s\n' "$*" >&2; exit 1; }

is_code() {
  printf '%s' "$1" | tr '[:lower:]' '[:upper:]' | grep -Eq '^ATC-[0-9A-HJKMNP-TV-Z]{26}$'
}

while [ $# -gt 0 ]; do
  case "$1" in
    login|pay) CMD=$1 ;;
    --api)
      [ $# -ge 2 ] || die "--api needs a URL"
      API=$2
      shift
      ;;
    --help|-h)
      ok "usage: curl -fsSL ${SITE}/connect.sh | sh -s [login|pay] ATC-XXXX"
      exit 0
      ;;
    *)
      UP=$(printf '%s' "$1" | tr '[:lower:]' '[:upper:]')
      if is_code "$UP"; then
        CODE=$UP
      else
        die "unexpected argument: $1"
      fi
      ;;
  esac
  shift
done

[ -n "$CODE" ] || die "missing ATLAS connection code (ATC-…). Copy it from ${SITE}."

need_node() {
  if command -v node >/dev/null 2>&1; then
    VER=$(node -p "process.versions.node" 2>/dev/null || echo "0")
    MAJOR=$(printf '%s' "$VER" | cut -d. -f1)
    if [ -n "$MAJOR" ] && [ "$MAJOR" -ge 18 ] 2>/dev/null; then
      return 1
    fi
    ok "Node.js $VER is too old (need 18+)."
  fi
  return 0
}

try_install_node() {
  if [ -n "${NVM_DIR:-}" ] && [ -s "$NVM_DIR/nvm.sh" ]; then
    # shellcheck disable=SC1091
    . "$NVM_DIR/nvm.sh"
    ok "Installing Node.js 22 with nvm…"
    nvm install 22
    return 0
  fi
  if command -v fnm >/dev/null 2>&1; then
    ok "Installing Node.js 22 with fnm…"
    fnm install 22
    eval "$(fnm env)"
    return 0
  fi
  if command -v volta >/dev/null 2>&1; then
    ok "Installing Node.js 22 with volta…"
    volta install node@22
    return 0
  fi
  if command -v brew >/dev/null 2>&1; then
    ok "Installing Node.js with Homebrew…"
    brew install node
    return 0
  fi
  return 1
}

if need_node; then
  if try_install_node && ! need_node; then
    :
  else
    die "Node.js 18+ is required. Install it from https://nodejs.org then re-run:
  curl -fsSL ${SITE}/connect.sh | sh -s $CODE
macOS with Homebrew: brew install node
Linux (Debian/Ubuntu): sudo apt-get install -y nodejs npm  (use Node 18+)"
  fi
fi

command -v npm >/dev/null 2>&1 || die "npm was not found on PATH after installing Node.js. Install Node.js 18+ from https://nodejs.org and re-run."

resolve_pkg() {
  if npm view "$PKG_NAME" version >/dev/null 2>&1; then
    printf '%s@latest' "$PKG_NAME"
  else
    printf '%s/%s.tgz' "$SITE" "$PKG_NAME"
  fi
}

PKG=$(resolve_pkg)
ok "Running: npx --yes $PKG $CMD $CODE${API:+ --api $API}"
ok "This will install the official Binance Agentic Wallet CLI (baw) if it is missing, then preview the ATLAS login. Nothing is signed until you type y."

# npx must run in a real terminal when possible so the y/N prompt works.
set -- npx --yes "$PKG" "$CMD" "$CODE"
[ -n "$API" ] && set -- "$@" --api "$API"
exec "$@"
