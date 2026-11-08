"""Small deterministic alpha-cutout branch atlas; no downloaded assets."""
from pathlib import Path
import math
import random
from PIL import Image, ImageDraw

out = Path(__file__).resolve().parents[1] / 'public/textures/trees'
out.mkdir(parents=True, exist_ok=True)
rng = random.Random(21)
image = Image.new('RGBA', (256, 256))
draw = ImageDraw.Draw(image)
# Open spaces between leaves keep the silhouette airy rather than a solid green card.
for branch in range(7):
    angle = -math.pi / 2 + (branch - 3) * .31
    ex, ey = 128 + math.cos(angle) * 108, 218 + math.sin(angle) * 174
    draw.line((128, 235, ex, ey), fill=(105, 92, 57, 255), width=2)
    for i in range(22):
        t = rng.uniform(.15, 1)
        x = 128 + (ex - 128) * t + rng.uniform(-29, 29)
        y = 235 + (ey - 235) * t + rng.uniform(-23, 23)
        radius = rng.uniform(5, 11)
        shade = rng.randrange(100, 180)
        draw.ellipse((x-radius*.65,y-radius,x+radius*.65,y+radius), fill=(shade, min(228,shade+35), shade-30,255))
        draw.line((x,y-radius*.6,x,y+radius*.6),fill=(shade+12,shade+42,shade-18,255),width=1)
image = image.crop(image.getchannel('A').getbbox())
image.save(out / 'leaves.png', optimize=True)

# A single crown image replaces all branch cards in the distant LOD.
crown = Image.new('RGBA', (256, 256))
for x, y, scale in [(20,65,140),(95,60,140),(55,5,145),(5,105,135),(115,105,135),(65,100,140)]:
    patch = image.resize((scale, round(scale * image.height / image.width)), Image.Resampling.LANCZOS)
    crown.alpha_composite(patch, (x, y))
crown.save(out / 'crown.png', optimize=True)
