#!/usr/bin/env python3
"""
Drive-wide census of every folder whose name contains "PROJ-".
Single flat list — no per-folder content walk (audit-project-folders.py
already handles content state for *linked* folders).

This script answers four questions audit-project-folders.py can't:
  1. How many Drive folders exist for each PROJ-####  →  duplicates
  2. Which PROJ-#### in projects / legacy_projects have NO folder anywhere
  3. Which Drive folders look like PROJ folders but are not linked in project_folders
  4. Which Drive folders have malformed PROJ-IDs

Outputs (all under ~/Downloads):
  drive_census_folders.csv   — every PROJ-named folder with attrs
  drive_census_duplicates.csv — PROJ-IDs with >1 folder (the priority list)
  drive_census_missing.csv   — project rows with no folder anywhere
  drive_census_orphans.csv   — folders not linked in project_folders
  drive_census_summary.txt   — readable summary

Usage:
  python3 scripts/drive-census.py
"""

import csv
import os
import pickle
import re
import sys
from collections import defaultdict
from datetime import datetime, timezone

from google.auth.transport.requests import Request
from googleapiclient.discovery import build
import requests as req

TOKEN_FILE = os.path.expanduser('~/gdrive_token_readonly.pkl')
OUT_DIR = os.path.expanduser('~/Downloads')
PROJ_RE = re.compile(r'\bPROJ-(\d+)\b', re.IGNORECASE)


def get_service():
    with open(TOKEN_FILE, 'rb') as f:
        creds = pickle.load(f)
    if creds.expired and creds.refresh_token:
        creds.refresh(Request())
        with open(TOKEN_FILE, 'wb') as f:
            pickle.dump(creds, f)
    return build('drive', 'v3', credentials=creds, cache_discovery=False)


def supabase_get(path: str, page_size: int = 1000):
    url = os.environ.get('NEXT_PUBLIC_SUPABASE_URL')
    key = os.environ.get('SUPABASE_SERVICE_ROLE_KEY')
    if not url or not key:
        print('ERROR: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be exported.', file=sys.stderr)
        sys.exit(1)
    headers = {'apikey': key, 'Authorization': f'Bearer {key}', 'Range-Unit': 'items'}
    rows = []
    offset = 0
    while True:
        sep = '&' if '?' in path else '?'
        full = f'{url}/rest/v1/{path}{sep}limit={page_size}&offset={offset}'
        r = req.get(full, headers=headers)
        if not r.ok:
            print(f'ERROR {r.status_code}: {r.text}', file=sys.stderr)
            sys.exit(1)
        page = r.json()
        rows.extend(page)
        if len(page) < page_size:
            break
        offset += page_size
    return rows


def list_all_proj_folders(service):
    """Search the entire indexable corpus for folders whose name contains 'PROJ-'.
    Returns list of dicts: id, name, parents (list), driveId, createdTime, modifiedTime, trashed.
    """
    folders = []
    page_token = None
    page_num = 0
    while True:
        page_num += 1
        try:
            resp = service.files().list(
                q="mimeType = 'application/vnd.google-apps.folder' and name contains 'PROJ-' and trashed = false",
                fields='nextPageToken, files(id, name, parents, driveId, createdTime, modifiedTime)',
                pageSize=1000,
                pageToken=page_token,
                supportsAllDrives=True,
                includeItemsFromAllDrives=True,
                corpora='allDrives',
            ).execute()
        except Exception as e:
            print(f'  ERROR on page {page_num}: {e}', file=sys.stderr)
            break
        page = resp.get('files', [])
        folders.extend(page)
        print(f'  page {page_num}: +{len(page)} (total {len(folders)})', file=sys.stderr)
        page_token = resp.get('nextPageToken')
        if not page_token:
            break
    return folders


def folder_id_from_url(url: str) -> str:
    if not url:
        return ''
    if '/folders/' in url:
        return url.split('/folders/')[-1].split('/')[0].split('?')[0]
    return url


def classify_proj_id(name):
    """Return (canonical_proj_id, status) where status in {'ok', 'malformed'}.
    canonical_proj_id is 'PROJ-#####' uppercase, or None for malformed.
    """
    matches = PROJ_RE.findall(name)
    if not matches:
        return None, 'malformed'
    if len(matches) > 1:
        return f'PROJ-{matches[0]}', 'multi_id_in_name'
    digits = matches[0]
    if len(digits) < 4:
        return f'PROJ-{digits}', 'malformed'
    return f'PROJ-{digits}', 'ok'


def main():
    started = datetime.now(timezone.utc)
    os.makedirs(OUT_DIR, exist_ok=True)

    print('Loading Drive folders...', file=sys.stderr)
    service = get_service()
    folders = list_all_proj_folders(service)
    print(f'  Found {len(folders)} PROJ-named folders in Drive', file=sys.stderr)

    print('\nLoading Supabase tables...', file=sys.stderr)
    project_folders = supabase_get('project_folders?select=project_id,folder_id,folder_url')
    projects = supabase_get('projects?select=id,name,stage,disposition')
    legacy_projects = supabase_get('legacy_projects?select=id,name,disposition,stage')
    print(f'  project_folders: {len(project_folders)} | projects: {len(projects)} | legacy_projects: {len(legacy_projects)}', file=sys.stderr)

    pf_by_id = {r['project_id']: r for r in project_folders}
    pf_folder_ids = {r['folder_id'] for r in project_folders if r.get('folder_id')}
    pf_url_ids = {folder_id_from_url(r['folder_url']) for r in project_folders if r.get('folder_url')}
    linked_folder_ids = pf_folder_ids | {fid for fid in pf_url_ids if fid}

    all_proj_ids = {r['id'] for r in projects} | {r['id'] for r in legacy_projects}
    proj_name = {r['id']: r.get('name') or '' for r in projects}
    legacy_name = {r['id']: r.get('name') or '' for r in legacy_projects}

    # Group Drive folders by canonical PROJ-####
    by_proj = defaultdict(list)
    malformed = []
    enriched = []
    for f in folders:
        proj_id, status = classify_proj_id(f['name'])
        rec = {
            'folder_id': f['id'],
            'folder_name': f['name'],
            'parents': '|'.join(f.get('parents', [])),
            'drive_id': f.get('driveId', ''),
            'created': f.get('createdTime', ''),
            'modified': f.get('modifiedTime', ''),
            'parsed_proj_id': proj_id or '',
            'parse_status': status,
            'linked_in_project_folders': f['id'] in linked_folder_ids,
            'in_projects': (proj_id in {r['id'] for r in projects}) if proj_id else False,
            'in_legacy_projects': (proj_id in {r['id'] for r in legacy_projects}) if proj_id else False,
        }
        enriched.append(rec)
        if status == 'malformed':
            malformed.append(rec)
            continue
        by_proj[proj_id].append(rec)

    # Duplicates: PROJ-#### with >1 folder
    duplicates = {pid: recs for pid, recs in by_proj.items() if len(recs) > 1}

    # Missing: project rows with no Drive folder at all
    missing = sorted(all_proj_ids - set(by_proj.keys()))

    # Orphans: Drive folders not linked in project_folders (could be intentional dups or stale)
    orphans = [r for r in enriched if not r['linked_in_project_folders']]

    # Write outputs
    folders_csv = os.path.join(OUT_DIR, 'drive_census_folders.csv')
    with open(folders_csv, 'w', newline='') as f:
        w = csv.DictWriter(f, fieldnames=list(enriched[0].keys()) if enriched else [])
        w.writeheader()
        for r in enriched:
            w.writerow(r)

    dup_csv = os.path.join(OUT_DIR, 'drive_census_duplicates.csv')
    with open(dup_csv, 'w', newline='') as f:
        w = csv.writer(f)
        w.writerow(['proj_id', 'n_folders', 'customer_in_projects', 'customer_in_legacy', 'folder_id', 'folder_name', 'parents', 'drive_id', 'created', 'linked_in_project_folders'])
        for pid in sorted(duplicates.keys()):
            recs = duplicates[pid]
            cust_p = proj_name.get(pid, '')
            cust_l = legacy_name.get(pid, '')
            for r in recs:
                w.writerow([pid, len(recs), cust_p, cust_l, r['folder_id'], r['folder_name'], r['parents'], r['drive_id'], r['created'], r['linked_in_project_folders']])

    miss_csv = os.path.join(OUT_DIR, 'drive_census_missing.csv')
    with open(miss_csv, 'w', newline='') as f:
        w = csv.writer(f)
        w.writerow(['proj_id', 'in_projects', 'in_legacy_projects', 'customer'])
        for pid in missing:
            in_p = pid in {r['id'] for r in projects}
            in_l = pid in {r['id'] for r in legacy_projects}
            cust = proj_name.get(pid) or legacy_name.get(pid) or ''
            w.writerow([pid, in_p, in_l, cust])

    orph_csv = os.path.join(OUT_DIR, 'drive_census_orphans.csv')
    with open(orph_csv, 'w', newline='') as f:
        w = csv.DictWriter(f, fieldnames=list(orphans[0].keys()) if orphans else [])
        w.writeheader()
        for r in orphans:
            w.writerow(r)

    # Summary
    summary_path = os.path.join(OUT_DIR, 'drive_census_summary.txt')
    elapsed = (datetime.now(timezone.utc) - started).total_seconds()
    with open(summary_path, 'w') as f:
        f.write(f'Drive census — {datetime.now(timezone.utc).isoformat()}\n')
        f.write(f'Elapsed: {elapsed:.1f}s\n\n')
        f.write(f'Drive folders matching name~"PROJ-": {len(folders)}\n')
        f.write(f'  malformed (no PROJ-#### parse):      {len(malformed)}\n')
        f.write(f'  unique PROJ-IDs found in Drive:      {len(by_proj)}\n')
        f.write(f'  PROJ-IDs with duplicates (>1 folder): {len(duplicates)}\n')
        if duplicates:
            most = sorted(duplicates.items(), key=lambda kv: -len(kv[1]))[:10]
            f.write(f'  top dup counts:\n')
            for pid, recs in most:
                f.write(f'    {pid}: {len(recs)} folders\n')
        f.write(f'\nSupabase rows:\n')
        f.write(f'  project_folders: {len(project_folders)}\n')
        f.write(f'  projects:        {len(projects)}\n')
        f.write(f'  legacy_projects: {len(legacy_projects)}\n')
        f.write(f'  total unique project_ids: {len(all_proj_ids)}\n')
        f.write(f'\nReconciliation:\n')
        f.write(f'  project rows with NO Drive folder:      {len(missing)}\n')
        f.write(f'  Drive folders NOT linked in project_folders: {len(orphans)}\n')
        f.write(f'\nOutputs:\n')
        f.write(f'  {folders_csv}\n')
        f.write(f'  {dup_csv}\n')
        f.write(f'  {miss_csv}\n')
        f.write(f'  {orph_csv}\n')

    # Console summary
    with open(summary_path) as f:
        print(f.read())


if __name__ == '__main__':
    main()
