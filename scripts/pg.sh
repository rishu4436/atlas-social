#!/usr/bin/env bash
# Local dev Postgres using the embedded-postgres binaries (no system install needed).
set -e
PGROOT=${PGROOT:-/workspace/.atlas-pg}
BIN=$PGROOT/pkg/node_modules/@embedded-postgres/linux-x64/native/bin
if [ ! -x "$BIN/pg_ctl" ]; then
  mkdir -p $PGROOT/pkg && (cd $PGROOT/pkg && npm init -y >/dev/null && npm i embedded-postgres@17.5.0-beta.15 >/dev/null && node node_modules/@embedded-postgres/linux-x64/scripts/hydrate-symlinks.js)
fi
case "$1" in
  start)
    NEW=; [ -d $PGROOT/data ] || { $BIN/initdb -D $PGROOT/data -U atlas --auth=trust -E UTF8 >/dev/null; NEW=1; }
    $BIN/pg_ctl -D $PGROOT/data status >/dev/null 2>&1 || $BIN/pg_ctl -D $PGROOT/data -l $PGROOT/pg.log -o "-p 5433 -k /tmp" -w start
    if [ -n "$NEW" ]; then psql -h 127.0.0.1 -p 5433 -U atlas -d postgres -c "create database atlas" -c "create database atlas_test"; fi ;;
  stop) $BIN/pg_ctl -D $PGROOT/data stop ;;
  status) $BIN/pg_ctl -D $PGROOT/data status ;;
  *) echo "usage: $0 start|stop|status"; exit 1 ;;
esac
