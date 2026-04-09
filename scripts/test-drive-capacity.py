#!/usr/bin/env python3
"""
Test capacity of the BluDocs Shared Drives by attempting to create + delete a
test folder in each. Reports which drives still have room.
"""
import os, pickle
from google.auth.transport.requests import Request
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

with open(os.path.expanduser('~/gdrive_token_write.pkl'), 'rb') as f:
    creds = pickle.load(f)
if creds.expired:
    creds.refresh(Request())
service = build('drive', 'v3', credentials=creds, cache_discovery=False)

DRIVES = [
    ('Bludocs 2025-2026',   '0AHw_qbL-LEGLUk9PVA'),
    ('Bludocs 2025-2026-2', '0ABdNGVimHZ-6Uk9PVA'),
]

for name, drive_id in DRIVES:
    print(f'Testing {name} ({drive_id})...')
    try:
        body = {
            'name': '_capacity_test_atlas_DELETE_ME',
            'mimeType': 'application/vnd.google-apps.folder',
            'parents': [drive_id],
        }
        created = service.files().create(
            body=body,
            fields='id',
            supportsAllDrives=True,
        ).execute()
        # Clean up immediately
        service.files().delete(fileId=created['id'], supportsAllDrives=True).execute()
        print(f'  ✅ HAS CAPACITY')
    except HttpError as e:
        if 'teamDriveFileLimitExceeded' in str(e):
            print(f'  ❌ FULL')
        else:
            print(f'  ⚠️  Error: {e}')
    print()
