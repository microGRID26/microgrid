#!/usr/bin/env python3
"""
List all Google Shared Drives the OAuth user has access to, with item counts
where available. Used to find BluDocs overflow drives.

Usage:
  python3 scripts/list-shared-drives.py
"""

import os
import pickle

from google.auth.transport.requests import Request
from googleapiclient.discovery import build

TOKEN_FILE = os.path.expanduser('~/gdrive_token_write.pkl')  # write scope, broader access


def main():
    with open(TOKEN_FILE, 'rb') as f:
        creds = pickle.load(f)
    if creds.expired and creds.refresh_token:
        creds.refresh(Request())

    service = build('drive', 'v3', credentials=creds, cache_discovery=False)

    drives = []
    page_token = None
    while True:
        resp = service.drives().list(
            pageSize=100,
            pageToken=page_token,
            fields='nextPageToken, drives(id, name, createdTime, capabilities, restrictions)',
        ).execute()
        drives.extend(resp.get('drives', []))
        page_token = resp.get('nextPageToken')
        if not page_token:
            break

    print(f'Found {len(drives)} Shared Drives accessible to this account:\n')

    bludocs = []
    other = []
    for d in drives:
        name = d['name']
        if 'bludoc' in name.lower() or 'blu doc' in name.lower():
            bludocs.append(d)
        else:
            other.append(d)

    if bludocs:
        print('=== BluDocs-related Shared Drives ===')
        for d in bludocs:
            print(f"  {d['name']}")
            print(f"    ID:       {d['id']}")
            print(f"    Created:  {d.get('createdTime', '')}")
        print()

    print('=== Other Shared Drives ===')
    for d in other:
        print(f"  {d['name']:50}  {d['id']}")


if __name__ == '__main__':
    main()
