"""Draws the 16x16 stand-in icons used by the material picker.

These are original MineMods drawings, not Mojang textures: each icon is built
from simple shapes in code, so anyone can see how it was made and redraw it.
Run: python tools/art/draw_item_icons.py
"""
import random
from pathlib import Path
from PIL import Image

OUT = Path(__file__).resolve().parents[2] / "packages/studio/src/renderer/assets/minecraft/1.21.1"


def canvas():
    return Image.new("RGBA", (16, 16), (0, 0, 0, 0))


def put(im, pts, color):
    for x, y in pts:
        if 0 <= x < 16 and 0 <= y < 16:
            im.putpixel((x, y), color)


def bar(light, mid, dark):
    """A metal bar seen from above at an angle: a parallelogram with a lit top face."""
    im = canvas()
    for y in range(6, 12):
        x0 = 2 + (11 - y) // 2
        for x in range(x0, x0 + 10):
            put(im, [(x, y)], mid)
    for x in range(5, 13):
        put(im, [(x, 6)], light)
    for x in range(4, 12):
        put(im, [(x, 7)], light)
    for y in range(6, 12):
        put(im, [(2 + (11 - y) // 2 + 9, y)], dark)
    for x in range(2, 12):
        put(im, [(x, 11)], dark)
    return im


def gem():
    im = canvas()
    rows = {3: (6, 9), 4: (5, 10), 5: (4, 11), 6: (3, 12), 7: (3, 12), 8: (4, 11), 9: (5, 10), 10: (6, 9), 11: (7, 8)}
    for y, (a, b) in rows.items():
        for x in range(a, b + 1):
            c = (90, 220, 230, 255) if x < 8 else (40, 160, 190, 255)
            if y <= 5:
                c = (180, 250, 250, 255)
            put(im, [(x, y)], c)
    put(im, [(6, 4), (5, 5)], (255, 255, 255, 255))
    return im


def lump(seed, base, spots):
    rnd = random.Random(seed)
    im = canvas()
    for y in range(4, 13):
        for x in range(3, 13):
            if (x - 7.5) ** 2 / 25 + (y - 8.5) ** 2 / 18 <= 1:
                put(im, [(x, y)], base if rnd.random() > 0.25 else spots)
    return im


def dust():
    rnd = random.Random(7)
    im = canvas()
    for _ in range(26):
        x, y = rnd.randint(3, 12), rnd.randint(7, 13)
        put(im, [(x, y)], rnd.choice([(200, 30, 30, 255), (150, 10, 10, 255), (240, 70, 60, 255)]))
    return im


def stick():
    im = canvas()
    for i in range(10):
        put(im, [(3 + i, 12 - i)], (140, 95, 50, 255))
        put(im, [(4 + i, 12 - i)], (95, 60, 30, 255))
    return im


def stone():
    rnd = random.Random(3)
    im = Image.new("RGBA", (16, 16), (120, 120, 120, 255))
    for _ in range(9):
        cx, cy, r = rnd.randint(0, 15), rnd.randint(0, 15), rnd.randint(2, 4)
        shade = rnd.choice([(150, 150, 150, 255), (100, 100, 100, 255), (135, 135, 130, 255)])
        for y in range(cy - r, cy + r):
            for x in range(cx - r, cx + r):
                if (x - cx) ** 2 + (y - cy) ** 2 < r * r:
                    put(im, [(x % 16, y % 16)], shade)
    return im


def planks():
    im = Image.new("RGBA", (16, 16), (170, 130, 80, 255))
    for y in range(16):
        if y % 5 == 4:
            put(im, [(x, y) for x in range(16)], (110, 80, 45, 255))
        elif y % 5 == 0:
            put(im, [(x, y) for x in range(16)], (195, 155, 100, 255))
    for y, x in ((1, 9), (6, 3), (11, 12)):
        put(im, [(x, y), (x, y + 1)], (110, 80, 45, 255))
    return im


def glass():
    im = canvas()
    frame = (210, 235, 240, 255)
    put(im, [(x, 0) for x in range(16)] + [(x, 15) for x in range(16)] + [(0, y) for y in range(16)] + [(15, y) for y in range(16)], frame)
    for y in range(1, 15):
        put(im, [(x, y) for x in range(1, 15)], (200, 230, 240, 60))
    put(im, [(3, 6), (4, 5), (5, 4), (6, 3), (10, 12), (11, 11), (12, 10)], (255, 255, 255, 200))
    return im


ICONS = {
    "item/iron_ingot.png": lambda: bar((235, 235, 235, 255), (195, 195, 200, 255), (130, 130, 140, 255)),
    "item/gold_ingot.png": lambda: bar((255, 245, 140, 255), (235, 200, 60, 255), (170, 120, 20, 255)),
    "item/copper_ingot.png": lambda: bar((250, 180, 140, 255), (215, 120, 80, 255), (150, 70, 45, 255)),
    "item/diamond.png": gem,
    "item/coal.png": lambda: lump(5, (45, 45, 50, 255), (80, 80, 90, 255)),
    "item/redstone.png": dust,
    "item/stick.png": stick,
    "block/cobblestone.png": stone,
    "block/oak_planks.png": planks,
    "block/glass.png": glass,
}

def pickaxe():
    """The picture the end-to-end tests upload as an item image."""
    im = canvas()
    head = (205, 120, 70, 255)
    edge = (150, 75, 40, 255)
    for x in range(3, 13):
        y = 3 if 4 <= x <= 11 else 4
        put(im, [(x, y), (x, y + 1)], head)
    put(im, [(2, 5), (2, 6), (13, 5), (13, 6)], edge)
    for i in range(9):
        put(im, [(7 + (i % 2 == 0), 5 + i)], (120, 85, 45, 255))
    return im


if __name__ == "__main__":
    for rel, draw in ICONS.items():
        path = OUT / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        draw().save(path)
        print("drew", rel)
    fixture = Path(__file__).resolve().parents[2] / "packages/studio/test/e2e/fixtures/copper-pickaxe.png"
    pickaxe().save(fixture)
    print("drew test fixture", fixture.name)
