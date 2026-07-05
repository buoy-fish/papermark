#!/bin/sh
# Apply pending Prisma migrations against the (healthy) DB, then hand off to the
# container CMD (`next start`). depends_on: papermark-db (healthy) in compose
# guarantees the database is reachable before this runs.
set -e

echo "[entrypoint] prisma migrate deploy"
npx prisma migrate deploy

exec "$@"
