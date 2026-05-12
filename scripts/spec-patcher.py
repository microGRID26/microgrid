#!/usr/bin/env python3
"""Atomic JSON spec patcher for lib/sld-layouts/*.json.

Why: applying multi-element JSON patches via sequential text Edit calls drifts
indices after each remove/insert and corrupts JSON. This helper loads the spec
once, finds elements by CONTENT (not index), mutates in memory, dumps back as
one atomic write. Used by Atlas to apply patch rounds from the Claude Design
canvas during the /chain planset iteration loop.

Pattern (each patch round is one Python block):

    from scripts.spec_patcher import load_spec, save_spec, find_idx_by_text, \
        find_idx_by_asset, find_idx_by_line_label

    spec, elements = load_spec('lib/sld-layouts/rush-spatial.json')

    # text edit
    i = find_idx_by_text(elements, '(N) PROTECTED LOAD PANEL')
    elements[i]['text'] = '(N) BACKUP LOADS PANEL'

    # remove cluster (by anchor asset + count)
    i = find_idx_by_asset(elements, 'eaton-dg221urb', x=680, y=430)
    to_drop = set(range(i, i + 6))                # 6-element cluster
    elements = [e for j, e in enumerate(elements) if j not in to_drop]

    # insert new cluster after anchor text
    anchor = find_idx_by_text(elements, 'NEMA 3R · INDOOR/OUTDOOR')
    new = [
        {"type": "svg-asset", "assetId": "duracell-hybrid-inverter", ...},
        ...
    ]
    elements = elements[:anchor+1] + new + elements[anchor+1:]

    # move callout
    for i, e in enumerate(elements):
        if e.get('type') == 'callout' and e.get('number') == 12:
            e['cx'] = 740; e['cy'] = 410
            break

    save_spec('lib/sld-layouts/rush-spatial.json', spec, elements)

Run via:  cd <worktree> && python3 -c "<the patch block above>"

After the patch:  npx tsx scripts/render-duracell-sld.tsx > ~/.claude/tmp/duracell-pv5-r<N>.html
Then chrome-devtools MCP: navigate_page to file:// URL, take_screenshot fullPage=true
"""

from __future__ import annotations
import json
from typing import Any, Callable


def load_spec(path: str) -> tuple[dict, list]:
    """Load a JSON spec file. Returns (spec_dict, elements_list)."""
    with open(path) as f:
        spec = json.load(f)
    return spec, spec['elements']


def save_spec(path: str, spec: dict, elements: list) -> None:
    """Write the mutated spec back atomically (overwrite)."""
    spec['elements'] = elements
    with open(path, 'w') as f:
        json.dump(spec, f, indent=2, ensure_ascii=False)


def find_idx_by_text(elements: list, exact_text: str) -> int | None:
    """First element index whose type=='text' and text matches EXACTLY."""
    for i, e in enumerate(elements):
        if e.get('type') == 'text' and e.get('text') == exact_text:
            return i
    return None


def find_idx_by_text_contains(elements: list, substring: str) -> int | None:
    """First element index whose type=='text' and text CONTAINS substring."""
    for i, e in enumerate(elements):
        if e.get('type') == 'text' and substring in (e.get('text') or ''):
            return i
    return None


def find_idx_by_asset(elements: list, asset_id: str,
                      x: int | None = None, y: int | None = None) -> int | None:
    """First element index whose type=='svg-asset' and assetId matches.
    Optionally constrain by exact (x,y) position to disambiguate."""
    for i, e in enumerate(elements):
        if e.get('type') != 'svg-asset':
            continue
        if e.get('assetId') != asset_id:
            continue
        if x is not None and e.get('x') != x:
            continue
        if y is not None and e.get('y') != y:
            continue
        return i
    return None


def find_idx_by_line_label(elements: list, label_substr: str) -> int | None:
    """First element index whose type=='line' and label CONTAINS substring."""
    for i, e in enumerate(elements):
        if e.get('type') == 'line' and label_substr in (e.get('label') or ''):
            return i
    return None


def find_all(elements: list, predicate: Callable[[dict], bool]) -> list[int]:
    """All indices matching predicate. Useful for bulk text scans like
    `lambda e: e.get('type')=='text' and e.get('y')==124`."""
    return [i for i, e in enumerate(elements) if predicate(e)]


def section_bounds(spec: dict, label: str) -> dict | None:
    """Look up a section's {x, y, w, h} by its label string."""
    for s in spec.get('sections', []):
        if s.get('label') == label:
            return s
    return None


def list_sections(elements: list) -> list[tuple[int, str]]:
    """Index map of `_comment` section dividers in the elements array.
    Returns [(idx, label_text)] for navigation."""
    out = []
    for i, e in enumerate(elements):
        if '_' in e and 'type' not in e:
            out.append((i, e['_']))
    return out


def dump_section(elements: list, start_label_contains: str,
                 max_count: int = 100) -> list[tuple[int, str]]:
    """Pretty-print every element in a section for inspection.
    Returns [(idx, one-line description)]."""
    out = []
    in_section = False
    for i, e in enumerate(elements):
        if '_' in e and 'type' not in e:
            if start_label_contains in e['_']:
                in_section = True
                out.append((i, f'_COMMENT: {e["_"]}'))
                continue
            elif in_section:
                break
        if not in_section:
            continue
        t = e.get('type', '?')
        if t == 'svg-asset':
            desc = f'svg-asset:{e["assetId"]} @ ({e["x"]},{e["y"]}) {e["w"]}×{e["h"]}'
        elif t == 'text':
            desc = f'text @ ({e["x"]},{e["y"]}): "{(e.get("text") or "")[:60]}"'
        elif t == 'line':
            pts = e.get('points', [])
            desc = f'line color={e.get("color","?")} {len(pts)}pts label="{e.get("label","")[:50]}"'
        elif t == 'rect':
            desc = f'rect @ ({e["x"]},{e["y"]}) {e["w"]}×{e["h"]}'
        elif t == 'callout':
            desc = f'callout #{e["number"]} @ ({e["cx"]},{e["cy"]})'
        else:
            desc = f'{t}'
        out.append((i, desc))
        if len(out) >= max_count:
            out.append((-1, '...truncated'))
            break
    return out
