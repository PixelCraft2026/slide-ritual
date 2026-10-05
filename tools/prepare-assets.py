from pathlib import Path
from urllib.request import urlopen, Request
from concurrent.futures import ThreadPoolExecutor
from PIL import Image
import io, runpy

root = Path(__file__).resolve().parent.parent
photos = [
    ('alpine', 'photo-1464822759023-fed622ff2c3b'),
    ('woodland', 'photo-1472396961693-142e6e269027'),
    ('evening', 'photo-1500534623283-312aade485b7'),
]
def fetch(item):
    name, photo = item
    url = f'https://images.unsplash.com/{photo}?auto=format&fit=crop&w=1800&q=88'
    data = urlopen(Request(url, headers={'User-Agent':'SlideProjector/1.0'}), timeout=25).read()
    image = Image.open(io.BytesIO(data)).convert('RGB')
    image.save(root / 'assets' / f'{name}.jpg', quality=92)
    print(name, image.size, flush=True)
with ThreadPoolExecutor(max_workers=3) as pool:
    list(pool.map(fetch, photos))

# Keep asset regeneration consistent with the stationary v2.2 background bed.
runpy.run_path(str(root / 'tools' / 'prepare-fan.py'))
