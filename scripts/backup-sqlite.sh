#!/usr/bin/env bash
set -euo pipefail

# Backup SQLite database using the .backup command for a consistent snapshot.
# Usage: ./scripts/backup-sqlite.sh [db_path] [backup_dir]
#
# Defaults:
#   db_path:    ./data/ipfs-manager.db  (or DATABASE_PATH env var)
#   backup_dir: ./backups

DB_PATH="${1:-${DATABASE_PATH:-./data/tack.db}}"
BACKUP_DIR="${2:-./backups}"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_FILE="${BACKUP_DIR}/tack-${TIMESTAMP}.db"

if [ ! -f "$DB_PATH" ]; then
  echo "ERROR: database not found at ${DB_PATH}" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
sqlite3 "$DB_PATH" ".backup '${BACKUP_FILE}'"
echo "Backup created: ${BACKUP_FILE} ($(du -h "$BACKUP_FILE" | cut -f1))"
