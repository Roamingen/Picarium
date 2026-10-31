"""生成 StickerBox 图标（无需外部素材）：圆角渐变底 + 白色对话气泡 + 三点。"""
from PIL import Image, ImageDraw

S = 1024
img = Image.new("RGBA", (S, S), (0, 0, 0, 0))

# 垂直渐变
grad = Image.new("RGBA", (S, S))
gd = ImageDraw.Draw(grad)
top = (76, 125, 240)
bottom = (124, 92, 255)
for y in range(S):
    t = y / (S - 1)
    grad.paste(
        (int(top[0] + (bottom[0] - top[0]) * t),
         int(top[1] + (bottom[1] - top[1]) * t),
         int(top[2] + (bottom[2] - top[2]) * t),
         255),
        (0, y, S, y + 1),
    )

# 圆角遮罩
mask = Image.new("L", (S, S), 0)
md = ImageDraw.Draw(mask)
md.rounded_rectangle([0, 0, S - 1, S - 1], radius=230, fill=255)
img.paste(grad, (0, 0), mask)

# 对话气泡
d = ImageDraw.Draw(img)
bubble = [210, 250, 814, 690]
d.rounded_rectangle(bubble, radius=140, fill=(255, 255, 255, 255))
d.polygon([(330, 660), (330, 800), (470, 680)], fill=(255, 255, 255, 255))

# 三个点
r = 46
for cx in (380, 512, 644):
    d.ellipse([cx - r, 470 - r, cx + r, 470 + r], fill=(86, 106, 220, 255))

img.save("src-tauri/icons/icon.png")
img.resize((256, 256), Image.LANCZOS).save(
    "src-tauri/icons/icon.ico",
    sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
)
print("icons written")
