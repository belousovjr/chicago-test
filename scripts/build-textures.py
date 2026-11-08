"""Prepare small CC0 city textures. Source archives stay in a local cache, not in the game."""
import argparse
import hashlib
import io
import json
from pathlib import Path
import random
import urllib.request
import zipfile
from PIL import Image, ImageChops, ImageDraw, ImageEnhance, ImageFilter, ImageOps, ImageStat

ROOT = Path(__file__).resolve().parents[1]
FACADE_LAYOUT = json.loads((ROOT / 'src/facadeLayout.json').read_text())
ASSETS = {'asphalt': 'Asphalt031', 'concrete': 'Concrete031', 'brick': 'Bricks090', 'metal': 'Metal046A', 'grass': 'Grass004'}
SIZES = (512, 128, 32)
FACADE_SIZES = (1024, 512, 128)
PALETTE = {
    "asphalt": (51, 55, 56), "concrete": (174, 170, 157), "brick": (147, 125, 101),
    "metal": (66, 69, 67), "grass": (77, 91, 64), "rail-steel": (112, 65, 47),
    "riverbed": (106, 100, 78), "roof": (77, 79, 75), "paint": (201, 199, 181), "water": (53, 89, 91),
}


def tint(image, color, contrast=0.35):
    gray = ImageOps.grayscale(image)
    mean = ImageStat.Stat(gray).mean[0]
    return Image.merge('RGB', tuple(gray.point(lambda n, c=c: max(0, min(255, round(c + (n - mean) * contrast)))) for c in color))


def save_set(out, name, color, ao, normal, roughness=None):
    facade_material = name.startswith('facade-')
    sizes = FACADE_SIZES if facade_material else SIZES
    for lod, size in enumerate(sizes):
        base = color if lod == 0 else ImageChops.multiply(color, ao.convert('RGB'))
        if facade_material and lod == 2:
            base = Image.blend(base, base.filter(ImageFilter.GaussianBlur(12)), 0.65)
        base = base.resize((size, size), Image.Resampling.LANCZOS)
        base.save(out / f'{name}-{lod}.webp', quality=92 if facade_material else 82, method=6)
    ao.convert('L').save(out / f'{name}-ao.webp', lossless=True, method=6)
    normal.convert('RGB').save(out / f'{name}-normal.webp', quality=90, method=6)
    strength = (30, 33, 35) if name in ('facade-glass', 'facade-dark') else (31, 31, 29) if name == 'metal' else (65, 72, 72) if name == 'water' else (6, 6, 6)
    specular = Image.new('RGBA', (256, 256), (*strength, 255))
    roughness = roughness if roughness is not None else Image.new('L', color.size, 90 if name in ('facade-glass', 'facade-dark', 'water') else 205)
    specular.putalpha(ImageOps.invert(roughness.convert('L')).resize((256, 256), Image.Resampling.LANCZOS))
    if name in ('facade-stone', 'facade-brick'):
        specular = Image.new('RGBA', color.size, (6, 6, 6, 35))
        pane = ImageDraw.Draw(specular)
        grid = FACADE_LAYOUT['masonry']
        for row in range(grid['rows']):
            for col in range(grid['columns']):
                pane.rectangle((round(col * color.width / grid['columns']) + grid['insetX'],
                    round(row * color.height / grid['rows']) + grid['insetTop'],
                    round((col + 1) * color.width / grid['columns']) - grid['insetX'] - 1,
                    round((row + 1) * color.height / grid['rows']) - grid['insetBottom']), fill=(160, 170, 175, 220))
    specular.save(out / f'{name}-specular.webp', lossless=True, method=6)


def surface_averages(out):
    averages = {}
    for name in ['asphalt', 'concrete', 'metal', 'grass', 'roof', 'rail-steel', 'riverbed', 'paint']:
        ao = ImageStat.Stat(Image.open(out / f'{name}-ao.webp').convert('L')).mean[0] / 255
        averages[name] = [[*[round(c / 255, 6) for c in ImageStat.Stat(Image.open(out / f'{name}-{lod}.webp').convert('RGB')).mean], round(ao, 6)] for lod in range(3)]
    (ROOT / 'src/surfaceAverages.json').write_text(json.dumps(averages, indent=2) + '\n')


def facade(base, masonry=False, dark=False):
    size = FACADE_LAYOUT['size']
    grid = FACADE_LAYOUT['masonry' if masonry else 'glass']
    color = base.resize((size, size), Image.Resampling.LANCZOS)
    ao = Image.new('L', (size, size), 255)
    height = Image.new('L', (size, size), 160)
    draw, shadow, relief = ImageDraw.Draw(color), ImageDraw.Draw(ao), ImageDraw.Draw(height)
    rows, columns = grid['rows'], grid['columns']
    cell_w, cell_h = size / columns, size / rows
    rng = random.Random(42)
    windows = {}
    for row in range(rows):
        for col in range(columns):
            inset = grid['insetX']
            box = (round(col * cell_w) + inset, round(row * cell_h) + grid['insetTop'], round((col + 1) * cell_w) - inset - 1, round((row + 1) * cell_h) - grid['insetBottom'])
            shade = rng.randrange(48, 71) if masonry else rng.randrange(57, 82)
            glass = (shade, shade + 4, shade + 5) if not dark else (round(shade * .52), round(shade * .49), round(shade * .42))
            draw.rectangle(box, fill=glass)
            if masonry:
                # Muted sky reflection stays inside the pane; masonry and frames keep their original colour.
                for y in range(box[1], box[3] + 1):
                    sky = 1 - (y - box[1]) / max(1, box[3] - box[1])
                    draw.line((box[0], y, box[2], y), fill=(shade + round(10 + 18 * sky), shade + round(19 + 23 * sky), shade + round(22 + 27 * sky)))
            draw.line((box[0], box[1], box[2], box[1]), fill=tuple(min(255, c + 9) for c in glass))
            shadow.rectangle((box[0] - 1, box[1] - 1, box[2] + 1, box[3] + 1), fill=222 if masonry else 244)
            shadow.rectangle(box, fill=245)
            relief.rectangle(box, fill=142)
            windows[row, col] = box
    emissions, densities = [], []
    for variant in range(3):
        rng = random.Random(97 + variant * 211 + (43 if masonry else 0))
        lit = set()
        target = round(rows * columns * (0.10 + variant * 0.025))
        while len(lit) < target:
            row, col = rng.randrange(rows), rng.randrange(columns)
            for dy in range(rng.choice([1, 1, 2])):
                for dx in range(rng.choice([1, 2, 3])):
                    if row + dy < rows and col + dx < columns:
                        lit.add((row + dy, col + dx))
        bright = set(random.Random(701 + variant).sample(sorted(lit), round(rows * columns * .08)))
        assert abs(len(bright) / (rows * columns) - .08) <= 1 / (rows * columns)
        emission = Image.new('RGB', color.size)
        glow = ImageDraw.Draw(emission)
        for cell in sorted(lit):
            warmth = rng.choice([(147, 139, 122), (135, 130, 119), (159, 149, 132), (132, 137, 138)])
            gain = rng.uniform(.7, 1)
            # Reserve 4x headroom in the map; the material restores normal window brightness.
            value = tuple(round(c * gain) for c in warmth)
            encoded = value if cell in bright else tuple(round(c / 4) for c in value)
            if cell not in bright:
                assert all(abs(c - low * 4) <= 2 for c, low in zip(value, encoded))
            glow.rectangle(windows[cell], fill=encoded)
        glow.rectangle((0, 0, 20, 20), fill=(0, 0, 0))
        emissions.append(emission)
        densities.append(len(lit) / (rows * columns))
    draw.rectangle((0, 0, 20, 20), fill=PALETTE['roof'])
    shadow.rectangle((0, 0, 20, 20), fill=255)
    relief.rectangle((0, 0, 20, 20), fill=160)
    return color, ao, normal_from_height(height), emissions, densities


def normal_from_height(height):
    # Wrapped differences keep tile boundaries continuous.
    from math import sqrt
    pixels = height.load()
    normal = Image.new('RGB', height.size)
    data = []
    for y in range(height.height):
        for x in range(height.width):
            dx = (pixels[(x - 1) % height.width, y] - pixels[(x + 1) % height.width, y]) / 255
            dy = (pixels[x, (y - 1) % height.height] - pixels[x, (y + 1) % height.height]) / 255
            length = sqrt(dx * dx + dy * dy + 1)
            data.append((round(127.5 + dx / length * 127.5), round(127.5 - dy / length * 127.5), round(127.5 + 127.5 / length)))
    normal.putdata(data)
    return normal


def environment(out):
    from math import atan2, floor, sin, sqrt
    for face in ('px', 'py', 'pz', 'nx', 'ny', 'nz'):
        image = Image.new('RGB', (128, 128))
        data = []
        for y in range(128):
            for x in range(128):
                u, v = 2 * (x + 0.5) / 128 - 1, 2 * (y + 0.5) / 128 - 1
                direction = {'px': (1, -v, -u), 'nx': (-1, -v, u), 'py': (u, 1, v), 'ny': (u, -1, -v), 'pz': (u, -v, 1), 'nz': (-u, -v, -1)}[face]
                dx, dy, dz = direction
                elevation = dy / sqrt(dx * dx + dy * dy + dz * dz)
                angle = atan2(dz, dx)
                tower = floor((angle + 3.14159265) * 12)
                skyline = 0.035 + (sin(tower * 17.21) * 0.5 + 0.5) * 0.18
                if elevation < -0.05: color = (85, 95, 92)
                elif elevation < skyline: color = (100 + tower % 4 * 7, 119 + tower % 4 * 5, 125 + tower % 4 * 5)
                else:
                    t = min(1, max(0, elevation))
                    color = (round(191 - 61 * t), round(206 - 42 * t), round(207 - 20 * t))
                data.append(color)
        image.putdata(data)
        image.filter(ImageFilter.GaussianBlur(1.5)).save(out / f'environment_{face}.jpg', quality=85)


def street_lightmap(out):
    # shortcut: baked snapshot lighting does not follow editor changes; rebuild textures after regenerating the city.
    snapshot = json.loads((ROOT / 'src/generated/chicago.json').read_text())
    xmin, zmin, xmax, zmax = snapshot['environment']['bounds']
    size = 1024
    scale_x, scale_z = size / (xmax - xmin), size / (zmax - zmin)
    def point(x, z): return ((x - xmin) * scale_x, (z - zmin) * scale_z)
    spill = Image.new('RGB', (size, size))
    draw = ImageDraw.Draw(spill)
    for obj in snapshot['world']['objects']:
        x, _, z = obj['position']; width, _, depth = obj['size']
        # Extend the pool beyond the footprint so the building cannot hide its own spill.
        a, b = point(x - width / 2 - 4, z - depth / 2 - 4), point(x + width / 2 + 4, z + depth / 2 + 4)
        draw.rectangle((*a, *b), outline=(63, 48, 32), width=3)
    spill = spill.filter(ImageFilter.GaussianBlur(2.25))
    pools = Image.new('RGB', (size, size))
    # Additive soft footprints stay visible independently of the observer and the four live lights.
    radius = 11 * max(scale_x, scale_z)
    tile_size = max(8, round(radius * 2 + 4))
    tile = Image.new('RGB', (tile_size, tile_size)); center = tile_size / 2
    td = ImageDraw.Draw(tile)
    for r in range(round(radius), 0, -1):
        gain = (1 - r / (radius + 1)) ** 1.4
        td.ellipse((center - r, center - r, center + r, center + r), fill=tuple(round(c * gain) for c in (67, 56, 39)))
    tile = tile.filter(ImageFilter.GaussianBlur(.8))
    for lamp in snapshot['environment']['lamps']:
        x, z = point(lamp['position'][0], lamp['position'][2])
        layer = Image.new('RGB', pools.size); layer.paste(tile, (round(x - center), round(z - center)))
        pools = ImageChops.add(pools, layer)
    ImageChops.add(pools, spill).save(out / 'street-lightmap.webp', lossless=True, method=6)


def build(cache, out):
    out.mkdir(parents=True, exist_ok=True)
    sources, prepared = [], {}
    for name, asset in ASSETS.items():
        archive = cache / f'{asset}.zip'
        url = f'https://ambientcg.com/get?file={asset}_1K-JPG.zip'
        if not archive.exists():
            cache.mkdir(parents=True, exist_ok=True)
            request = urllib.request.Request(url, headers={'User-Agent': 'ChicagoLoopGame/0.1 (local texture preparation)'})
            with urllib.request.urlopen(request, timeout=90) as response:
                archive.write_bytes(response.read())
        raw = archive.read_bytes()
        z = zipfile.ZipFile(io.BytesIO(raw))
        def image(suffix):
            matches = [path for path in z.namelist() if path.endswith(f'_{suffix}.jpg')]
            return Image.open(io.BytesIO(z.read(matches[0]))).convert('RGB').resize((512, 512), Image.Resampling.LANCZOS) if matches else None
        color, normal, ao, height = image('Color'), image('NormalGL'), image('AmbientOcclusion'), image('Displacement')
        if color is None or normal is None or height is None:
            raise ValueError(f'Incomplete source maps: {asset}')
        if ao is None:
            # Cavity approximation from source height, not a directional shadow bake.
            cavity = ImageChops.subtract(ImageOps.grayscale(height).filter(ImageFilter.GaussianBlur(4)), ImageOps.grayscale(height))
            ao = ImageOps.invert(cavity.point(lambda n: min(70, n * 2)))
        color = tint(color, PALETTE[name], 0.5 if name in ('grass', 'brick') else 0.3)
        if name == 'concrete':
            # Concrete031 is panelled: use it for sidewalks as well as solid structural parts.
            color = ImageEnhance.Contrast(color).enhance(0.8)
        prepared[name] = (color, ao, normal)
        save_set(out, name, color, ao, normal, image('Roughness'))
        sources.append({'id': asset, 'page': f'https://ambientcg.com/view?id={asset}', 'download': url, 'sha256': hashlib.sha256(raw).hexdigest(), 'ao': 'source' if image('AmbientOcclusion') is not None else 'generated cavity from source height'})
    for name, source in [('roof', 'concrete'), ('rail-steel', 'metal'), ('riverbed', 'grass')]:
        color, ao, normal = prepared[source]
        save_set(out, name, tint(color, PALETTE[name]), ao, normal)
    facade_density = {}
    for name, base, masonry, dark in [
        ('facade-stone', prepared['concrete'][0], True, False),
        ('facade-brick', prepared['brick'][0], True, False),
        ('facade-glass', Image.new('RGB', (512, 512), (100, 110, 111)), False, False),
        ('facade-dark', Image.new('RGB', (512, 512), (48, 46, 41)), False, True),
    ]:
        color, ao, normal, emissions, densities = facade(base, masonry, dark)
        save_set(out, name, color, ao, normal)
        facade_density[name] = densities
        for variant, emission in enumerate(emissions):
            for lod, size in enumerate(FACADE_SIZES):
                image = emission.resize((size, size), Image.Resampling.LANCZOS)
                if lod == 2: image = image.filter(ImageFilter.GaussianBlur(0.85))
                suffix = f'v{variant}-' if variant else ''
                image.save(out / f'{name}-emission-{suffix}{lod}.webp', quality=90, method=6)
    # Painted markings and quiet river ripples need no external photo or animation.
    rng = random.Random(7)
    for name in ('paint', 'water'):
        height = Image.new('L', (512, 512))
        height.putdata([rng.randrange(110, 146) for _ in range(512 * 512)])
        if name == 'water': height = height.resize((128, 512)).resize((512, 512)).filter(ImageFilter.GaussianBlur(2))
        color = tint(height, PALETTE[name], 0.35)
        ao = Image.new('L', (512, 512), 255)
        if name == 'water': ao = ImageOps.grayscale(height).point(lambda n: 210 + n // 6)
        save_set(out, name, color, ao, normal_from_height(height))
    surface_averages(out)
    environment(out)
    street_lightmap(out)
    manifest = {'license': 'CC0-1.0', 'sources': sources, 'derived': ['facade-stone', 'facade-brick', 'facade-glass', 'facade-dark', 'roof', 'rail-steel', 'riverbed', 'paint', 'water'], 'lodSizes': list(SIZES), 'facadeLodSizes': list(FACADE_SIZES), 'litWindowFractions': facade_density, 'maps': ['albedo', 'ambient occlusion', 'OpenGL normal', 'specular RGB + glossiness alpha (1 - roughness)'], 'runtime': 'LOD0 albedo+AO+normal+specular/glossiness; LOD1/2 albedo with baked AO; all levels have mipmaps'}
    (out / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    names = list(ASSETS) + manifest['derived']
    sheet = Image.new('RGB', (5 * 192, ((len(names) + 4) // 5) * 220), '#172b30')
    for i, name in enumerate(names):
        x, y = i % 5 * 192, i // 5 * 220
        sheet.paste(Image.open(out / f'{name}-0.webp').resize((192, 192)), (x, y))
        ImageDraw.Draw(sheet).text((x + 6, y + 198), name, fill='white')
    sheet.save(out / 'palette.webp', quality=85)
    print(f'{len(names)} texture families, {sum(p.stat().st_size for p in out.glob("*.webp")) / 1024:.0f} KiB')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cache', type=Path, default=Path('/tmp/chicago-texture-sources'))
    args = parser.parse_args()
    build(args.cache, ROOT / 'public/textures/chicago')
