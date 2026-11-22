"""Draws the 1280x640 social preview: a pixelated in-game shot of our own boss with the pixel title on top.

Uses only our own footage (docs/assets/boss-chiyou.jpg) and the app's OFL pixel font.
Run: python tools/art/draw_social_preview.py [output.png]
"""
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageEnhance

sys.path.insert(0, str(Path(__file__).resolve().parent))
from draw_readme_art import pixel_text  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
SHOT = ROOT / "docs/assets/boss-chiyou.jpg"
W, H, CELL = 1280, 640, 4


def main(out):
    shot = Image.open(SHOT).convert("RGB")
    # cover-crop to 2:1, then pixelate: shrink to one pixel per cell and blow it back up
    sw, sh = shot.size
    crop_h = sw // 2
    top = max(0, (sh - crop_h) // 2 - 40)
    shot = shot.crop((0, top, sw, top + crop_h)).resize((W // CELL, H // CELL), Image.BOX)
    shot = ImageEnhance.Brightness(shot).enhance(0.55)
    im = shot.resize((W, H), Image.NEAREST).convert("RGBA")
    # dark band behind the title so it reads on any frame
    band = Image.new("RGBA", (W, 250), (20, 20, 24, 170))
    im.alpha_composite(band, (0, 195))
    big = pixel_text("MineMods Studio", 24, (255, 255, 255, 255), (40, 40, 44, 255))
    big = big.resize((big.width * 5, big.height * 5), Image.NEAREST)
    im.alpha_composite(big, ((W - big.width) // 2, 220))
    sub = pixel_text("用 AI 帮你做 Minecraft 模组", 12, (255, 236, 140, 255), (60, 50, 20, 255))
    sub = sub.resize((sub.width * 4, sub.height * 4), Image.NEAREST)
    im.alpha_composite(sub, ((W - sub.width) // 2, 370))
    note = pixel_text("非官方工具 · 与 Mojang 无关", 12, (210, 210, 210, 255), (30, 30, 30, 255))
    note = note.resize((note.width * 2, note.height * 2), Image.NEAREST)
    im.alpha_composite(note, (W - note.width - 24, H - note.height - 20))
    # grass, dirt, stone strip along the top edge
    d = ImageDraw.Draw(im)
    for x in range(0, W, CELL):
        for y, colors in ((0, ((92, 160, 60), (80, 140, 50))), (CELL, ((92, 160, 60), (106, 176, 70))),
                          (2 * CELL, ((134, 96, 67), (120, 84, 58))), (3 * CELL, ((134, 96, 67), (150, 108, 76)))):
            d.rectangle((x, y, x + CELL - 1, y + CELL - 1), fill=colors[(x // CELL + y) % 2])
    im.convert("RGB").save(out)
    print("drew", out)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else str(ROOT / "docs/assets/social-preview.png"))
