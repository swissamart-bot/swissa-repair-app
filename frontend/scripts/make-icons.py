from PIL import Image
from pathlib import Path

src = Path(r"C:\Users\Admin\.cursor\projects\c-Users-Admin-swissa-repair-app\assets\swissa-icon-master.png")
out = Path(r"C:\Users\Admin\swissa-repair-app\frontend\assets\images")
out.mkdir(parents=True, exist_ok=True)

img = Image.open(src).convert("RGBA")
w, h = img.size
side = min(w, h)
left = (w - side) // 2
top = (h - side) // 2
img = img.crop((left, top, left + side, top + side))

def save_resized(im, size, path):
    r = im.resize((size, size), Image.Resampling.LANCZOS)
    r.save(path, "PNG", optimize=True)
    print(path.name, r.size, path.stat().st_size)

save_resized(img, 1024, out / "icon.png")
save_resized(img, 1024, out / "adaptive-icon.png")
save_resized(img, 192, out / "favicon.png")

# Splash: logo centered on app light background
splash_bg = Image.new("RGBA", (1024, 1024), (250, 250, 250, 255))
logo = img.resize((640, 640), Image.Resampling.LANCZOS)
ox = (1024 - 640) // 2
oy = (1024 - 640) // 2
splash_bg.paste(logo, (ox, oy), logo)
splash_bg.save(out / "splash-image.png", "PNG", optimize=True)
print("splash-image.png", splash_bg.size, (out / "splash-image.png").stat().st_size)

img.resize((1024, 1024), Image.Resampling.LANCZOS).save(out / "swissa-icon-master.png", "PNG")
print("done")
