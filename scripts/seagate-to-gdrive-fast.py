#!/usr/bin/env python3
"""
Fast version of seagate-to-gdrive.py — parallel uploads + skip missing files immediately.

Changes from v1:
  1. FileNotFoundError skips immediately (no retry) — saves 60+ sec per missing file
  2. ThreadPoolExecutor for 10 concurrent uploads within each vendor
  3. Batch folder creation cached in memory (no duplicate lookups)
  4. Compatible with existing progress file — resumes where v1 left off

Usage:
  python3 scripts/seagate-to-gdrive-fast.py                      # resume from progress
  python3 scripts/seagate-to-gdrive-fast.py --vendor "VEN-453"   # just Vivint
  python3 scripts/seagate-to-gdrive-fast.py --workers 15          # more parallelism
"""

import argparse
import json
import os
import pickle
import re
import ssl
import sys
import threading
import time
import warnings
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from threading import Lock

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
DEST_FOLDER_ID = None
DEST_FOLDER_NAME = "BluDocs Archive"

# Thread-safe counters
print_lock = Lock()
counter_lock = Lock()

# Thread-local storage for per-thread Drive service instances
# httplib2 is NOT thread-safe — sharing a single service across threads causes
# SSL corruption (WRONG_VERSION_NUMBER, DECRYPTION_FAILED, BAD_RECORD_MAC).
_thread_local = threading.local()
_shared_creds = None


def get_thread_service():
    """Return a Drive service instance local to the current thread."""
    if not hasattr(_thread_local, "service"):
        _thread_local.service = build("drive", "v3", credentials=_shared_creds)
    return _thread_local.service


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
    global DEST_FOLDER_ID
    if DEST_FOLDER_ID:
        return DEST_FOLDER_ID

    q = f"name = '{DEST_FOLDER_NAME}' and 'root' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false"
    results = service.files().list(q=q, fields="files(id, name)", pageSize=1).execute()
    files = results.get("files", [])
    if files:
        DEST_FOLDER_ID = files[0]["id"]
        print(f"  Found existing folder: {DEST_FOLDER_NAME} ({DEST_FOLDER_ID})", flush=True)
        return DEST_FOLDER_ID

    metadata = {"name": DEST_FOLDER_NAME, "mimeType": "application/vnd.google-apps.folder"}
    folder = service.files().create(body=metadata, fields="id").execute()
    DEST_FOLDER_ID = folder["id"]
    print(f"  Created folder: {DEST_FOLDER_NAME} ({DEST_FOLDER_ID})", flush=True)
    return DEST_FOLDER_ID


def find_or_create_folder(service, name, parent_id, retries=5):
    """Find or create a folder. Uses provided service (caller decides thread safety)."""
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
            with print_lock:
                print(f"      Retry {attempt+1}/{retries} folder '{name}': {e} (wait {wait}s)", flush=True)
            if attempt < retries - 1:
                time.sleep(wait)
            else:
                raise


def upload_file(local_path, parent_id, filename, retries=5):
    """Upload a file using a thread-local Drive service. Skip if file missing."""
    service = get_thread_service()

    if not os.path.exists(local_path):
        with print_lock:
            print(f"      SKIP (missing): {filename}", flush=True)
        return "error"

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
                with print_lock:
                    print(f"      ERROR uploading {filename}: {e}", flush=True)
                return "error"
        except FileNotFoundError:
            with print_lock:
                print(f"      SKIP (missing): {filename}", flush=True)
            return "error"
        except (TimeoutError, OSError, ConnectionError, ssl.SSLError) as e:
            wait = min(2 ** (attempt + 1), 30)
            with print_lock:
                print(f"      Retry {attempt+1}/{retries} '{filename}': {e} (wait {wait}s)", flush=True)
            if attempt < retries - 1:
                # On SSL errors, force a fresh service for this thread
                if "SSL" in str(type(e).__name__) or "ssl" in str(e).lower():
                    _thread_local.service = build("drive", "v3", credentials=_shared_creds)
                    service = _thread_local.service
                time.sleep(wait)
            else:
                with print_lock:
                    print(f"      ERROR uploading {filename}: {e}", flush=True)
                return "error"
        except Exception as e:
            # Catch corrupted SSL garbage (sometimes raises generic Exception)
            err_str = str(e)
            if any(k in err_str.lower() for k in ["ssl", "decrypt", "cipher", "version"]):
                wait = min(2 ** (attempt + 1), 30)
                with print_lock:
                    print(f"      Retry {attempt+1}/{retries} '{filename}': SSL error (wait {wait}s)", flush=True)
                if attempt < retries - 1:
                    _thread_local.service = build("drive", "v3", credentials=_shared_creds)
                    service = _thread_local.service
                    time.sleep(wait)
                    continue
            with print_lock:
                print(f"      ERROR uploading {filename}: {e}", flush=True)
            return "error"


# ── DISCOVER ─────────────────────────────────────────────────────────────────
def discover_vendors(root):
    vendors = []
    root_path = Path(root)

    for vendor_dir in sorted(root_path.iterdir()):
        if not vendor_dir.is_dir() or vendor_dir.name.startswith("."):
            continue

        file_count = 0
        folder_count = 0
        project_count = 0

        for dirpath, dirnames, filenames in os.walk(str(vendor_dir)):
            dirnames[:] = [d for d in dirnames if not d.startswith(".")]
            folder_count += len(dirnames)
            file_count += len([f for f in filenames if not f.startswith(".")])
            rel = Path(dirpath).relative_to(vendor_dir)
            if len(rel.parts) == 1:
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


# ── UPLOAD (PARALLEL) ────────────────────────────────────────────────────────
def upload_vendor(service, vendor, drive_id, max_workers=10):
    """Upload all files for a vendor using parallel file uploads."""
    vendor_path = Path(vendor["path"])
    uploaded = 0
    skipped = 0
    errors = 0

    # Folder ID cache: relative_path -> drive folder id
    folder_cache = {}
    folder_cache_lock = Lock()

    def get_folder_id(rel_parts):
        """Get or create nested folder, using cache."""
        cache_key = "/".join(rel_parts)
        with folder_cache_lock:
            if cache_key in folder_cache:
                return folder_cache[cache_key]

        # Build path incrementally
        current = drive_id
        for i, part in enumerate(rel_parts):
            partial_key = "/".join(rel_parts[:i+1])
            with folder_cache_lock:
                if partial_key in folder_cache:
                    current = folder_cache[partial_key]
                    continue

            current = find_or_create_folder(service, part, current)
            with folder_cache_lock:
                folder_cache[partial_key] = current

        return current

    # Create vendor folder
    vendor_folder_id = find_or_create_folder(service, vendor["name"], drive_id)
    folder_cache[""] = vendor_folder_id

    # Collect all file upload jobs first
    jobs = []
    for dirpath, dirnames, filenames in os.walk(str(vendor_path)):
        dirnames[:] = sorted([d for d in dirnames if not d.startswith(".")])
        filenames = [f for f in filenames if not f.startswith(".")]
        if not filenames:
            continue

        rel = Path(dirpath).relative_to(vendor_path)
        rel_parts = [vendor["name"]] + list(rel.parts) if rel.parts else [vendor["name"]]

        # Pre-create folders (sequential — folder creation must be ordered)
        parent_id = get_folder_id(rel_parts)

        for filename in filenames:
            local_file = os.path.join(dirpath, filename)
            jobs.append((local_file, parent_id, filename))

    # Upload files in parallel
    total_jobs = len(jobs)
    completed = 0

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {
            executor.submit(upload_file, local, parent, name): (local, name)
            for local, parent, name in jobs
        }

        for future in as_completed(futures):
            result = future.result()
            with counter_lock:
                completed += 1
                if result == "uploaded":
                    uploaded += 1
                elif result == "skipped":
                    skipped += 1
                elif result == "quota_exceeded":
                    # Cancel remaining
                    for f in futures:
                        f.cancel()
                    return {"uploaded": uploaded, "skipped": skipped, "errors": errors, "quota_hit": True}
                else:
                    errors += 1

                # Progress every 500 files
                if completed % 500 == 0:
                    with print_lock:
                        print(f"      Progress: {completed:,}/{total_jobs:,} ({uploaded:,} up, {skipped:,} skip, {errors} err)", flush=True)

    return {"uploaded": uploaded, "skipped": skipped, "errors": errors, "quota_hit": False}


# ── MAIN ─────────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description="Upload Seagate BluDocs to Google Drive (fast)")
    parser.add_argument("--dry-run", action="store_true", help="Preview only")
    parser.add_argument("--limit", type=int, help="Max vendors to process")
    parser.add_argument("--vendor", type=str, help="Single vendor (e.g., VEN-453)")
    parser.add_argument("--workers", type=int, default=10, help="Parallel upload threads (default: 10)")
    args = parser.parse_args()

    if not os.path.exists(SEAGATE_ROOT):
        print(f"ERROR: Seagate not found at {SEAGATE_ROOT}")
        sys.exit(1)

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
        print(f"\n[DRY RUN] Would upload {total_items:,} items with {args.workers} workers")
        return

    global _shared_creds
    print(f"\nAuthenticating with Google Drive (write access)...", flush=True)
    creds = get_creds()
    _shared_creds = creds
    service = build("drive", "v3", credentials=creds)
    print("  Authenticated!\n", flush=True)

    dest_id = get_or_create_dest_folder(service)
    print(f"  Destination: My Drive / {DEST_FOLDER_NAME} ({dest_id})", flush=True)
    print(f"  Workers: {args.workers} parallel uploads\n", flush=True)

    # Load progress (compatible with v1)
    done_vendors = set()
    if os.path.exists(PROGRESS_FILE):
        with open(PROGRESS_FILE) as f:
            progress = json.load(f)
        done_vendors = set(progress.get("done_vendors", []))
        print(f"Resuming: {len(done_vendors)} vendors already done\n", flush=True)

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

        result = upload_vendor(service, vendor, dest_id, max_workers=args.workers)
        grand_uploaded += result["uploaded"]
        grand_skipped += result["skipped"]
        grand_errors += result["errors"]

        print(f"    Done: {result['uploaded']:,} uploaded, {result['skipped']:,} skipped, {result['errors']} errors", flush=True)

        if result.get("quota_hit"):
            print("\n  QUOTA EXCEEDED — stopping.", flush=True)
            break

        done_vendors.add(vendor["name"])

        os.makedirs(os.path.dirname(PROGRESS_FILE), exist_ok=True)
        with open(PROGRESS_FILE, "w") as f:
            json.dump({"done_vendors": list(done_vendors)}, f)

        elapsed = time.time() - start
        rate = (grand_uploaded + grand_skipped) / elapsed * 60 if elapsed > 0 else 0
        remaining_items = sum(v["items"] for v in remaining[vi+1:])
        eta = remaining_items / rate if rate > 0 else 0
        print(f"    Total: {grand_uploaded:,} uploaded | {grand_skipped:,} skipped | {grand_errors} errors | {elapsed/60:.0f}min | ~{rate:.0f} items/min | ETA: {eta:.0f}min", flush=True)

    elapsed = time.time() - start
    print(f"\n{'='*60}", flush=True)
    print(f"COMPLETE in {elapsed/60:.0f} minutes", flush=True)
    print(f"Uploaded:  {grand_uploaded:,}", flush=True)
    print(f"Skipped:   {grand_skipped:,}", flush=True)
    print(f"Errors:    {grand_errors}", flush=True)


if __name__ == "__main__":
    main()
