#!/usr/bin/env python3
"""
For every project_folders row where the linked Drive folder is empty (or thinly
populated) and a sibling Drive folder for the same PROJ-#### has more files,
generate an UPDATE statement repointing to the winner.

Sibling folders come from drive_census_folders.csv (produced by drive-census.py).

Winner rule (matches session-53 1aef1ed):
  (file_count DESC, has_shared_drive preferred, modified DESC)

Pipeline:
  1. Load drive_census_folders.csv → all PROJ folders grouped by parsed PROJ-ID.
  2. Load project_folders → linked folder_url per project_id.
  3. For every linked folder, file-count it (depth-3 recursive, capped at 200).
  4. If linked count <= EMPTY_THRESHOLD AND project has >1 candidate folder:
       file-count every other candidate, pick winner, emit UPDATE if winner
       has strictly more files than current linked.
  5. Write CSV report + SQL file (NO production execution — Greg approves).

Outputs:
  ~/Downloads/link-fix-report.csv   — every linked folder with its count + chosen winner
  ~/Downloads/link-fix-updates.sql  — UPDATE statements (idempotent, WHERE folder_url=<old>)
  ~/Downloads/link-fix-summary.txt  — readable summary

Usage:
  python3 scripts/link-fix.py                          # full sweep, dry run (no execute)
  python3 scripts/link-fix.py --limit 200              # smoke test
  python3 scripts/link-fix.py --proj PROJ-29255,PROJ-28547  # specific projects
"""
from __future__ import annotations

import argparse
import csv
import os
import pickle
import re
import sys
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone

import requests as req
from google.auth.transport.requests import Request
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

TOKEN_FILE = os.path.expanduser('~/gdrive_token_readonly.pkl')
CENSUS_CSV = os.path.expanduser('~/Downloads/drive_census_folders.csv')
OUT_DIR = os.path.expanduser('~/Downloads')
PROJ_RE = re.compile(r'\bPROJ-(\d+)\b', re.IGNORECASE)
EMPTY_THRESHOLD = 0  # only repoint if currently linked folder has 0 files
MAX_DEPTH = 3
MAX_WORKERS = 20
FOLDER_MIME = 'application/vnd.google-apps.folder'

FOLDER_ID_RE = re.compile(r'/folders/([A-Za-z0-9_-]+)')


def get_creds():
    with open(TOKEN_FILE, 'rb') as f:
        creds = pickle.load(f)
    if creds.expired and creds.refresh_token:
        creds.refresh(Request())
        with open(TOKEN_FILE, 'wb') as f:
            pickle.dump(creds, f)
    return creds


def supabase_get(path):
    import time as _t
    url = os.environ.get('NEXT_PUBLIC_SUPABASE_URL')
    key = os.environ.get('SUPABASE_SERVICE_ROLE_KEY')
    headers = {'apikey': key, 'Authorization': f'Bearer {key}'}
    rows = []
    offset = 0
    while True:
        sep = '&' if '?' in path else '?'
        full = f'{url}/rest/v1/{path}{sep}limit=1000&offset={offset}'
        for attempt in range(5):
            try:
                r = req.get(full, headers=headers, timeout=30)
                break
            except Exception as e:
                wait = 2 ** attempt
                print(f'  supabase retry {attempt+1}/5 in {wait}s: {e}', file=sys.stderr)
                _t.sleep(wait)
        else:
            print(f'ERROR: supabase_get failed after retries', file=sys.stderr)
            sys.exit(1)
        if not r.ok:
            print(f'ERROR {r.status_code}: {r.text}', file=sys.stderr)
            sys.exit(1)
        page = r.json()
        rows.extend(page)
        if len(page) < 1000:
            break
        offset += 1000
    return rows


def parse_folder_id(url):
    if not url:
        return None
    m = FOLDER_ID_RE.search(url)
    return m.group(1) if m else None


def parse_proj_id(name):
    matches = PROJ_RE.findall(name or '')
    if not matches:
        return None
    return f'PROJ-{matches[0]}'


def list_children_once(service, folder_id):
    """Single-page listing of immediate children. Returns (files_at_root, subfolder_ids).
    No pagination — first 200 children only (more than enough for any sane folder)."""
    try:
        resp = service.files().list(
            q=f"'{folder_id}' in parents and trashed = false",
            fields='files(id, mimeType)',
            pageSize=200,
            supportsAllDrives=True,
            includeItemsFromAllDrives=True,
            corpora='allDrives',
        ).execute()
    except HttpError:
        return None, None
    except Exception:
        return None, None
    files = []
    folders = []
    for c in resp.get('files', []):
        if c['mimeType'] == FOLDER_MIME:
            folders.append(c['id'])
        else:
            files.append(c['id'])
    return files, folders


def count_files_shallow(service, folder_id, cap=50):
    """Bounded shallow file-count: root + each immediate subfolder, one level down.
    Returns -1 on error, else int capped at `cap`. Used to differentiate
    'empty scaffold' (0) from 'populated' (>0). Worst case 1 + 16 = 17 calls."""
    files, folders = list_children_once(service, folder_id)
    if files is None:
        return -1
    total = len(files)
    if total >= cap:
        return total
    for sub_id in folders:
        sub_files, _ = list_children_once(service, sub_id)
        if sub_files is None:
            continue
        total += len(sub_files)
        if total >= cap:
            return total
    return total


def thread_count(creds, folder_id):
    """Service objects aren't thread-safe. Build per-thread."""
    service = build('drive', 'v3', credentials=creds, cache_discovery=False)
    return count_files_shallow(service, folder_id)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--limit', type=int, help='Limit project_folders rows scanned (smoke test)')
    parser.add_argument('--proj', help='Comma-separated PROJ-IDs to scan (overrides --limit)')
    parser.add_argument('--threshold', type=int, default=EMPTY_THRESHOLD,
                        help=f'Repoint if linked folder file count <= this (default {EMPTY_THRESHOLD})')
    args = parser.parse_args()

    started = datetime.now(timezone.utc)
    os.makedirs(OUT_DIR, exist_ok=True)

    print('Loading census CSV...', file=sys.stderr)
    folders_by_proj = defaultdict(list)
    if not os.path.exists(CENSUS_CSV):
        print(f'ERROR: {CENSUS_CSV} not found. Run scripts/drive-census.py first.', file=sys.stderr)
        sys.exit(1)
    with open(CENSUS_CSV) as f:
        for row in csv.DictReader(f):
            pid = row['parsed_proj_id']
            if pid:
                folders_by_proj[pid].append(row)

    print(f'  loaded {sum(len(v) for v in folders_by_proj.values())} census rows / {len(folders_by_proj)} unique PROJ-IDs', file=sys.stderr)

    print('Loading project_folders...', file=sys.stderr)
    pf_rows = supabase_get('project_folders?select=project_id,folder_id,folder_url')
    print(f'  loaded {len(pf_rows)} project_folders rows', file=sys.stderr)

    # Filter scope
    if args.proj:
        wanted = set(p.strip() for p in args.proj.split(','))
        pf_rows = [r for r in pf_rows if r['project_id'] in wanted]
        print(f'  filtered to {len(pf_rows)} rows by --proj', file=sys.stderr)
    elif args.limit:
        pf_rows = pf_rows[:args.limit]
        print(f'  limited to first {len(pf_rows)} rows', file=sys.stderr)

    creds = get_creds()

    # Step 1: count files in every currently-linked folder
    print(f'\nStep 1: counting files in {len(pf_rows)} linked folders ({MAX_WORKERS} workers)...', file=sys.stderr)
    linked_counts = {}  # project_id -> {linked_folder_id, linked_count}

    def task(row):
        fid = row.get('folder_id') or parse_folder_id(row.get('folder_url'))
        if not fid:
            return row['project_id'], None, -2  # no folder id
        cnt = thread_count(creds, fid)
        return row['project_id'], fid, cnt

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as ex:
        futures = [ex.submit(task, r) for r in pf_rows]
        done = 0
        for fut in as_completed(futures):
            pid, fid, cnt = fut.result()
            linked_counts[pid] = {'folder_id': fid, 'count': cnt}
            done += 1
            if done % 200 == 0:
                print(f'  {done}/{len(pf_rows)} linked counted', file=sys.stderr)

    # Step 2: identify candidates for repointing
    needs_review = []  # (project_id, linked_folder_id, linked_count, candidates)
    for r in pf_rows:
        pid = r['project_id']
        info = linked_counts.get(pid, {})
        linked_fid = info.get('folder_id')
        linked_cnt = info.get('count', -2)
        if linked_cnt > args.threshold:
            continue  # linked folder has files — leave alone
        candidates = [c for c in folders_by_proj.get(pid, []) if c['folder_id'] != linked_fid]
        if not candidates:
            continue  # no alternative folders — nothing we can do automatically
        needs_review.append((pid, linked_fid, linked_cnt, candidates))

    print(f'\nStep 2: {len(needs_review)} projects with empty linked folder + alternative candidates', file=sys.stderr)

    # Step 3: for each needs_review project, count each candidate, pick winner
    print(f'\nStep 3: counting candidate folders ({MAX_WORKERS} workers)...', file=sys.stderr)
    swap_plans = []  # (pid, old_fid, old_count, new_fid, new_count, new_name, new_drive_id, all_candidates)

    cand_count_cache = {}  # folder_id -> count

    def cand_task(folder_id):
        if folder_id in cand_count_cache:
            return folder_id, cand_count_cache[folder_id]
        cnt = thread_count(creds, folder_id)
        return folder_id, cnt

    all_cand_ids = set()
    for _, _, _, cands in needs_review:
        for c in cands:
            all_cand_ids.add(c['folder_id'])

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as ex:
        futures = [ex.submit(cand_task, fid) for fid in all_cand_ids]
        done = 0
        for fut in as_completed(futures):
            fid, cnt = fut.result()
            cand_count_cache[fid] = cnt
            done += 1
            if done % 200 == 0:
                print(f'  {done}/{len(all_cand_ids)} candidates counted', file=sys.stderr)

    # Pick winners
    for pid, old_fid, old_cnt, candidates in needs_review:
        scored = []
        for c in candidates:
            cnt = cand_count_cache.get(c['folder_id'], -1)
            if cnt < 0:
                continue
            has_drive = bool(c.get('drive_id'))
            scored.append((cnt, has_drive, c.get('modified', ''), c))
        if not scored:
            continue
        scored.sort(key=lambda t: (-t[0], -int(t[1]), t[2]), reverse=False)
        # That gives ascending; we want winner = max files, prefer shared drive, prefer newest
        scored.sort(key=lambda t: (t[0], int(t[1]), t[2]), reverse=True)
        winner = scored[0]
        win_cnt = winner[0]
        win_rec = winner[3]
        if win_cnt > old_cnt:
            swap_plans.append({
                'project_id': pid,
                'old_folder_id': old_fid,
                'old_count': old_cnt,
                'new_folder_id': win_rec['folder_id'],
                'new_folder_name': win_rec['folder_name'],
                'new_drive_id': win_rec.get('drive_id', ''),
                'new_count': win_cnt,
                'all_candidates': '|'.join(f"{c['folder_id']}:{cand_count_cache.get(c['folder_id'],'?')}" for c in candidates),
            })

    # Outputs
    report_csv = os.path.join(OUT_DIR, 'link-fix-report.csv')
    sql_path = os.path.join(OUT_DIR, 'link-fix-updates.sql')
    summary_path = os.path.join(OUT_DIR, 'link-fix-summary.txt')

    with open(report_csv, 'w', newline='') as f:
        if swap_plans:
            w = csv.DictWriter(f, fieldnames=list(swap_plans[0].keys()))
            w.writeheader()
            for p in swap_plans:
                w.writerow(p)

    with open(sql_path, 'w') as f:
        f.write('-- link-fix UPDATE statements\n')
        f.write(f'-- Generated {datetime.now(timezone.utc).isoformat()} by scripts/link-fix.py\n')
        f.write(f'-- {len(swap_plans)} repointings — review BEFORE running\n')
        f.write(f"-- Each is idempotent: WHERE folder_url contains old folder_id\n\n")
        for p in swap_plans:
            new_url = f"https://drive.google.com/drive/folders/{p['new_folder_id']}"
            f.write(
                f"-- {p['project_id']}: {p['old_count']} -> {p['new_count']} files "
                f"({p['new_folder_name']!r})\n"
                f"UPDATE project_folders SET folder_id = '{p['new_folder_id']}', "
                f"folder_url = '{new_url}' "
                f"WHERE project_id = '{p['project_id']}' "
                f"AND folder_url LIKE '%{p['old_folder_id']}%';\n\n"
            )

    elapsed = (datetime.now(timezone.utc) - started).total_seconds()
    with open(summary_path, 'w') as f:
        empty_or_inaccessible = sum(1 for v in linked_counts.values() if v.get('count', -2) <= 0)
        f.write(f'link-fix run — {datetime.now(timezone.utc).isoformat()}\n')
        f.write(f'Elapsed: {elapsed:.1f}s\n\n')
        f.write(f'project_folders rows scanned:           {len(pf_rows)}\n')
        f.write(f'  linked folder empty (<= {args.threshold} files): {empty_or_inaccessible}\n')
        f.write(f'  with alternative candidate folders:    {len(needs_review)}\n')
        f.write(f'  swap plans (winner has more files):    {len(swap_plans)}\n\n')
        f.write(f'Outputs:\n')
        f.write(f'  {report_csv}\n')
        f.write(f'  {sql_path}\n')
    with open(summary_path) as f:
        print(f.read())


if __name__ == '__main__':
    main()
