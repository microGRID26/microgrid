#!/usr/bin/env python3
# Generates a placeholder PNG logo for Direct Supply Equity Corporation and
# prints a base64 data URI suitable for storing in `organizations.logo_url`.
#
# Re-runnable: tweak NAVY/FONT_PATH/SIZE constants and re-run. Output goes to
# stdout as a data URI; pipe to pbcopy or save to a file as needed.
#
# Usage: python3 scripts/generate-dse-corp-logo.py

import base64
import io
import sys
from PIL import Image, ImageDraw, ImageFont

NAVY = (26, 58, 92)
DARK = (15, 31, 51)
WHITE = (255, 255, 255)

W, H = 480, 240
PADDING = 20

img = Image.new("RGB", (W, H), WHITE)
draw = ImageDraw.Draw(img)

font_paths = [
    "/System/Library/Fonts/Helvetica.ttc",
    "/Library/Fonts/Helvetica.ttf",
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
]
font_path = next((p for p in font_paths if __import__("os").path.exists(p)), None)
if font_path is None:
    print("No system font found", file=sys.stderr)
    sys.exit(1)

monogram_font = ImageFont.truetype(font_path, 96)
wordmark_font = ImageFont.truetype(font_path, 28)
tagline_font = ImageFont.truetype(font_path, 14)

mono_x = PADDING + 16
mono_y = H // 2 - 60
draw.text((mono_x, mono_y), "DSE", fill=NAVY, font=monogram_font)

mono_bbox = draw.textbbox((mono_x, mono_y), "DSE", font=monogram_font)
mono_right = mono_bbox[2]

bar_x = mono_right + 20
draw.line([(bar_x, mono_y + 10), (bar_x, mono_y + 110)], fill=NAVY, width=3)

text_x = bar_x + 18
draw.text((text_x, mono_y + 18), "DIRECT SUPPLY", fill=DARK, font=wordmark_font)
draw.text((text_x, mono_y + 50), "EQUITY CORPORATION", fill=DARK, font=wordmark_font)
draw.text(
    (text_x, mono_y + 92),
    "EQUIPMENT SUPPLY & DISTRIBUTION",
    fill=NAVY,
    font=tagline_font,
)

buf = io.BytesIO()
img.save(buf, format="PNG", optimize=True)
data_uri = "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("ascii")
print(data_uri)
