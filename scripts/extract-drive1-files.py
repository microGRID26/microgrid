#!/usr/bin/env python3
"""
Extract project files from BluDocs Drive 1 scan into a flat JSON
ready for upload to Supabase project_files table.

Walks the nested tree, extracts PROJ-XXXXX from folder names,
flattens all files with their parent folder context.

Usage:
  python3 scripts/extract-drive1-files.py
"""

import json
import re
import sys
from datetime import datetime, timezone

INPUT = "/Users/gregkelsch/Downloads/bludocs_inventory/netsuite_data_1_inventory.json"
OUTPUT_FILES = "/Users/gregkelsch/Downloads/bludocs_inventory/drive1_project_files.json"
OUTPUT_FOLDERS = "/Users/gregkelsch/Downloads/bludocs_inventory/drive1_project_folders.json"

PROJ_RE = re.compile(r'(PROJ-\d+)')

def extract_files(node, project_id=None, folder_name=None, depth=0):
    """Recursively walk tree, yield file records."""
    name = node.get('name', '')
    ntype = node.get('type', '')
    
    # Check if this folder IS a project folder
    m = PROJ_RE.search(name)
    if m and ntype == 'folder':
        project_id = m.group(1)
        folder_name = None  # reset — we're at project root
    
    if ntype == 'file' and project_id:
        yield {
            'project_id': project_id,
            'folder_name': folder_name or 'Root',
            'file_name': name,
            'file_id': node.get('id', ''),
            'file_url': f"https://drive.google.com/file/d/{node.get('id', '')}/view" if node.get('id') else None,
            'mime_type': node.get('mime_type', node.get('mime', None)),
            'file_size': node.get('size', None),
            'synced_at': datetime.now(timezone.utc).isoformat(),
        }
    
    for child in node.get('children', []):
        # If we're inside a project, track the immediate subfolder name
        child_folder = folder_name
        if project_id and ntype == 'folder' and depth > 0:
            # Use the current node's name as folder context if we're a subfolder of the project
            if PROJ_RE.search(name):
                child_folder = child.get('name', '') if child.get('type') == 'folder' else folder_name
            elif folder_name is None:
                child_folder = name
        
        yield from extract_files(child, project_id, child_folder, depth + 1)

def extract_project_folders(node):
    """Find all PROJ-XXXXX folders and yield (project_id, folder_id, folder_url)."""
    name = node.get('name', '')
    ntype = node.get('type', '')
    
    m = PROJ_RE.search(name)
    if m and ntype == 'folder':
        pid = m.group(1)
        fid = node.get('id', '')
        yield {
            'project_id': pid,
            'folder_id': fid,
            'folder_url': f"https://drive.google.com/drive/folders/{fid}" if fid else None,
            'source': 'drive1',
        }
    
    for child in node.get('children', []):
        yield from extract_project_folders(child)

def main():
    print(f"Loading {INPUT}...")
    with open(INPUT) as f:
        data = json.load(f)
    
    tree = data['tree']
    
    # Extract files
    print("Extracting files...")
    files = list(extract_files(tree))
    
    # Deduplicate by (project_id, file_id)
    seen = set()
    unique_files = []
    for f in files:
        key = (f['project_id'], f['file_id'])
        if key not in seen:
            seen.add(key)
            unique_files.append(f)
    
    project_ids = set(f['project_id'] for f in unique_files)
    
    print(f"  Files: {len(unique_files):,} (from {len(files):,} raw)")
    print(f"  Projects with files: {len(project_ids):,}")
    
    # Extract project folders
    print("Extracting project folders...")
    folders = list(extract_project_folders(tree))
    folder_pids = set(f['project_id'] for f in folders)
    print(f"  Project folders: {len(folders):,} ({len(folder_pids):,} unique projects)")
    
    # Stats
    print(f"\nFile type breakdown:")
    by_ext = {}
    for f in unique_files:
        ext = f['file_name'].rsplit('.', 1)[-1].lower() if '.' in f['file_name'] else '(none)'
        by_ext[ext] = by_ext.get(ext, 0) + 1
    for ext, count in sorted(by_ext.items(), key=lambda x: -x[1])[:10]:
        print(f"  .{ext}: {count:,}")
    
    # Save
    print(f"\nSaving files to {OUTPUT_FILES}...")
    with open(OUTPUT_FILES, 'w') as f:
        json.dump(unique_files, f)
    print(f"Saving folders to {OUTPUT_FOLDERS}...")
    with open(OUTPUT_FOLDERS, 'w') as f:
        json.dump(folders, f)
    
    print(f"\nDone! Ready for upload.")

if __name__ == '__main__':
    main()
