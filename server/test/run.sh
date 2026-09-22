#!/bin/bash
#
# Boot a server on a throwaway database and run the suites against it.
#
# A real server on a real (if disposable) database, rather than mocks: almost
# every bug these suites have caught lived in the seam between a route and a
# serialiser, or between the REST path and the socket path, and a mock sits
# exactly on top of that seam.
#
#   ./test/run.sh              # everything
#   ./test/run.sh security     # one suite
#
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

DB="/tmp/nook-test-$$.db"
PORT="${NOOK_TEST_PORT:-4111}"

export PORT
export TURSO_DATABASE_URL="file:$DB"
export NODE_ENV=development
export SEED_DEMO=0
export JWT_ACCESS_SECRET=test-access-secret-not-used-anywhere-real
export JWT_REFRESH_SECRET=test-refresh-secret-not-used-anywhere-real
export ADMIN_USERNAME=testadmin
# bcrypt of "testadminpass" — a test fixture, deliberately not a real hash.
export ADMIN_PASSWORD_HASH='$2a$10$fBtNOxiuJ/bI.oovrRe1puXoMzsxV9AxhLL7gtsmQqLxa3DuWcaV2'
export ADMIN_PASSWORD=testadminpass
export ADMIN_EMAILS=''
# dotenv fills in anything not set here from server/.env, which holds real
# mail credentials. Tests must never send real email.
export MAIL_PROVIDER=console
# Google sign-in has to be "configured" for its suite to exercise the
# redirects, but never with the real client: fixed dummies behave the same
# locally and on GitHub, where there is no server/.env at all.
export GOOGLE_CLIENT_ID=test-client.apps.googleusercontent.com
export GOOGLE_CLIENT_SECRET=test-google-secret
# Same for calls: the route must serve plain STUN here, and must never mint
# real Cloudflare credentials. Empty still counts as set, so dotenv leaves it.
export CLOUDFLARE_TURN_KEY_ID=
export CLOUDFLARE_TURN_API_TOKEN=
export TURN_URL=

rm -f "$DB"*
node src/index.js > /tmp/nook-test-server.log 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null; rm -f "$DB"*' EXIT

for _ in $(seq 1 45); do
  sleep 1
  if (exec 3<>"/dev/tcp/127.0.0.1/$PORT") 2>/dev/null; then break; fi
done

if ! (exec 3<>"/dev/tcp/127.0.0.1/$PORT") 2>/dev/null; then
  echo "server never came up — see /tmp/nook-test-server.log"
  tail -20 /tmp/nook-test-server.log
  exit 1
fi

if [ $# -gt 0 ]; then
  SUITES=()
  for name in "$@"; do SUITES+=("test/$name.mjs"); done
else
  SUITES=(test/features.mjs test/security.mjs test/snap.mjs test/notify.mjs test/push.mjs test/google-native.mjs test/notifyprefs.mjs test/templates.mjs test/account.mjs test/snapkeep.mjs test/turn.mjs test/search.mjs)
fi

FAILED=0
for suite in "${SUITES[@]}"; do
  node "$suite" || FAILED=$((FAILED + 1))
done

if [ "$FAILED" -gt 0 ]; then
  echo "  $FAILED suite(s) failed"
else
  echo "  all suites passed"
fi
exit "$FAILED"
