"""生成演示用示例表情（不读任何人的聊天数据）。"""
import os, random
from PIL import Image, ImageDraw, ImageFont

OUT = "sample"
os.makedirs(OUT, exist_ok=True)

TEXTS = ["无语", "好耶", "在吗", "收到", "裂开", "笑死",
         "摸鱼", "上班", "晚安", "救命", "就这", "冲"]
COLORS = [(255, 214, 102), (167, 216, 255), (255, 175, 189), (183, 235, 190),
          (214, 188, 255), (255, 205, 165)]

font_path = r"C:\Windows\Fonts\msyh.ttc"
font = ImageFont.truetype(font_path, 110)
small = ImageFont.truetype(font_path, 34)

for i, text in enumerate(TEXTS):
    S = 320
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    bg = COLORS[i % len(COLORS)]
    d.rounded_rectangle([8, 8, S - 8, S - 8], radius=56, fill=bg + (255,))
    d.rounded_rectangle([8, 8, S - 8, S - 8], radius=56, outline=(0, 0, 0, 40), width=3)
    box = d.textbbox((0, 0), text, font=font)
    w, h = box[2] - box[0], box[3] - box[1]
    d.text(((S - w) / 2 - box[0], (S - h) / 2 - box[1] - 10), text, font=font, fill=(35, 38, 48, 255))
    d.text((26, S - 46), f"sample-{i+1:02d}", font=small, fill=(35, 38, 48, 120))
    img.save(os.path.join(OUT, f"sample-{i+1:02d}-{text}.png"))

print("samples:", len(TEXTS))
