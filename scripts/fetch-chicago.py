"""Fetch a bounded OSM snapshot, split to respect the official map API node limit."""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.request import Request, urlopen
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
BBOX = (-87.642, 41.877, -87.6195, 41.8915)

def fetch(cell):
    x, y = cell
    west, south, east, north = BBOX
    dx, dy = (east-west)/3, (north-south)/3
    bbox = f'{west+x*dx},{south+y*dy},{west+(x+1)*dx},{south+(y+1)*dy}'
    path = ROOT / f'data/chicago/osm-{x}-{y}.xml'
    if not path.exists():
        request = Request(f'https://api.openstreetmap.org/api/0.6/map?bbox={bbox}', headers={'User-Agent':'BlockDistrict-local-map-prototype/1.0'})
        with urlopen(request, timeout=60) as response:
            payload = response.read()
        ET.fromstring(payload)
        path.write_bytes(payload)
    print(path.name, path.stat().st_size, flush=True)

if __name__ == '__main__':
    (ROOT/'data/chicago').mkdir(parents=True, exist_ok=True)
    with ThreadPoolExecutor(max_workers=2) as pool:
        list(pool.map(fetch, [(x,y) for x in range(3) for y in range(3)]))

    for relation in [13462125, 13730103, 3485552]:
        path = ROOT / f'data/chicago/river-{relation}.xml'
        if not path.exists():
            request = Request(f'https://api.openstreetmap.org/api/0.6/relation/{relation}/full', headers={'User-Agent':'BlockDistrict-local-map-prototype/1.0'})
            with urlopen(request, timeout=60) as response:
                payload = response.read()
            ET.fromstring(payload)
            path.write_bytes(payload)
        print(path.name, path.stat().st_size, flush=True)

    import subprocess, sys
    subprocess.run([sys.executable, str(ROOT/'scripts/pack-chicago.py')], check=True)
