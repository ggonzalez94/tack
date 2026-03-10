#!/bin/bash
set -euo pipefail

DB_PATH="${DATABASE_PATH:-./data/tack.db}"
BACKUP_PATH="${1:-${DB_PATH}.bak}"

sqlite3 "$DB_PATH" ".backup '$BACKUP_PATH'"
echo "Backup created: $BACKUP_PATH"
