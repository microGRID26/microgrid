#!/usr/bin/env python3
"""
Upload ALL project files from Seagate NETSUITE DATA backup to Google Drive.

Automatically creates shared drives as needed (350K item limit per drive).
Splits by vendor — each vendor stays on one drive.

Usage:
  python3 scripts/seagate-to-gdrive.py --dry-run           # preview: count items per vendor, show drive plan
  python3 scripts/seagate-to-gdrive.py                      # upload everything
  python3 scripts/seagate-to-gdrive.py --limit 5            # upload first 5 vendors
  python3 scripts/seagate-to-gdrive.py --vendor "VEN-745"   # upload one vendor

Requires:
  pip install google-api-python-client google-auth google-auth-oauthlib
"""

import argparse
import json
import os
import pickle
import re
import sys
import time
import warnings
from pathlib import Path

warnings.filterwarnings('ignore')

from google.auth.transport.requests import Request
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload
from googleapiclient.errors import HttpError

# ── CONFIG ────────────────────────────────────────────────────────────────────
SEAGATE_ROOT = "/Volumes/SEAGATE_ARCHIVE15TB/bludocs/NETSUITE DATA"
SCOPES = ["https://www.googleapis.com/auth/drive"]
TOKEN_FILE = os.path.expanduser("~/gdrive_token_write.pkl")
CLIENT_SECRET = os.path.expanduser(
    "~/Downloads/client_secret_628637774830-62uncp0jg51gq2ln17dvovgs18ac39cl.apps.googleusercontent.com.json"
)

PROGRESS_FILE = os.path.expanduser("~/Downloads/bludocs_inventory/seagate_upload_progress.json")

PROJ_RE = re.compile(r"(PROJ-\d+)")

# Upload to My Drive under a "BluDocs Archive" folder
# Set to None to auto-create, or paste a folder ID to resume
DEST_FOLDER_ID = None
DEST_FOLDER_NAME = "BluDocs Archive"


# ── AUTH ──────────────────────────────────────────────────────────────────────
def get_creds():
    creds = None
    if os.path.exists(TOKEN_FILE):
        with open(TOKEN_FILE, "rb") as f:
            creds = pickle.load(f)
    if creds and creds.expired and creds.refresh_token:
        try:
            creds.refresh(Request())
        except Exception:
            creds = None
    if not creds or not creds.valid:
        flow = InstalledAppFlow.from_client_secrets_file(CLIENT_SECRET, SCOPES)
        creds = flow.run_local_server(port=0)
        with open(TOKEN_FILE, "wb") as f:
            pickle.dump(creds, f)
    return creds


# ── GOOGLE DRIVE HELPERS ─────────────────────────────────────────────────────
def get_or_create_dest_folder(service):
    """Get or create the BluDocs Archive folder in My Drive."""
    global DEST_FOLDER_ID
    if DEST_FOLDER_ID:
        return DEST_FOLDER_ID

    # Search for existing folder
    q = f"name = '{DEST_FOLDER_NAME}' and 'root' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false"
    results = service.files().list(q=q, fields="files(id, name)", pageSize=1).execute()
    files = results.get("files", [])
    if files:
        DEST_FOLDER_ID = files[0]["id"]
        print(f"  Found existing folder: {DEST_FOLDER_NAME} ({DEST_FOLDER_ID})", flush=True)
        return DEST_FOLDER_ID

    # Create it
    metadata = {
        "name": DEST_FOLDER_NAME,
        "mimeType": "application/vnd.google-apps.folder",
    }
    folder = service.files().create(body=metadata, fields="id").execute()
    DEST_FOLDER_ID = folder["id"]
    print(f"  Created folder: {DEST_FOLDER_NAME} ({DEST_FOLDER_ID})", flush=True)
    return DEST_FOLDER_ID


def find_or_create_folder(service, name, parent_id, retries=5):
    """Find a folder by name under parent, or create it."""
    # Escape single quotes in folder names
    escaped_name = name.replace("'", "\\'")
    q = (
        f"name = '{escaped_name}' and '{parent_id}' in parents "
        f"and mimeType = 'application/vnd.google-apps.folder' and trashed = false"
    )
    for attempt in range(retries):
        try:
            results = service.files().list(
                q=q, fields="files(id)", supportsAllDrives=True,
                includeItemsFromAllDrives=True, pageSize=1,
            ).execute()
            files = results.get("files", [])
            if files:
                return files[0]["id"]

            metadata = {
                "name": name,
                "mimeType": "application/vnd.google-apps.folder",
                "parents": [parent_id],
            }
            folder = service.files().create(
                body=metadata, fields="id", supportsAllDrives=True,
            ).execute()
            return folder["id"]
        except (HttpError, TimeoutError, OSError, ConnectionError) as e:
            wait = min(2 ** (attempt + 1), 30)
            print(f"      Retry {attempt+1}/{retries} folder '{name}': {e} (wait {wait}s)", flush=True)
            if attempt < retries - 1:
                time.sleep(wait)
            else:
                raise


def upload_file(service, local_path, parent_id, filename, retries=5):
    """Upload a file. Skip if already exists."""
    escaped = filename.replace("'", "\\'")
    q = f"name = '{escaped}' and '{parent_id}' in parents and trashed = false"

    for attempt in range(retries):
        try:
            results = service.files().list(
                q=q, fields="files(id)", supportsAllDrives=True,
                includeItemsFromAllDrives=True, pageSize=1,
            ).execute()
            if results.get("files"):
                return "skipped"

            metadata = {"name": filename, "parents": [parent_id]}
            media = MediaFileUpload(local_path, resumable=True)
            service.files().create(
                body=metadata, media_body=media, fields="id",
                supportsAllDrives=True,
            ).execute()
            return "uploaded"
        except HttpError as e:
            if e.resp.status == 403 and "storageQuotaExceeded" in str(e):
                return "quota_exceeded"
            if attempt < retries - 1:
                time.sleep(2 ** attempt)
            else:
                print(f"      ERROR uploading {filename}: {e}", flush=True)
                return "error"
        except (TimeoutError, OSError, ConnectionError) as e:
            wait = min(2 ** (attempt + 1), 30)
            print(f"      Retry {attempt+1}/{retries} '{filename}': {e} (wait {wait}s)", flush=True)
            if attempt < retries - 1:
                time.sleep(wait)
            else:
                print(f"      ERROR uploading {filename}: {e}", flush=True)
                return "error"
        except Exception as e:
            print(f"      ERROR uploading {filename}: {e}", flush=True)
            return "error"


# ── DISCOVER & COUNT ─────────────────────────────────────────────────────────
def discover_vendors(root):
    """List all vendor folders with their item counts."""
    vendors = []
    root_path = Path(root)

    for vendor_dir in sorted(root_path.iterdir()):
        if not vendor_dir.is_dir() or vendor_dir.name.startswith("."):
            continue

        # Count all items (files + folders) recursively
        file_count = 0
        folder_count = 0
        project_count = 0

        for dirpath, dirnames, filenames in os.walk(str(vendor_dir)):
            dirnames[:] = [d for d in dirnames if not d.startswith(".")]
            folder_count += len(dirnames)
            file_count += len([f for f in filenames if not f.startswith(".")])

            # Count projects at depth 2 (vendor/year/project)
            rel = Path(dirpath).relative_to(vendor_dir)
            if len(rel.parts) == 1:  # year level
                for d in dirnames:
                    if PROJ_RE.search(d):
                        project_count += 1

        vendors.append({
            "name": vendor_dir.name,
            "path": str(vendor_dir),
            "files": file_count,
            "folders": folder_count,
            "items": file_count + folder_count,
            "projects": project_count,
        })

    return vendors


# ── UPLOAD ───────────────────────────────────────────────────────────────────
def upload_vendor(service, vendor, drive_id):
    """Upload all files for a vendor to the specified shared drive."""
    vendor_path = Path(vendor["path"])
    uploaded = 0
    skipped = 0
    errors = 0
    items_created = 0

    # Create vendor folder on drive
    vendor_folder_id = find_or_create_folder(service, vendor["name"], drive_id)
    items_created += 1

    for dirpath, dirnames, filenames in os.walk(str(vendor_path)):
        dirnames[:] = sorted([d for d in dirnames if not d.startswith(".")])
        filenames = [f for f in filenames if not f.startswith(".")]

        if not filenames and not dirnames:
            continue

        # Build folder path on Drive
        rel = Path(dirpath).relative_to(vendor_path)
        current_parent = vendor_folder_id
        for part in rel.parts:
            current_parent = find_or_create_folder(service, part, current_parent)
            items_created += 1

        # Upload files
        for filename in filenames:
            local_file = os.path.join(dirpath, filename)
            result = upload_file(service, local_file, current_parent, filename)
            if result == "uploaded":
                uploaded += 1
                items_created += 1
            elif result == "skipped":
                skipped += 1
            elif result == "quota_exceeded":
                print(f"    QUOTA EXCEEDED — stopping vendor", flush=True)
                return {"uploaded": uploaded, "skipped": skipped, "errors": errors, "items": items_created, "quota_hit": True}
            else:
                errors += 1

            # Rate limit
            if (uploaded + skipped) % 50 == 0:
                time.sleep(0.1)

    return {"uploaded": uploaded, "skipped": skipped, "errors": errors, "items": items_created, "quota_hit": False}


# ── MAIN ─────────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description="Upload Seagate BluDocs to Google Drive")
    parser.add_argument("--dry-run", action="store_true", help="Preview only")
    parser.add_argument("--limit", type=int, help="Max vendors to process")
    parser.add_argument("--vendor", type=str, help="Single vendor (e.g., VEN-745)")
    args = parser.parse_args()

    if not os.path.exists(SEAGATE_ROOT):
        print(f"ERROR: Seagate not found at {SEAGATE_ROOT}")
        sys.exit(1)

    # Discover vendors
    print("Scanning Seagate backup...", flush=True)
    vendors = discover_vendors(SEAGATE_ROOT)
    total_items = sum(v["items"] for v in vendors)
    total_projects = sum(v["projects"] for v in vendors)
    print(f"  {len(vendors)} vendors, {total_projects:,} projects, {total_items:,} items\n", flush=True)

    if args.vendor:
        vendors = [v for v in vendors if args.vendor in v["name"]]
        if not vendors:
            print(f"Vendor {args.vendor} not found")
            sys.exit(1)

    if args.dry_run:
        print(f"\n[DRY RUN] Would upload {total_items:,} items to My Drive / {DEST_FOLDER_NAME}")
        print("No changes made.")
        return

    # Auth
    print("\nAuthenticating with Google Drive (write access)...", flush=True)
    creds = get_creds()
    service = build("drive", "v3", credentials=creds)
    print("  Authenticated!\n", flush=True)

    # Get or create destination folder in My Drive
    dest_id = get_or_create_dest_folder(service)
    print(f"  Destination: My Drive / {DEST_FOLDER_NAME} ({dest_id})\n", flush=True)

    # Load progress
    done_vendors = set()
    if os.path.exists(PROGRESS_FILE):
        with open(PROGRESS_FILE) as f:
            progress = json.load(f)
        done_vendors = set(progress.get("done_vendors", []))
        print(f"Resuming: {len(done_vendors)} vendors already done\n", flush=True)

    # Filter out done vendors
    remaining = [v for v in vendors if v["name"] not in done_vendors]
    if args.limit:
        remaining = remaining[:args.limit]

    print(f"Vendors to upload: {len(remaining)}\n", flush=True)

    grand_uploaded = 0
    grand_skipped = 0
    grand_errors = 0
    start = time.time()

    for vi, vendor in enumerate(remaining):
        print(f"\n  [{vi+1}/{len(remaining)}] {vendor['name']} — {vendor['projects']} projects, {vendor['items']:,} items", flush=True)

        result = upload_vendor(service, vendor, dest_id)
        grand_uploaded += result["uploaded"]
        grand_skipped += result["skipped"]
        grand_errors += result["errors"]

        print(f"    Done: {result['uploaded']} uploaded, {result['skipped']} skipped, {result['errors']} errors", flush=True)

        done_vendors.add(vendor["name"])

        # Save progress
        os.makedirs(os.path.dirname(PROGRESS_FILE), exist_ok=True)
        with open(PROGRESS_FILE, "w") as f:
            json.dump({"done_vendors": list(done_vendors)}, f)

        elapsed = time.time() - start
        rate = (vi + 1) / elapsed * 60 if elapsed > 0 else 0
        eta = (len(remaining) - vi - 1) / (rate / 60) / 60 if rate > 0 else 0
        print(f"    Total: {grand_uploaded:,} uploaded | {grand_skipped:,} skipped | {grand_errors} errors | {elapsed/60:.0f}min | ETA: {eta:.0f}min", flush=True)

    elapsed = time.time() - start
    print(f"\n{'='*60}", flush=True)
    print(f"COMPLETE in {elapsed/60:.0f} minutes", flush=True)
    print(f"Uploaded:  {grand_uploaded:,}", flush=True)
    print(f"Skipped:   {grand_skipped:,}", flush=True)
    print(f"Errors:    {grand_errors}", flush=True)


if __name__ == "__main__":
    main()
