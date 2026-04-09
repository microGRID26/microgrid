#!/usr/bin/env python3
"""Check which Shared Drive a folder lives in. Walks parent chain to root."""
import os, pickle, sys
from google.auth.transport.requests import Request
from googleapiclient.discovery import build

with open(os.path.expanduser('~/gdrive_token_write.pkl'), 'rb') as f:
    creds = pickle.load(f)
if creds.expired:
    creds.refresh(Request())
service = build('drive', 'v3', credentials=creds, cache_discovery=False)

# 3 sample folders: 1 failed, 2 unknown (one of each from late in upload run)
SAMPLES = [
    ('PROJ-29846 (failed)',    '1K6_hgxjLwPxxHRIAtEjmfNOZVH1LGOaO'),
    ('PROJ-29631 (succeeded)', '1DANK4PH86DTIcJ0MkTK3CmceCveLPP3H'),
    ('PROJ-28443 (succeeded)', '120ysZUD5G5lL5mvcWJCyjm2vtmio1A6W'),
]

for label, folder_id in SAMPLES:
    try:
        meta = service.files().get(
            fileId=folder_id,
            fields='id, name, driveId, parents',
            supportsAllDrives=True,
        ).execute()
        drive_id = meta.get('driveId', '(My Drive — no Shared Drive)')
        # Resolve drive name
        drive_name = ''
        if meta.get('driveId'):
            try:
                d = service.drives().get(driveId=drive_id, fields='name').execute()
                drive_name = d.get('name', '')
            except Exception as e:
                drive_name = f'(error: {e})'
        print(f'{label}')
        print(f'  Folder name: {meta.get("name")}')
        print(f'  Drive ID:    {drive_id}')
        print(f'  Drive name:  {drive_name}')
        print()
    except Exception as e:
        print(f'{label} → ERROR: {e}\n')
