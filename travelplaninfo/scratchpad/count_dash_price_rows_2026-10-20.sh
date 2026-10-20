#!/usr/bin/env bash
# READ-ONLY diagnostic — Task 8 report deliverable (created 2026-10-20).
#
# Counts how many persisted trip_items rows still carry the display-only
# "no price" placeholder label "—" (NO_PRICE_LABEL) in the production
# database. This is the historical damage the Task 2 fix (never persist "—"
# as price_estimate) makes countable but does NOT repair.
#
# SAFETY: This script opens the SQLite file through a mode=ro URI, so the
# connection cannot write — any mutation attempt would error out. No output,
# file, or DB state anywhere is modified by running it. Per the task plan it
# is NOT executed as part of Task 2; it goes to Jose with the Task 8 report.
#
# Conventions copied from scratchpad/deploy_tpi.sh (ssh host, key, app dir).
# DB path derived from src/lib/db.ts: DB_PATH = <app-cwd>/data/tpi.db.
set -euo pipefail

VPS_HOST="root@104.225.221.138"
VPS_APP="/home/travelplaninfo/nextjs"
SSH_KEY="/home/jarvis/.ssh/id_ed25519"
SSH="ssh -i ${SSH_KEY} -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15 ${VPS_HOST}"

# mode=ro: SQLite opens the file with no write intent at all (read-only
# URI); it refuses any statement that would mutate the database.
$SSH "sqlite3 'file:${VPS_APP}/data/tpi.db?mode=ro' \"SELECT count(*) FROM trip_items WHERE price_estimate = '—';\""

echo "rows with price_estimate = '—' (read-only count, nothing modified)"