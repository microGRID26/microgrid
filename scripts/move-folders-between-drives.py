#!/usr/bin/env python3
"""
Move legacy project folders from Bludocs 2025-2026-2 (FULL) to
Bludocs 2025-2026 (has capacity).

Reads ~/Downloads/upload_install_agreements_log.csv, picks rows where status
contains "limit" or other capacity-related errors, looks up the folder_id from
project_folders, and moves each folder via files.update with addParents +
removeParents.

Folder IDs and URLs do NOT change when moving — so no DB updates needed.

Usage:
  python3 scripts/move-folders-between-drives.py            # dry run
  python3 scripts/move-folders-between-drives.py --execute  # actually move
  python3 scripts/move-folders-between-drives.py --execute --limit 5  # test 5 first
"""

import argparse
import csv
import os
import pickle
import sys

from google.auth.transport.requests import Request
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
import requests as req

TOKEN_FILE = os.path.expanduser('~/gdrive_token_write.pkl')
LOG_FILE = os.path.expanduser('~/Downloads/upload_install_agreements_log.csv')
OUT_LOG = os.path.expanduser('~/Downloads/move_folders_log.csv')

SOURCE_DRIVE_ID = '0ABdNGVimHZ-6Uk9PVA'  # Bludocs 2025-2026-2 (FULL)
DEST_DRIVE_ID = '0AHw_qbL-LEGLUk9PVA'    # Bludocs 2025-2026 (has capacity)

SUPABASE_URL = 'https://hzymsezqfxzpbcqryeim.supabase.co'
SUPABASE_ANON_KEY = 'sb_publishable_9yPXBcL2QGdKrYgHHWUKfg_kBKznGQT'


def supabase_get(path: str):
    headers = {'apikey': SUPABASE_ANON_KEY, 'Authorization': f'Bearer {SUPABASE_ANON_KEY}'}
    resp = req.get(f'{SUPABASE_URL}/rest/v1/{path}', headers=headers)
    data = resp.json()
    if not isinstance(data, list):
        print(f'ERROR from Supabase ({resp.status_code}): {data}')
        sys.exit(1)
    return data


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--execute', action='store_true')
    parser.add_argument('--limit', type=int, default=0)
    args = parser.parse_args()

    if not os.path.exists(LOG_FILE):
        print(f'ERROR: {LOG_FILE} not found.')
        sys.exit(1)

    # Read failed entries from upload log
    failed_proj_ids = []
    with open(LOG_FILE) as f:
        for row in csv.DictReader(f):
            if 'limit' in row['status'].lower() or row['status'] in (
                'subfolder_create_error', 'upload_error',
            ):
                failed_proj_ids.append(row['project_id'])
    failed_proj_ids = sorted(set(failed_proj_ids))
    print(f'Found {len(failed_proj_ids)} failed project IDs in upload log')

    if args.limit:
        failed_proj_ids = failed_proj_ids[:args.limit]
        print(f'Limited to first {len(failed_proj_ids)}')

    # Look up folder IDs
    in_filter = ','.join(failed_proj_ids)
    rows = supabase_get(f'project_folders?select=project_id,folder_url&project_id=in.({in_filter})')
    folder_map = {}
    for r in rows:
        url = r['folder_url'] or ''
        fid = url.split('/folders/')[-1].split('/')[0].split('?')[0] if '/folders/' in url else ''
        if fid:
            folder_map[r['project_id']] = fid
    print(f'Resolved folder IDs for {len(folder_map)} of {len(failed_proj_ids)}\n')

    # Auth
    with open(TOKEN_FILE, 'rb') as f:
        creds = pickle.load(f)
    if creds.expired and creds.refresh_token:
        creds.refresh(Request())
    service = build('drive', 'v3', credentials=creds, cache_discovery=False)

    log_rows = []
    moved = 0
    skipped = 0
    errors = 0

    for i, proj_id in enumerate(failed_proj_ids, 1):
        folder_id = folder_map.get(proj_id)
        if not folder_id:
            print(f'  [{i:3}/{len(failed_proj_ids)}] {proj_id} → SKIP (no folder mapping)')
            log_rows.append({'project_id': proj_id, 'folder_id': '', 'status': 'no_folder', 'detail': ''})
            skipped += 1
            continue

        try:
            meta = service.files().get(
                fileId=folder_id,
                fields='id, name, parents, driveId',
                supportsAllDrives=True,
            ).execute()
        except HttpError as e:
            print(f'  [{i:3}/{len(failed_proj_ids)}] {proj_id} → ERROR get: {e}')
            log_rows.append({'project_id': proj_id, 'folder_id': folder_id, 'status': 'get_error', 'detail': str(e)[:200]})
            errors += 1
            continue

        cur_drive = meta.get('driveId', '')
        if cur_drive != SOURCE_DRIVE_ID:
            print(f"  [{i:3}/{len(failed_proj_ids)}] {proj_id} → SKIP (already in {cur_drive[:10]}…, not in source drive)")
            log_rows.append({'project_id': proj_id, 'folder_id': folder_id, 'status': 'wrong_drive', 'detail': cur_drive})
            skipped += 1
            continue

        if args.execute:
            try:
                # Move = addParents new + removeParents old
                old_parents = ','.join(meta.get('parents', []))
                service.files().update(
                    fileId=folder_id,
                    addParents=DEST_DRIVE_ID,
                    removeParents=old_parents,
                    fields='id, parents, driveId',
                    supportsAllDrives=True,
                ).execute()
                print(f'  [{i:3}/{len(failed_proj_ids)}] {proj_id} → MOVED: "{meta["name"]}"')
                log_rows.append({'project_id': proj_id, 'folder_id': folder_id, 'status': 'moved', 'detail': ''})
                moved += 1
            except HttpError as e:
                print(f'  [{i:3}/{len(failed_proj_ids)}] {proj_id} → ERROR move: {e}')
                log_rows.append({'project_id': proj_id, 'folder_id': folder_id, 'status': 'move_error', 'detail': str(e)[:200]})
                errors += 1
        else:
            print(f'  [{i:3}/{len(failed_proj_ids)}] {proj_id} → would move "{meta["name"]}"')
            log_rows.append({'project_id': proj_id, 'folder_id': folder_id, 'status': 'dry_run', 'detail': ''})

    # Write log
    with open(OUT_LOG, 'w', newline='') as f:
        w = csv.DictWriter(f, fieldnames=['project_id', 'folder_id', 'status', 'detail'])
        w.writeheader()
        w.writerows(log_rows)

    print(f'\nSummary:')
    print(f'  Moved:    {moved}')
    print(f'  Skipped:  {skipped}')
    print(f'  Errors:   {errors}')
    print(f'  Log:      {OUT_LOG}')
    if not args.execute:
        print('\n  DRY RUN — re-run with --execute to actually move.')


if __name__ == '__main__':
    main()
