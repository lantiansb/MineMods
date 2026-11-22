"""Draws the README pictures: the pixel title, the block divider and the section icons.

Everything is drawn here from code with the app's own pixel font (MineMods Pixel,
merged from Ark Pixel and Cubic 11, both SIL OFL 1.1). No Mojang artwork is used.
Run: python tools/art/draw_readme_art.py
"""
import random
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
FONT = ROOT / "packages/studio/src/renderer/assets/fonts/minemods-pixel.woff"
OUT = ROOT / "docs/assets"
SCALE = 4  # every art pixel becomes a 4x4 block


def font(px):
    return ImageFont.truetype(str(FONT), px)


def stone_tile(rnd, w, h, base=(112, 112, 116)):
    im = Image.new("RGB", (w, h), base)
    px = im.load()
    for y in range(h):
        for x in range(w):
            d = rnd.choice((-14, -8, 0, 0, 6, 12))
            px[x, y] = tuple(max(0, min(255, c + d)) for c in base)
    return im


def pixel_text(text, size, fill, shadow):
    """Text drawn small without smoothing, then blown up, so every pixel stays a square."""
    f = font(size)
    l, t, r, b = f.getbbox(text)
    im = Image.new("RGBA", (r - l + 2, b - t + 2), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.fontmode = "1"
    d.text((1 - l, 1 - t), text, font=f, fill=shadow)
    d.text((-l, -t), text, font=f, fill=fill)
    return im


def title():
    rnd = random.Random(11)
    w, h = 240, 60
    im = stone_tile(rnd, w, h)
    # grass lip on top, dirt band under it
    px = im.load()
    for x in range(w):
        lip = 3 + (1 if rnd.random() < 0.3 else 0)
        for y in range(lip):
            px[x, y] = rnd.choice(((92, 160, 60), (80, 140, 50), (106, 176, 70)))
        for y in range(lip, lip + 4):
            px[x, y] = rnd.choice(((134, 96, 67), (120, 84, 58), (150, 108, 76)))
    # dark frame
    d = ImageDraw.Draw(im)
    d.rectangle((0, 0, w - 1, h - 1), outline=(30, 30, 32))
    big = pixel_text("MineMods Studio", 24, (255, 255, 255, 255), (40, 40, 44, 255))
    im.paste(big, ((w - big.width) // 2, 14), big)
    sub = pixel_text("用 AI 帮你做 Minecraft 模组", 12, (255, 236, 140, 255), (60, 50, 20, 255))
    im.paste(sub, ((w - sub.width) // 2, 42), sub)
    return im.resize((w * SCALE, h * SCALE), Image.NEAREST)


def divider():
    rnd = random.Random(5)
    w, h = 240, 6
    im = Image.new("RGB", (w, h))
    px = im.load()
    for x in range(w):
        for y in range(h):
            if y < 2:
                px[x, y] = rnd.choice(((92, 160, 60), (80, 140, 50)))
            elif y < 4:
                px[x, y] = rnd.choice(((134, 96, 67), (120, 84, 58)))
            else:
                px[x, y] = rnd.choice(((112, 112, 116), (98, 98, 102)))
    return im.resize((w * SCALE, h * SCALE), Image.NEAREST)


ICONS = {
    # 16x16 pictures written as rows; "." is empty, letters pick a colour
    "icon-what": (
        {"k": (40, 40, 44), "y": (255, 214, 90), "w": (255, 255, 255)},
        [
            "......kkkk......",
            ".....kyyyyk.....",
            "....kyywyyyk....",
            "....kywyyyyk....",
            "....kyyyyyyk....",
            ".....kyyyyk.....",
            "......kyyk......",
            "......kyyk......",
            "......kkkk......",
            "......kwwk......",
            "......kkkk......",
            "................",
        ],
    ),
    "icon-install": (
        {"k": (50, 34, 20), "b": (150, 105, 60), "l": (190, 140, 85), "g": (230, 200, 90)},
        [
            "................",
            "..kkkkkkkkkkkk..",
            "..kllllllllllk..",
            "..kbbbbbbbbbbk..",
            "..kkkkkggkkkkk..",
            "..kbbbbggbbbbk..",
            "..kbbbbbbbbbbk..",
            "..kbbbbbbbbbbk..",
            "..kbbbbbbbbbbk..",
            "..kkkkkkkkkkkk..",
        ],
    ),
    "icon-monster": (
        {"k": (30, 30, 34), "r": (170, 40, 40), "d": (110, 25, 25), "e": (255, 220, 80)},
        [
            "..k..........k..",
            "..kk........kk..",
            "...krrrrrrrrk...",
            "..krrrrrrrrrrk..",
            "..kreekrrkeerk..",
            "..krrrrrrrrrrk..",
            "..krrdddddrrrk..",
            "..krdkdkdkdrrk..",
            "...krrrrrrrrk...",
            "....kkkkkkkk....",
        ],
    ),
    "icon-wip": (
        {"k": (40, 40, 44), "s": (170, 170, 176), "h": (140, 95, 50)},
        [
            "..kkkkkk........",
            ".kssssssk.......",
            ".kssssssk.......",
            "..kkkhkk........",
            ".....hk.........",
            "......hk........",
            ".......hk.......",
            "........hk......",
            ".........hk.....",
            "..........k.....",
        ],
    ),
    "icon-faq": (
        {"k": (40, 40, 44), "b": (90, 150, 220), "w": (255, 255, 255)},
        [
            "..kkkkkkkkkkkk..",
            "..kbbbbbbbbbbk..",
            "..kbbbwwwwbbbk..",
            "..kbbwbbbbwbbk..",
            "..kbbbbbbwwbbk..",
            "..kbbbbbwwbbbk..",
            "..kbbbbbwbbbbk..",
            "..kbbbbbbbbbbk..",
            "..kbbbbbwbbbbk..",
            "..kkkkkkkkkkkk..",
        ],
    ),
    "icon-code": (
        {"k": (40, 40, 44), "g": (120, 200, 110)},
        [
            "................",
            "....k......k....",
            "...kg......gk...",
            "..kg........gk..",
            ".kg....kk....gk.",
            "..kg........gk..",
            "...kg......gk...",
            "....k......k....",
        ],
    ),
}


def icon(palette, rows):
    im = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    top = (16 - len(rows)) // 2
    for y, row in enumerate(rows):
        for x, ch in enumerate(row):
            if ch in palette:
                im.putpixel((x, top + y), palette[ch] + (255,))
    return im.resize((16 * 2, 16 * 2), Image.NEAREST)


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    title().save(OUT / "title.png")
    divider().save(OUT / "divider.png")
    for name, (palette, rows) in ICONS.items():
        icon(palette, rows).save(OUT / f"{name}.png")
    print("drew", sorted(p.name for p in OUT.glob("*.png")))
