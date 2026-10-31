"""生成用于验收的示例表情（纯本地绘制，不读任何用户数据）。"""
import os
import sys

from PIL import Image, ImageDraw

out = sys.argv[1] if len(sys.argv) > 1 else "accept-samples"
count = int(sys.argv[2]) if len(sys.argv) > 2 else 6
os.makedirs(out, exist_ok=True)

colors = [
    (255, 214, 102, 255),
    (167, 216, 255, 255),
    (255, 175, 189, 255),
    (183, 235, 190, 255),
    (214, 188, 255, 255),
    (255, 205, 165, 255),
]

for i in range(count):
    size = 128
    color = colors[i % len(colors)]
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([4, 4, size - 4, size - 4], radius=22, fill=color)
    d.text((size // 2 - 12, size // 2 - 10), str(i + 1), fill=(30, 30, 30, 255))
    img.save(os.path.join(out, f"accept-{i + 1}.png"))

# 一张动图，用来验证 GIF 格式筛选
frames = []
for i, color in enumerate(colors[:3]):
    f = Image.new("RGBA", (128, 128), color)
    d = ImageDraw.Draw(f)
    d.text((10, 10), f"gif{i+1}", fill=(20, 20, 20, 255))
    frames.append(f.convert("P", palette=Image.ADAPTIVE))
frames[0].save(
    os.path.join(out, "accept-gif.gif"),
    save_all=True,
    append_images=frames[1:],
    duration=120,
    loop=0,
)

print(os.path.abspath(out))
