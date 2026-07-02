# Generates the Launchpad icon set — a white rocket lifting off on a blue
# gradient rounded square. Rendered 1024px and downscaled for anti-aliasing.
#   icon.ico            multi-size exe/window/tray icon
#   public/icon-64.png  favicon / titlebar
from PIL import Image, ImageDraw, ImageFilter

S = 1024
CX = S // 2

BLUE_TOP = (80, 145, 255)
BLUE_BOTTOM = (23, 68, 210)
WHITE = (255, 255, 255, 255)
PORTHOLE = (27, 78, 222, 255)
FLAME_OUT = (251, 146, 60, 255)    # orange
FLAME_IN = (253, 224, 71, 255)     # yellow

img = Image.new("RGBA", (S, S), (0, 0, 0, 0))

# --- plate: rounded square, vertical gradient, soft top-left highlight
radius = int(S * 0.225)
mask = Image.new("L", (S, S), 0)
ImageDraw.Draw(mask).rounded_rectangle([0, 0, S - 1, S - 1], radius=radius, fill=255)
grad = Image.new("RGBA", (S, S))
gd = ImageDraw.Draw(grad)
for y in range(S):
    t = y / (S - 1)
    c = tuple(int(a + (b - a) * t) for a, b in zip(BLUE_TOP, BLUE_BOTTOM)) + (255,)
    gd.line([(0, y), (S, y)], fill=c)
hl = Image.new("L", (S, S), 0)
ImageDraw.Draw(hl).ellipse([-S * 0.35, -S * 0.45, S * 0.75, S * 0.45], fill=46)
hl = hl.filter(ImageFilter.GaussianBlur(90))
grad.paste((255, 255, 255, 255), (0, 0), hl)
img.paste(grad, (0, 0), mask)

d = ImageDraw.Draw(img)

# --- rocket (white), nudged up to leave room for the flame
top = 148          # nose tip
bw = 105           # half body width
shoulder = 400     # where nose curve meets straight body
bottom = 665       # body bottom

# body: pointed nose blended into a straight body with a rounded bottom
d.polygon([(CX, top), (CX + bw, shoulder), (CX - bw, shoulder)], fill=WHITE)
d.ellipse([CX - bw, top + 120, CX + bw, shoulder + 130], fill=WHITE)  # soften nose->body
d.rounded_rectangle([CX - bw, shoulder - 40, CX + bw, bottom], radius=48, fill=WHITE)

# fins
d.polygon([(CX - bw + 6, 500), (CX - bw - 92, bottom + 6), (CX - bw + 6, bottom + 6)], fill=WHITE)
d.polygon([(CX + bw - 6, 500), (CX + bw + 92, bottom + 6), (CX + bw - 6, bottom + 6)], fill=WHITE)

# porthole
pr = 62
d.ellipse([CX - pr, 400 - pr, CX + pr, 400 + pr], fill=PORTHOLE)

# --- flame
d.polygon([(CX - 52, bottom + 26), (CX + 52, bottom + 26), (CX, bottom + 200)], fill=FLAME_OUT)
d.ellipse([CX - 52, bottom + 2, CX + 52, bottom + 78], fill=FLAME_OUT)
d.polygon([(CX - 26, bottom + 30), (CX + 26, bottom + 30), (CX, bottom + 128)], fill=FLAME_IN)
d.ellipse([CX - 26, bottom + 10, CX + 26, bottom + 56], fill=FLAME_IN)

# --- exports
sizes = [16, 24, 32, 48, 64, 128, 256]
img.save("icon.ico", sizes=[(s, s) for s in sizes])
img.resize((64, 64), Image.LANCZOS).save("public/icon-64.png")
img.resize((256, 256), Image.LANCZOS).save("icon-256.png")
print("icon.ico + public/icon-64.png + icon-256.png written")
