import json, re, sys, numpy as np
from PIL import Image
import glob
meta = [m for f in sorted(glob.glob("audit/meta_*.json")) for m in json.load(open(f))]
def lum(rgb):
    c = rgb / 255.0
    c = np.where(c <= 0.03928, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    return 0.2126 * c[..., 0] + 0.7152 * c[..., 1] + 0.0722 * c[..., 2]
def parse(c):
    v = [float(x) for x in re.findall(r"[\d.]+", c)]
    if c.startswith("color(srgb"):
        v = [x * 255 for x in v[:3]] + v[3:]
    return np.array(v[:3]), (v[3] if len(v) > 3 else 1.0)
fails = {}; worst = {}
for m in meta:
    bg = np.array(Image.open(f"audit/{m['name']}_bg.png").convert("RGB")).astype(np.float64)
    H, W, _ = bg.shape
    for r in m["rects"]:
        x0, y0 = max(0, int(r["x"])), max(0, int(r["y"])); x1, y1 = min(W, int(r["x"] + r["w"]) + 1), min(H, int(r["y"] + r["h"]) + 1)
        if x1 - x0 < 2 or y1 - y0 < 2: continue
        band = max(1, int((y1 - y0) * 0.25))
        reg = bg[y0 + band:y1 - band, x0:x1] if y1 - y0 > 4 else bg[y0:y1, x0:x1]
        col, a = parse(r["color"])
        Lb = lum(reg)
        # 글자색을 (배경 평균 위에) 합성한 실제 색으로
        eff = col * a + reg.reshape(-1, 3).mean(axis=0) * (1 - a)
        Lt = float(lum(eff))
        ratio = (np.maximum(Lt, Lb) + 0.05) / (np.minimum(Lt, Lb) + 0.05)
        c = float(np.percentile(ratio, 15))         # 글자 중앙 띠에서 배경이 불리한 15% 지점 기준
        big = r["size"] >= 18 or (r["size"] >= 14 and r["weight"] >= 700)
        need = 3.0 if big else 4.5
        key = m["name"]
        worst.setdefault(m["theme"], []).append(c)
        if c < need:
            fails.setdefault(m["theme"], []).append((round(c, 2), need, key.split("_", 1)[1], r["text"] + " <" + r.get("cls", "")[:34] + ">", round(r["size"])))
for t in dict.fromkeys(x["theme"] for x in meta):
    w = worst.get(t, [])
    f = fails.get(t, [])
    print(f"{t:9s} 검사 {len(w):3d}개  최저 {min(w):.2f}  미달 {len(f)}개")
    seen = set()
    for c, need, where, text, size in sorted(f)[:8]:
        k = (where, text)
        if k in seen: continue
        seen.add(k); print(f"    {c:>5} < {need}  [{where}] '{text}' {size}px")

# 디버그: 한지 주 보기의 '28'
for m in meta:
    if m["name"] == "hanji_week_white":
        bg = np.array(Image.open(f"audit/{m['name']}_bg.png").convert("RGB"))
        for r in m["rects"]:
            if r["text"] == "28":
                x, y = int(r["x"] + r["w"] / 2), int(r["y"] + r["h"] / 2)
                print("DEBUG '28':", r["color"], "size", r["size"], "bg pixel", bg[y, x], "rect", [round(r[k]) for k in "xywh"])
