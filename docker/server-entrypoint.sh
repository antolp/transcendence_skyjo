#!/bin/sh
set -eu

npm run db:migrate -w @ft/server
npm run db:seed -w @ft/server
exec "$@"
