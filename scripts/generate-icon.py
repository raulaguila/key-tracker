"""Render Dobra's code-native icon geometry to the packaged PNG using Pillow."""
from pathlib import Path
from PIL import Image, ImageDraw

SCALE = 8
image = Image.new('RGBA', (128 * SCALE, 128 * SCALE))
draw = ImageDraw.Draw(image)
draw.rounded_rectangle((0, 0, 128 * SCALE - 1, 128 * SCALE - 1), radius=29 * SCALE, fill='#A94320')


def point(x, y):
    return ((20 + x * 1.375) * SCALE, (20 + y * 1.375) * SCALE)


def curve(start, first, second, end):
    return [point((1 - t) ** 3 * start[0] + 3 * (1 - t) ** 2 * t * first[0] + 3 * (1 - t) * t ** 2 * second[0] + t ** 3 * end[0],
                  (1 - t) ** 3 * start[1] + 3 * (1 - t) ** 2 * t * first[1] + 3 * (1 - t) * t ** 2 * second[1] + t ** 3 * end[1])
            for t in [i / 24 for i in range(25)]]


# Matching app/assets/icon.svg, with a punched-out counter and a translucent fold.
body = [point(10, 6), point(33, 6), point(33, 28), point(55, 28), point(55, 43)]
body += curve((55, 43), (55, 52), (49, 58), (40, 58)) + [point(10, 58)]
draw.polygon(body, fill='white')
counter = [point(23, 22), point(23, 45), point(37, 45)]
counter += curve((37, 45), (41, 45), (43, 43), (43, 39)) + [point(43, 31), point(34, 22)]
draw.polygon(counter, fill='#A94320')
draw.polygon([point(33, 6), point(33, 28), point(55, 28)], fill=(202, 138, 117, 255))
image.resize((512, 512), Image.Resampling.LANCZOS).save(Path(__file__).resolve().parents[1] / 'app/assets/icon.png')
