#!/usr/bin/env python3
"""
List files inside project folders using Google Drive API.
Uses folder IDs from project_folders table in Supabase.
Outputs JSON ready for upload to project_files table.

Usage:
  python3 scripts/list-drive-files.py                    # list all projects
  python3 scripts/list-drive-files.py --limit 50         # first 50
  python3 scripts/list-drive-files.py --active-only      # only active CRM projects
  python3 scripts/list-drive-files.py --project PROJ-25869  # single project

Requires:
  pip install google-api-python-client google-auth google-auth-oauthlib
  A client_secret JSON file (will prompt for browser auth on first run)
"""

import argparse
import json
import os
import pickle
import sys
import time
from datetime import datetime, timezone

# Google API
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build

# Supabase
import requests as req

SCOPES = ['https://www.googleapis.com/auth/drive.readonly']
TOKEN_FILE = os.path.expanduser('~/gdrive_token_readonly.pkl')
CLIENT_SECRET = os.path.expanduser('~/Downloads/client_secret_628637774830-62uncp0jg51gq2ln17dvovgs18ac39cl.apps.googleusercontent.com.json')

OUTPUT_DIR = os.path.expanduser('~/Downloads/bludocs_inventory')

def get_creds():
    creds = None
    if os.path.exists(TOKEN_FILE):
        with open(TOKEN_FILE, 'rb') as f:
            creds = pickle.load(f)
    if creds and creds.expired and creds.refresh_token:
        try:
            creds.refresh(Request())
        except Exception:
            creds = None
    if not creds or not creds.valid:
        flow = InstalledAppFlow.from_client_secrets_file(CLIENT_SECRET, SCOPES)
        creds = flow.run_local_server(port=0)
        with open(TOKEN_FILE, 'wb') as f:
            pickle.dump(creds, f)
    return creds

def list_files_in_folder(service, folder_id, folder_name='Root', max_depth=3, depth=0):
    """Recursively list all files in a Drive folder."""
    files = []
    page_token = None
    
    while True:
        try:
            results = service.files().list(
                q=f"'{folder_id}' in parents and trashed = false",
                fields="nextPageToken, files(id, name, mimeType, size, createdTime, modifiedTime)",
                pageSize=1000,
                pageToken=page_token,
                supportsAllDrives=True,
                includeItemsFromAllDrives=True,
            ).execute()
        except Exception as e:
            print(f"    ERROR listing {folder_id}: {e}")
            break
        
        for item in results.get('files', []):
            if item['mimeType'] == 'application/vnd.google-apps.folder':
                if depth < max_depth:
                    subfolder_name = item['name']
                    files.extend(list_files_in_folder(
                        service, item['id'], subfolder_name, max_depth, depth + 1
                    ))
            else:
                files.append({
                    'folder_name': folder_name,
                    'file_name': item['name'],
                    'file_id': item['id'],
                    'file_url': f"https://drive.google.com/file/d/{item['id']}/view",
                    'mime_type': item.get('mimeType'),
                    'file_size': int(item['size']) if item.get('size') else None,
                    'created_at': item.get('createdTime'),
                    'updated_at': item.get('modifiedTime'),
                })
        
        page_token = results.get('nextPageToken')
        if not page_token:
            break
    
    return files

def load_project_folders_from_supabase(active_only=False, project_id=None, limit=None):
    """Load project folder IDs from Supabase."""
    url = os.environ.get('NEXT_PUBLIC_SUPABASE_URL')
    key = os.environ.get('SUPABASE_SERVICE_ROLE_KEY') or os.environ.get('NEXT_PUBLIC_SUPABASE_ANON_KEY')
    if not url or not key:
        print("ERROR: Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY")
        sys.exit(1)
    
    headers = {
        'apikey': key,
        'Authorization': f'Bearer {key}',
    }
    
    if project_id:
        resp = req.get(
            f"{url}/rest/v1/project_folders?project_id=eq.{project_id}&select=project_id,folder_url",
            headers=headers,
        )
    elif active_only:
        # Get active project IDs first
        resp = req.get(
            f"{url}/rest/v1/projects?select=id&disposition=not.eq.Cancelled&disposition=not.eq.In+Service&limit=2000",
            headers=headers,
        )
        active_ids = set(r['id'] for r in resp.json())
        
        resp = req.get(
            f"{url}/rest/v1/project_folders?select=project_id,folder_url&limit=50000",
            headers=headers,
        )
        all_folders = resp.json()
        return [f for f in all_folders if f['project_id'] in active_ids][:limit]
    else:
        lim = limit or 50000
        resp = req.get(
            f"{url}/rest/v1/project_folders?select=project_id,folder_url&limit={lim}",
            headers=headers,
        )
    
    folders = resp.json()
    if limit:
        folders = folders[:limit]
    return folders

def extract_folder_id(folder_url):
    """Extract Google Drive folder ID from URL."""
    if not folder_url:
        return None
    # Handle both formats
    if '/folders/' in folder_url:
        return folder_url.split('/folders/')[-1].split('?')[0].split('/')[0]
    return None

def main():
    parser = argparse.ArgumentParser(description='List files in Google Drive project folders')
    parser.add_argument('--limit', type=int, help='Max number of projects to process')
    parser.add_argument('--active-only', action='store_true', help='Only active CRM projects')
    parser.add_argument('--project', type=str, help='Single project ID (e.g., PROJ-25869)')
    parser.add_argument('--output', type=str, help='Output JSON path')
    args = parser.parse_args()
    
    # Get Google credentials
    print("Authenticating with Google Drive...")
    creds = get_creds()
    service = build('drive', 'v3', credentials=creds)
    print("  Authenticated!\n")
    
    # Load project folders
    print("Loading project folders from Supabase...")
    folders = load_project_folders_from_supabase(
        active_only=args.active_only,
        project_id=args.project,
        limit=args.limit,
    )
    print(f"  Found {len(folders)} project folders to scan.\n")
    
    if not folders:
        print("No folders found.")
        return
    
    # Process each project
    all_files = []
    now = datetime.now(timezone.utc).isoformat()
    errors = 0
    
    for i, folder in enumerate(folders):
        pid = folder['project_id']
        fid = extract_folder_id(folder.get('folder_url'))
        
        if not fid:
            errors += 1
            continue
        
        files = list_files_in_folder(service, fid)
        
        for f in files:
            f['project_id'] = pid
            f['synced_at'] = now
        
        all_files.extend(files)
        
        if (i + 1) % 10 == 0 or i + 1 == len(folders):
            print(f"  [{i+1}/{len(folders)}] {pid}: {len(files)} files (total: {len(all_files):,})")
        
        # Gentle rate limiting
        time.sleep(0.1)
    
    # Save output
    output_path = args.output or os.path.join(OUTPUT_DIR, 'project_files_from_api.json')
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    
    with open(output_path, 'w') as f:
        json.dump(all_files, f)
    
    print(f"\n=== Done ===")
    print(f"Projects scanned: {len(folders)}")
    print(f"Files found: {len(all_files):,}")
    print(f"Errors: {errors}")
    print(f"Output: {output_path}")
    print(f"\nUpload with: npx tsx scripts/upload-drive-files.ts {output_path}")

if __name__ == '__main__':
    main()
