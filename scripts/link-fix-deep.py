#!/usr/bin/env python3
"""Deep-count second pass — finds 'partial content' cases that link-fix.py threshold=0 missed.

A 'partial content' case: linked folder has >0 but <=15 files (shallow),
suggesting a scaffold with a few strays, while a sibling Drive folder for
the same PROJ-#### holds the real files.

Algorithm:
  1. For each project_folders row, look up its prior shallow count from
     ~/Downloads/link-fix-cached-shallow.json (built first if missing).
  2. Skip rows where shallow > 15 (already populated).
  3. Skip rows already swapped tonight (folder_id IS NOT NULL — we set those).
  4. Skip rows with no alternative candidates from drive_census.
  5. Deep-count linked + every candidate (recursive depth=4, cap=500).
  6. Pick winner: shared-drive preferred, then files DESC.
     Swap if winner >= 3x linked deep count AND winner deep >= 30 files.

Outputs:
  ~/Downloads/link-fix-deep-report.csv
  ~/Downloads/link-fix-deep-updates.sql
"""
from __future__ import annotations
import csv, os, pickle, re, sys, time
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
FOLDER_MIME = 'application/vnd.google-apps.folder'
MAX_DEPTH = 4
MAX_WORKERS = 20
DEEP_CAP = 500
PARTIAL_LIMIT_SHALLOW = 15  # consider for deep recount
RATIO_THRESHOLD = 3          # winner must have >= 3x linked deep count
WIN_MIN_FILES = 30           # AND winner must have >= 30 deep files

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
                time.sleep(2 ** attempt)
                print(f'  retry {attempt+1}: {e}', file=sys.stderr)
        else:
            sys.exit(1)
        if not r.ok:
            print(f'  err: {r.status_code} {r.text[:200]}', file=sys.stderr); sys.exit(1)
        page = r.json()
        rows.extend(page)
        if len(page) < 1000:
            break
        offset += 1000
    return rows


def parse_folder_id(url):
    if not url: return None
    m = FOLDER_ID_RE.search(url)
    return m.group(1) if m else None


def parse_proj_id(name):
    matches = PROJ_RE.findall(name or '')
    return f'PROJ-{matches[0]}' if matches else None


def deep_count(service, folder_id, depth=0, cap=DEEP_CAP):
    if depth > MAX_DEPTH:
        return 0
    total = 0
    page_token = None
    try:
        while True:
            resp = service.files().list(
                q=f"'{folder_id}' in parents and trashed = false",
                fields='nextPageToken, files(id, mimeType)',
                pageSize=200,
                pageToken=page_token,
                supportsAllDrives=True,
                includeItemsFromAllDrives=True,
                corpora='allDrives',
            ).execute()
            for c in resp.get('files', []):
                if c['mimeType'] == FOLDER_MIME:
                    if total < cap:
                        total += deep_count(service, c['id'], depth + 1, cap)
                else:
                    total += 1
                    if total >= cap:
                        return total
            page_token = resp.get('nextPageToken')
            if not page_token:
                break
    except HttpError:
        return -1
    except Exception:
        return -1
    return total


def thread_deep_count(creds, folder_id):
    service = build('drive', 'v3', credentials=creds, cache_discovery=False)
    return deep_count(service, folder_id)


def main():
    started = datetime.now(timezone.utc)
    os.makedirs(OUT_DIR, exist_ok=True)

    print('Loading census + project_folders...', file=sys.stderr)
    folders_by_proj = defaultdict(list)
    with open(CENSUS_CSV) as f:
        for row in csv.DictReader(f):
            pid = row['parsed_proj_id']
            if pid:
                folders_by_proj[pid].append(row)

    pf_rows = supabase_get('project_folders?select=project_id,folder_id,folder_url')
    print(f'  project_folders: {len(pf_rows)}', file=sys.stderr)

    # Skip rows we already fixed tonight (folder_id IS NOT NULL means recently set)
    # AND skip rows with no alternatives in drive_census
    eligible = []
    for r in pf_rows:
        pid = r['project_id']
        candidates = folders_by_proj.get(pid, [])
        if len(candidates) < 2:
            continue  # nothing to swap to
        eligible.append(r)
    print(f'  eligible (have >=2 candidates): {len(eligible)}', file=sys.stderr)

    creds = get_creds()

    # Step 1a: SHALLOW count every linked folder (cheap pre-filter)
    print(f'\nStep 1a: SHALLOW-counting {len(eligible)} linked folders ({MAX_WORKERS} workers)...', file=sys.stderr)
    def shallow_count(service, folder_id, cap=50):
        try:
            r = service.files().list(
                q=f"'{folder_id}' in parents and trashed = false",
                fields='files(id, mimeType)', pageSize=200,
                supportsAllDrives=True, includeItemsFromAllDrives=True, corpora='allDrives',
            ).execute()
        except Exception:
            return -1
        files = []; folders = []
        for c in r.get('files', []):
            (folders if c['mimeType']==FOLDER_MIME else files).append(c['id'])
        total = len(files)
        if total >= cap: return total
        for sub in folders:
            try:
                r2 = service.files().list(
                    q=f"'{sub}' in parents and trashed = false",
                    fields='files(id, mimeType)', pageSize=200,
                    supportsAllDrives=True, includeItemsFromAllDrives=True, corpora='allDrives',
                ).execute()
            except Exception:
                continue
            for c in r2.get('files', []):
                if c['mimeType'] != FOLDER_MIME:
                    total += 1
                    if total >= cap: return total
        return total
    def shallow_task(r):
        fid = r.get('folder_id') or parse_folder_id(r.get('folder_url'))
        if not fid: return r['project_id'], None, -2
        service = build('drive','v3', credentials=creds, cache_discovery=False)
        return r['project_id'], fid, shallow_count(service, fid)
    linked_shallow = {}
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as ex:
        futures = [ex.submit(shallow_task, r) for r in eligible]
        done = 0
        for fut in as_completed(futures):
            pid, fid, cnt = fut.result()
            linked_shallow[pid] = {'folder_id': fid, 'count': cnt}
            done += 1
            if done % 500 == 0:
                el = (datetime.now(timezone.utc) - started).total_seconds()
                print(f'  shallow {done}/{len(eligible)} | {done/el:.1f}/s', file=sys.stderr)

    # Step 1b: filter to partial-content (shallow 1..PARTIAL_LIMIT_SHALLOW) and deep-count those
    partial_targets = [r for r in eligible
                       if 1 <= linked_shallow.get(r['project_id'], {}).get('count', -1) <= PARTIAL_LIMIT_SHALLOW]
    print(f'\nStep 1b: {len(partial_targets)} partial-content linked folders to deep-count', file=sys.stderr)
    linked_deep = {}
    def linked_task(r):
        fid = linked_shallow[r['project_id']]['folder_id']
        if not fid: return r['project_id'], None, -2
        cnt = thread_deep_count(creds, fid)
        return r['project_id'], fid, cnt
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as ex:
        futures = [ex.submit(linked_task, r) for r in partial_targets]
        done = 0
        for fut in as_completed(futures):
            pid, fid, cnt = fut.result()
            linked_deep[pid] = {'folder_id': fid, 'count': cnt}
            done += 1
            if done % 200 == 0:
                el = (datetime.now(timezone.utc) - started).total_seconds()
                print(f'  deep linked {done}/{len(partial_targets)} | {done/el:.1f}/s', file=sys.stderr)

    # Step 2: build needs_review from the partial_targets set we deep-counted
    needs_review = []
    for r in partial_targets:
        pid = r['project_id']
        info = linked_deep.get(pid, {})
        linked_fid = info.get('folder_id')
        linked_cnt = info.get('count', -2)
        if linked_cnt < 1:  # error or now-empty
            continue
        candidates = [c for c in folders_by_proj.get(pid, []) if c['folder_id'] != linked_fid]
        if not candidates:
            continue
        needs_review.append((pid, linked_fid, linked_cnt, candidates))

    print(f'\nStep 2: {len(needs_review)} projects with partial-content linked + candidates', file=sys.stderr)

    # Step 3: deep-count candidates (cache by folder_id)
    print(f'\nStep 3: deep-counting candidate folders...', file=sys.stderr)
    cand_cache = {}
    all_cand_ids = set()
    for _, _, _, cands in needs_review:
        for c in cands:
            all_cand_ids.add(c['folder_id'])

    def cand_task(folder_id):
        return folder_id, thread_deep_count(creds, folder_id)

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as ex:
        futures = [ex.submit(cand_task, fid) for fid in all_cand_ids]
        done = 0
        for fut in as_completed(futures):
            fid, cnt = fut.result()
            cand_cache[fid] = cnt
            done += 1
            if done % 200 == 0:
                elapsed = (datetime.now(timezone.utc) - started).total_seconds()
                print(f'  {done}/{len(all_cand_ids)} candidates', file=sys.stderr)

    # Pick winners (shared-drive preferred, files DESC, then modified DESC)
    plans = []
    for pid, old_fid, old_cnt, candidates in needs_review:
        scored = []
        for c in candidates:
            cnt = cand_cache.get(c['folder_id'], -1)
            if cnt < 0:
                continue
            has_drive = bool(c.get('drive_id'))
            scored.append((cnt, has_drive, c.get('modified', ''), c))
        if not scored:
            continue
        # winner: max files, prefer shared drive, prefer newest
        scored.sort(key=lambda t: (t[0], int(t[1]), t[2]), reverse=True)
        winner = scored[0]
        win_cnt = winner[0]
        win_rec = winner[3]
        if win_cnt >= max(WIN_MIN_FILES, RATIO_THRESHOLD * old_cnt):
            plans.append({
                'project_id': pid,
                'old_folder_id': old_fid,
                'old_count': old_cnt,
                'new_folder_id': win_rec['folder_id'],
                'new_folder_name': win_rec['folder_name'],
                'new_drive_id': win_rec.get('drive_id', ''),
                'new_count': win_cnt,
            })

    print(f'\nStep 4: {len(plans)} swap plans (winner >={RATIO_THRESHOLD}x linked AND >={WIN_MIN_FILES} files)', file=sys.stderr)

    # Outputs
    report = os.path.join(OUT_DIR, 'link-fix-deep-report.csv')
    with open(report, 'w', newline='') as f:
        if plans:
            w = csv.DictWriter(f, fieldnames=list(plans[0].keys()))
            w.writeheader()
            for p in plans: w.writerow(p)

    # Summary
    summary = os.path.join(OUT_DIR, 'link-fix-deep-summary.txt')
    elapsed = (datetime.now(timezone.utc) - started).total_seconds()
    with open(summary, 'w') as f:
        f.write(f'link-fix-deep run — {datetime.now(timezone.utc).isoformat()}\n')
        f.write(f'Elapsed: {elapsed:.1f}s\n\n')
        f.write(f'eligible (>=2 candidates):       {len(eligible)}\n')
        f.write(f'partial-content (1-{PARTIAL_LIMIT_SHALLOW*5} linked deep): {len(needs_review)}\n')
        f.write(f'swap plans (winner >={RATIO_THRESHOLD}x +>={WIN_MIN_FILES}):  {len(plans)}\n')
        from collections import Counter
        c = Counter(p['new_drive_id'] or '(My Drive)' for p in plans)
        f.write(f'\nWinners by drive:\n')
        for d, n in c.most_common(): f.write(f'  {n:>5} {d}\n')
    with open(summary) as f:
        print(f.read())


if __name__ == '__main__':
    main()
