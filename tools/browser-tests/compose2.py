import json, numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageChops

W, H = 1920, 1080
wall = {t["id"]: t for t in json.load(open("themes.json", encoding="utf-8"))}
app = json.loads(open("/mnt/user-data/outputs/widget-calendar/src/themes.js", encoding="utf-8").read().split("=", 1)[1].strip().rstrip(";"))
HDR = dict(compact="컴팩트 막대", top="상단 막대", journal="큰 월 제목", centered="가운데 제목", minimal="미니멀 선", bottom="하단 막대", pill="알약 막대", stack="2단 헤더", rail="세로 막대")
GRID = dict(airy="여백 칸", card="카드 칸", cells="둥근 칸", tight="촘촘한 칸", soft="큰 둥근 칸", bubble="말랑한 칸", ruled="줄 노트", table="표")
CHIP = dict(bar="막대 일정", dot="점 일정", pill="알약 일정", text="글줄 일정", underline="밑줄 일정", glow="글로우 일정", outline="윤곽선 일정")
PANEL = dict(none="", hero="오늘 패널", agenda="다가오는 일정 패널", strip="카드 줄")
themes = []
for i, t in enumerate(app, 1):
    L = t["layout"]
    desc = " · ".join(x for x in [HDR[L["hdr"]], GRID[L["grid"]], CHIP[L["chip"]], PANEL[L["panel"]], "주차 열" if L["wk"] == "on" else ""] if x)
    import os
    if os.environ.get("ONLY") and t["id"] not in os.environ["ONLY"].split(","): continue
    themes.append(dict(id=t["id"], no=i, name=t["name"], mood=f'{t.get("cat","")} · {t["mood"]}', dark=t["dark"], desc=desc, wall=wall[t["id"]]["wall"]))
FONT = "/usr/share/fonts/opentype/noto/NotoSansCJK-%s.ttc"
def font(weight, size, idx=2):  # idx 2 = KR
    return ImageFont.truetype(FONT % weight, size, index=idx)

def hex2rgb(h): h = h.lstrip('#'); return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))

def wallpaper(spec):
    a, b = map(hex2rgb, spec["base"])
    t = np.linspace(0, 1, H)[:, None, None]
    # 대각선 느낌의 기본 그라데이션
    xs = np.linspace(0, 1, W)[None, :, None]
    mix = np.clip(t * 0.75 + xs * 0.25, 0, 1)
    img = (np.array(a)[None, None, :] * (1 - mix) + np.array(b)[None, None, :] * mix).astype(np.float32)
    yy, xx = np.mgrid[0:H, 0:W]
    for color, cx, cy, r in spec["blobs"]:
        c = np.array(hex2rgb(color), dtype=np.float32)
        d = np.sqrt(((xx / W - cx) * (W / H)) ** 2 + (yy / H - cy) ** 2) / r
        a_ = np.clip(1 - d, 0, 1) ** 1.6 * 0.85
        img = img * (1 - a_[..., None]) + c[None, None, :] * a_[..., None]
    out = Image.fromarray(np.clip(img, 0, 255).astype(np.uint8)).convert("RGBA")
    # 아주 약한 결 노이즈로 밴딩 방지
    noise = (np.random.RandomState(7).randn(H, W) * 2.2).astype(np.int16)
    arr = np.array(out).astype(np.int16)
    arr[..., :3] = np.clip(arr[..., :3] + noise[..., None], 0, 255)
    return Image.fromarray(arr.astype(np.uint8))

def rounded_shadow(canvas, box, radius, blur=28, alpha=110, offset=(0, 14)):
    x0, y0, x1, y1 = box
    sh = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    ImageDraw.Draw(sh).rounded_rectangle((x0 + offset[0], y0 + offset[1], x1 + offset[0], y1 + offset[1]), radius, fill=(0, 0, 0, alpha))
    return Image.alpha_composite(canvas, sh.filter(ImageFilter.GaussianBlur(blur)))

def taskbar(canvas, dark):
    d = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    dr = ImageDraw.Draw(d)
    bar = (0, H - 58, W, H)
    dr.rectangle(bar, fill=(20, 20, 24, 150) if dark else (245, 245, 248, 170))
    icon = (255, 255, 255, 120) if dark else (40, 44, 52, 110)
    cx = W // 2 - 5 * 26
    for i in range(6):
        x = cx + i * 52
        dr.rounded_rectangle((x, H - 44, x + 28, H - 16), 7, fill=icon if i else (90, 160, 255, 200))
    return Image.alpha_composite(canvas, d)

def pill_label(canvas, t):
    dark_wall = t["dark"]
    d = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    dr = ImageDraw.Draw(d)
    f1, f2, f3, f4 = font("Bold", 46), font("Regular", 25), font("Bold", 30), font("Regular", 22)
    num, name, mood = f"{t['no']:02d}", t["name"], t["mood"]
    x, y = 110, 30
    w1 = int(dr.textlength(num, font=f3) + 22 + dr.textlength(name, font=f1) + 26 + dr.textlength(mood, font=f2) + 56)
    w = max(w1, int(dr.textlength(t["desc"], font=f4) + 56))
    fill = (12, 14, 20, 125) if dark_wall else (255, 255, 255, 160)
    dr.rounded_rectangle((x, y, x + w, y + 98), 30, fill=fill)
    tc = (255, 255, 255, 255) if dark_wall else (24, 28, 36, 255)
    sc = (255, 255, 255, 195) if dark_wall else (24, 28, 36, 185)
    tx = x + 28
    dr.text((tx, y + 36), num, font=f3, fill=sc, anchor="lm"); tx += dr.textlength(num, font=f3) + 22
    dr.text((tx, y + 34), name, font=f1, fill=tc, anchor="lm"); tx += dr.textlength(name, font=f1) + 26
    dr.text((tx, y + 37), mood, font=f2, fill=sc, anchor="lm")
    dr.text((x + 28, y + 76), t["desc"], font=f4, fill=sc, anchor="lm")
    return Image.alpha_composite(canvas, d)


for t in themes:
    canvas = wallpaper(t["wall"])
    canvas = taskbar(canvas, t["dark"])
    wid = Image.open(f"theme_raw/{t['id']}_widget.png").convert("RGBA")
    det = Image.open(f"theme_raw/{t['id']}_detail.png").convert("RGBA")
    toast = Image.open(f"theme_raw/{t['id']}_toast.png").convert("RGBA")
    wx, wy = 110, 150
    dx, dy = wx + wid.width + 70, 215
    mask = Image.new("L", det.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, det.width, det.height), 18, fill=255)
    det.putalpha(mask)
    canvas = rounded_shadow(canvas, (wx, wy, wx + wid.width, wy + wid.height), 22, alpha=90)
    canvas = rounded_shadow(canvas, (dx, dy, dx + det.width, dy + det.height), 18, alpha=120)
    canvas.alpha_composite(wid, (wx, wy))
    canvas.alpha_composite(det, (dx, dy))
    tx, ty = W - toast.width - 56, 28
    canvas.alpha_composite(toast, (tx, ty))
    canvas = pill_label(canvas, t)
    out = canvas.convert("RGB")
    out.save(f"./out/themes/theme-{t['no']:02d}-{t['id']}.png", optimize=True)
    print(t["no"], t["id"], "|", t["desc"], "| right", dx + det.width, "bottom", max(wy + wid.height, dy + det.height))
