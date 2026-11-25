# -*- coding: utf-8 -*-
"""生成记账本应用图标（需要 Pillow，用打包的 Python 运行一次即可）。"""
import os
from PIL import Image, ImageDraw, ImageFont

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "web", "icons")
os.makedirs(OUT, exist_ok=True)

TOP = (91, 124, 250)    # #5b7cfa
BOT = (106, 91, 250)    # #6a5bfa


def make(size, path):
    grad = Image.new("RGBA", (size, size))
    gd = ImageDraw.Draw(grad)
    for y in range(size):
        t = y / max(1, size - 1)
        c = tuple(int(TOP[i] + (BOT[i] - TOP[i]) * t) for i in range(3)) + (255,)
        gd.line([(0, y), (size, y)], fill=c)
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [0, 0, size - 1, size - 1], radius=int(size * 0.22), fill=255
    )
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    img = Image.composite(grad, img, mask)
    d = ImageDraw.Draw(img)

    font = None
    for fp in (
        r"C:\Windows\Fonts\arialbd.ttf",
        r"C:\Windows\Fonts\segoeuib.ttf",
        r"C:\Windows\Fonts\arial.ttf",
    ):
        if os.path.exists(fp):
            try:
                font = ImageFont.truetype(fp, int(size * 0.50))
                break
            except OSError:
                pass
    if font is None:
        font = ImageFont.load_default()
    d.text((size / 2, size * 0.47), "¥", font=font, fill=(255, 255, 255, 255), anchor="mm")
    # 底部小横线，像账本
    lw = max(2, size // 96)
    d.rounded_rectangle(
        [size * 0.30, size * 0.76, size * 0.70, size * 0.76 + lw * 2],
        radius=lw, fill=(255, 255, 255, 200),
    )
    img.save(path)
    print("wrote", path, img.size)


make(512, os.path.join(OUT, "icon-512.png"))
make(192, os.path.join(OUT, "icon-192.png"))
make(180, os.path.join(OUT, "icon-180.png"))
