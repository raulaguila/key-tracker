"""Regenerate the packaged PNG from the matching vector geometry (Pillow)."""
from pathlib import Path
from PIL import Image, ImageDraw

image = Image.new('RGBA', (1024, 1024))
draw = ImageDraw.Draw(image)
draw.rounded_rectangle((0, 0, 1023, 1023), radius=208, fill='#9e2867')
draw.rounded_rectangle((208, 160, 816, 768), radius=80, outline='white', width=48)
draw.line((224, 852, 800, 852), fill='white', width=48)
draw.line((412, 308, 412, 628), fill='white', width=48)
draw.line((616, 308, 412, 468, 616, 628), fill='white', width=48, joint='curve')
image.resize((512, 512), Image.Resampling.LANCZOS).save(Path(__file__).resolve().parents[1] / 'app/assets/icon.png')
