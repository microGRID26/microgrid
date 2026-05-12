#!/usr/bin/env python3
"""SLD collision validator — Phase 0 of sld-v2 refactor.

Parses a rendered SLD HTML/SVG file and reports text↔text and text↔geometry
bbox overlaps. Used as objective ground truth on every render during the v2
build (and as a regression gate post-v2).

Usage:
    python3 scripts/sld-collision-check.py <html-or-svg-path> [--mode text|all] [--json]

Exit codes:
    0 — no overlaps in selected mode
    1 — overlaps found
    2 — file unreadable / parse error

Text width approximation matches `lib/sld-layout.ts:estimateTextWidth`:
    width ≈ char_count × fontSize × 0.58   (Arial/Helvetica)
    height ≈ fontSize × 1.0                (cap-to-baseline ≈ fontSize)

textAnchor handling:
    start  → x is left edge        (default)
    middle → x is center
    end    → x is right edge

Transform handling: accumulates nested <g transform="translate(...) scale(...)">
through SVG ancestor chain.
"""
from __future__ import annotations
import argparse
import json
import re
import sys
import xml.etree.ElementTree as ET
from dataclasses import dataclass, asdict
from typing import Iterable

SVG_NS = '{http://www.w3.org/2000/svg}'

# Excerpt of SVG namespace handling: parse with ET, strip the namespace prefix
# on traversal so we can match plain element names.


@dataclass
class BBox:
    x: float
    y: float
    w: float
    h: float

    @property
    def x2(self) -> float:
        return self.x + self.w

    @property
    def y2(self) -> float:
        return self.y + self.h

    def overlaps(self, other: 'BBox', pad: float = 0.0) -> bool:
        return not (
            self.x2 <= other.x - pad
            or other.x2 <= self.x - pad
            or self.y2 <= other.y - pad
            or other.y2 <= self.y - pad
        )

    def overlap_area(self, other: 'BBox') -> float:
        if not self.overlaps(other):
            return 0.0
        ox = min(self.x2, other.x2) - max(self.x, other.x)
        oy = min(self.y2, other.y2) - max(self.y, other.y)
        return ox * oy


@dataclass
class TextEntry:
    text: str
    fontSize: float
    bbox: BBox
    source_line: int | None = None


@dataclass
class RectEntry:
    bbox: BBox
    fill: str | None
    stroke: str | None


# transform="translate(10, 20) scale(0.5, 0.5)" parser
_TRANSLATE_RE = re.compile(r'translate\s*\(\s*([-\d.]+)\s*[,\s]\s*([-\d.]+)?\s*\)')
_SCALE_RE = re.compile(r'scale\s*\(\s*([-\d.]+)\s*[,\s]\s*([-\d.]+)?\s*\)')


def parse_transform(t: str) -> tuple[float, float, float, float]:
    """Return (tx, ty, sx, sy). Defaults: tx=ty=0, sx=sy=1."""
    tx, ty, sx, sy = 0.0, 0.0, 1.0, 1.0
    if not t:
        return tx, ty, sx, sy
    m = _TRANSLATE_RE.search(t)
    if m:
        tx = float(m.group(1))
        ty = float(m.group(2)) if m.group(2) else 0.0
    m = _SCALE_RE.search(t)
    if m:
        sx = float(m.group(1))
        sy = float(m.group(2)) if m.group(2) else sx
    return tx, ty, sx, sy


def compose(parent: tuple[float, float, float, float], local: str) -> tuple[float, float, float, float]:
    """Compose parent transform with local transform string."""
    ptx, pty, psx, psy = parent
    ltx, lty, lsx, lsy = parse_transform(local)
    # apply local IN parent: tx' = ptx + psx * ltx ; sx' = psx * lsx
    return (ptx + psx * ltx, pty + psy * lty, psx * lsx, psy * lsy)


def apply(xform: tuple[float, float, float, float], x: float, y: float) -> tuple[float, float]:
    tx, ty, sx, sy = xform
    return tx + sx * x, ty + sy * y


def text_bbox(text: str, x: float, y: float, font_size: float, anchor: str = 'start') -> BBox:
    """Approximate bbox for an SVG <text> element.
    SVG <text> y is the BASELINE, not the top. Approximate top = y - fontSize * 0.82
    (cap-height). Width ~ chars × fontSize × 0.58.
    """
    width = max(1.0, len(text)) * font_size * 0.58
    height = font_size * 1.0
    top_y = y - font_size * 0.82
    if anchor == 'middle':
        left_x = x - width / 2
    elif anchor == 'end':
        left_x = x - width
    else:
        left_x = x
    return BBox(left_x, top_y, width, height)


def walk_svg(root: ET.Element) -> tuple[list[TextEntry], list[RectEntry]]:
    """Walk SVG tree, return list of (TextEntry, RectEntry) in world coords."""
    texts: list[TextEntry] = []
    rects: list[RectEntry] = []

    def recurse(node: ET.Element, xform: tuple[float, float, float, float]):
        tag = node.tag.split('}')[-1] if '}' in node.tag else node.tag
        # Update xform if this node carries a transform
        local_t = node.get('transform', '')
        cur = compose(xform, local_t) if local_t else xform

        if tag == 'text':
            text = ''.join(node.itertext()).strip()
            if not text:
                return
            try:
                x = float(node.get('x', '0'))
                y = float(node.get('y', '0'))
                fs = float(node.get('fontSize') or node.get('font-size') or '10')
                anchor = node.get('textAnchor') or node.get('text-anchor') or 'start'
            except ValueError:
                return
            # apply current transform to anchor point
            wx, wy = apply(cur, x, y)
            # scale font size and width by transform scale
            _, _, sx, sy = cur
            world_fs = fs * abs(sy)
            # text width also scales with sx
            bbox = text_bbox(text, wx, wy, world_fs, anchor)
            # if sx != sy, width was wrong; redo width using world sx
            bbox.w = max(1.0, len(text)) * fs * 0.58 * abs(sx)
            texts.append(TextEntry(text=text, fontSize=world_fs, bbox=bbox))
            return

        if tag == 'rect':
            try:
                x = float(node.get('x', '0'))
                y = float(node.get('y', '0'))
                w = float(node.get('width', '0'))
                h = float(node.get('height', '0'))
            except ValueError:
                return
            wx, wy = apply(cur, x, y)
            _, _, sx, sy = cur
            rects.append(RectEntry(
                bbox=BBox(wx, wy, w * abs(sx), h * abs(sy)),
                fill=node.get('fill'),
                stroke=node.get('stroke'),
            ))
            # rects don't have descendant text typically; still recurse for safety
        for child in node:
            recurse(child, cur)

    recurse(root, (0.0, 0.0, 1.0, 1.0))
    return texts, rects


def extract_svg_root(path: str) -> ET.Element:
    """Read file, find <svg> root (either standalone .svg or embedded in HTML)."""
    with open(path, 'rb') as f:
        raw = f.read().decode('utf-8', errors='replace')
    # Locate the first <svg ...> ... </svg> block
    m = re.search(r'<svg\b[^>]*>.*?</svg>', raw, re.DOTALL | re.IGNORECASE)
    if not m:
        raise ValueError(f'No <svg> block found in {path}')
    svg_xml = m.group(0)
    # Strip xmlns to make ET parsing easier on namespaces (or wrap with default ns)
    # Force a default namespace removal so element tags come out without prefix.
    svg_xml = re.sub(r'\sxmlns="[^"]*"', '', svg_xml, count=1)
    try:
        return ET.fromstring(svg_xml)
    except ET.ParseError as e:
        # Some attributes like fontFamily="Helvetica, Arial" or unescaped & may fail.
        # Try a forgiving second pass: replace bare & with &amp;
        forgiving = re.sub(r'&(?![a-zA-Z]+;|#\d+;)', '&amp;', svg_xml)
        return ET.fromstring(forgiving)


def find_text_overlaps(texts: list[TextEntry], pad: float = 0.5) -> list[tuple[int, int, float]]:
    """Pairwise text overlap detection. Returns (i, j, overlap_area)."""
    hits = []
    n = len(texts)
    for i in range(n):
        for j in range(i + 1, n):
            a, b = texts[i].bbox, texts[j].bbox
            if a.overlaps(b, pad=-pad):  # negative pad = require real intersection
                area = a.overlap_area(b)
                if area > 1.0:  # ignore noise smaller than 1 sq px
                    hits.append((i, j, area))
    return hits


def find_text_rect_overlaps(texts: list[TextEntry], rects: list[RectEntry], pad: float = 0.5) -> list[tuple[int, int, float]]:
    """Text-vs-rect overlap. Skips rects with fill=white (occluders/backgrounds)
    and fully-containing frames (a rect that wholly contains the text is the asset
    frame, not a collision)."""
    hits = []
    for ti, t in enumerate(texts):
        for ri, r in enumerate(rects):
            # Skip white-fill rects (backgrounds / occluders)
            if r.fill and r.fill.lower() in ('#fff', '#ffffff', 'white'):
                continue
            # Skip transparent rects (no fill)
            if r.fill in (None, 'none', 'transparent'):
                continue
            if not r.bbox.overlaps(t.bbox, pad=-pad):
                continue
            # If rect wholly contains the text bbox, that's framing not collision
            if (r.bbox.x <= t.bbox.x and r.bbox.x2 >= t.bbox.x2
                and r.bbox.y <= t.bbox.y and r.bbox.y2 >= t.bbox.y2):
                continue
            area = r.bbox.overlap_area(t.bbox)
            if area > 1.0:
                hits.append((ti, ri, area))
    return hits


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('path', help='Path to rendered SLD HTML or SVG file')
    ap.add_argument('--mode', choices=['text', 'text-rect', 'all'], default='text',
                    help='What overlap classes to check (default: text only)')
    ap.add_argument('--json', action='store_true', help='Output JSON instead of human-readable')
    ap.add_argument('--top', type=int, default=20, help='Max overlaps to report (default 20)')
    args = ap.parse_args()

    try:
        root = extract_svg_root(args.path)
    except (ValueError, OSError, ET.ParseError) as e:
        print(f'ERROR: {e}', file=sys.stderr)
        return 2

    texts, rects = walk_svg(root)

    text_hits = find_text_overlaps(texts) if args.mode in ('text', 'all') else []
    rect_hits = find_text_rect_overlaps(texts, rects) if args.mode in ('text-rect', 'all') else []

    if args.json:
        out = {
            'path': args.path,
            'text_count': len(texts),
            'rect_count': len(rects),
            'text_overlaps': [
                {'a_idx': i, 'b_idx': j, 'area': round(area, 2),
                 'a_text': texts[i].text[:80], 'b_text': texts[j].text[:80],
                 'a_xy': [round(texts[i].bbox.x, 1), round(texts[i].bbox.y, 1)],
                 'b_xy': [round(texts[j].bbox.x, 1), round(texts[j].bbox.y, 1)]}
                for i, j, area in sorted(text_hits, key=lambda h: -h[2])[:args.top]
            ],
            'text_rect_overlaps': [
                {'t_idx': ti, 'r_idx': ri, 'area': round(area, 2),
                 't_text': texts[ti].text[:80],
                 't_xy': [round(texts[ti].bbox.x, 1), round(texts[ti].bbox.y, 1)],
                 'r_xy': [round(rects[ri].bbox.x, 1), round(rects[ri].bbox.y, 1)],
                 'r_size': [round(rects[ri].bbox.w, 1), round(rects[ri].bbox.h, 1)]}
                for ti, ri, area in sorted(rect_hits, key=lambda h: -h[2])[:args.top]
            ],
        }
        print(json.dumps(out, indent=2))
    else:
        print(f'File:   {args.path}')
        print(f'Texts:  {len(texts)}')
        print(f'Rects:  {len(rects)}')
        print()
        if args.mode in ('text', 'all'):
            print(f'=== TEXT↔TEXT OVERLAPS: {len(text_hits)} ===')
            for i, j, area in sorted(text_hits, key=lambda h: -h[2])[:args.top]:
                a, b = texts[i], texts[j]
                print(f'  area={area:6.1f} fs={a.fontSize:.1f}/{b.fontSize:.1f}')
                print(f'    A @ ({a.bbox.x:7.1f}, {a.bbox.y:7.1f}) {a.bbox.w:5.1f}×{a.bbox.h:4.1f}  {a.text[:70]!r}')
                print(f'    B @ ({b.bbox.x:7.1f}, {b.bbox.y:7.1f}) {b.bbox.w:5.1f}×{b.bbox.h:4.1f}  {b.text[:70]!r}')
            if len(text_hits) > args.top:
                print(f'  ... +{len(text_hits) - args.top} more')
            print()
        if args.mode in ('text-rect', 'all'):
            print(f'=== TEXT↔RECT OVERLAPS: {len(rect_hits)} ===')
            for ti, ri, area in sorted(rect_hits, key=lambda h: -h[2])[:args.top]:
                t, r = texts[ti], rects[ri]
                print(f'  area={area:6.1f} fs={t.fontSize:.1f} rect={r.bbox.w:5.1f}×{r.bbox.h:4.1f}')
                print(f'    T @ ({t.bbox.x:7.1f}, {t.bbox.y:7.1f}): {t.text[:70]!r}')
                print(f'    R @ ({r.bbox.x:7.1f}, {r.bbox.y:7.1f}) fill={r.fill} stroke={r.stroke}')
            if len(rect_hits) > args.top:
                print(f'  ... +{len(rect_hits) - args.top} more')

    total = len(text_hits) + len(rect_hits)
    return 1 if total > 0 else 0


if __name__ == '__main__':
    sys.exit(main())
