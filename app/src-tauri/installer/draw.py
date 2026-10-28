"""Draws the NSIS installer art (nsis-sidebar.bmp, nsis-header.bmp next to
this file; run: python draw.py <this folder>, needs Pillow and the Cascadia Mono
font that comes with Windows).

Draws the NSIS installer art for Parom: the sidebar of the welcome and
finish pages (164 x 314) and the header of the other pages (150 x 57).
Drawn 4x larger, then scaled down for smooth lines; saved as 24-bit BMP."""
import math
import sys

from PIL import Image, ImageDraw, ImageFont

OUT = sys.argv[1]
S = 4
WHITE = (255, 255, 255)
GREY = (138, 138, 138)
DIM = (70, 70, 70)
MONO = 'C:/Windows/Fonts/CascadiaMono.ttf'


def mark(d, x, y, size):
    """The "_P" of the app icon (source.svg, 120 units), at x, y, `size` px wide."""
    k = size / 120 * S
    w = max(1, round(6 * k))

    def p(px, py):
        return (x * S + px * k, y * S + py * k)

    d.line([p(58, 32), p(58, 88)], fill=WHITE, width=w)
    d.line([p(58, 32), p(74, 32)], fill=WHITE, width=w)
    d.line([p(58, 60), p(74, 60)], fill=WHITE, width=w)
    # The bowl of the P: a half circle from (74, 32) to (74, 60).
    cx, cy, r = 74, 46, 14
    d.arc([p(cx - r, cy - r), p(cx + r, cy + r)], start=-90, end=90, fill=WHITE, width=w)
    d.line([p(30, 88), p(46, 88)], fill=WHITE, width=w)


def wave(d, x0, x1, y, amp, period, color, width):
    pts = []
    for i in range(int((x1 - x0) * S) + 1):
        x = x0 + i / S
        pts.append((x * S, (y + amp * math.sin((x - x0) / period * 2 * math.pi)) * S))
    d.line(pts, fill=color, width=round(width * S), joint='curve')


def ferry(d, cx, y, scale):
    """The ferry of Ferry.svelte: hull, cabin with windows, funnel, crate, flag."""
    def p(px, py):
        return ((cx + px * scale) * S, (y + py * scale) * S)

    lw = max(1, round(1.3 * scale * S))
    d.polygon([p(-16, 0), p(16, 0), p(12, 5), p(-12, 5)], fill=WHITE)
    d.rectangle([p(-9, -7), p(4, 0)], outline=WHITE, width=lw)
    d.rectangle([p(-6.5, -5), p(-4.1, -2.8)], fill=WHITE)
    d.rectangle([p(-2.5, -5), p(-0.1, -2.8)], fill=WHITE)
    d.rectangle([p(-1.5, -12), p(1.5, -7)], fill=WHITE)
    d.rectangle([p(6, -5), p(12, 0)], outline=WHITE, width=lw)
    d.line([p(6, -5), p(12, 0)], fill=WHITE, width=max(1, lw - 1))
    d.line([p(-14, 0), p(-14, -9)], fill=WHITE, width=lw)
    d.polygon([p(-14, -9), p(-10, -7.5), p(-14, -6)], fill=WHITE)
    # Smoke.
    for dx, dy, r, c in [(-2, -16, 1.6, GREY), (-5, -20, 1.2, DIM)]:
        d.ellipse([p(dx - r, dy - r), p(dx + r, dy + r)], fill=c)


def text(d, xy, s, size, color):
    font = ImageFont.truetype(MONO, size * S)
    d.text((xy[0] * S, xy[1] * S), s, font=font, fill=color)


def save(img, name, w, h):
    img.resize((w, h), Image.LANCZOS).convert('RGB').save(f'{OUT}/{name}', format='BMP')


# Sidebar: welcome and finish pages.
W, H = 164, 314
img = Image.new('RGB', (W * S, H * S), (0, 0, 0))
d = ImageDraw.Draw(img)
mark(d, 14, 26, 72)
text(d, (22, 112), '_', 22, GREY)
text(d, (36, 112), 'Parom', 22, WHITE)
text(d, (22, 146), 'SFTP · FTP', 10, GREY)
text(d, (22, 161), 'GitHub sync', 10, GREY)
wave(d, 0, W, 286, 2.2, 22, DIM, 1.1)
ferry(d, 84, 281, 1.9)
wave(d, 0, W, 292, 2.4, 18, WHITE, 1.4)
save(img, 'nsis-sidebar.bmp', W, H)

# Header: the other pages (sits at the right of a white header bar).
W, H = 150, 57
img = Image.new('RGB', (W * S, H * S), (0, 0, 0))
d = ImageDraw.Draw(img)
text(d, (12, 17), '_', 16, GREY)
text(d, (23, 17), 'Parom', 16, WHITE)
wave(d, 92, W, 41, 1.2, 12, DIM, 0.9)
ferry(d, 121, 38, 0.95)
wave(d, 92, W, 44, 1.3, 10, WHITE, 1.0)
save(img, 'nsis-header.bmp', W, H)
print('ok')
