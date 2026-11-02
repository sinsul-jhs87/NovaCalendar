# 테마 생성기: src/themes.css 와 src/themes.js 를 만든다.
# 실행: 프로젝트 맨 위 폴더에서  python tools/theme-gen/gen_themes.py
# 테마를 고치거나 추가하려면 이 파일의 theme(...) 정의를 고친 뒤 다시 실행한다.
# 일요일·토요일 색의 테마별 목표 대비(실측값 기반)는 sunsat_target.json 에 있다.
import os as __os
__os.chdir(__os.path.abspath(__os.path.join(__os.path.dirname(__os.path.abspath(__file__)), "..", "..")))
import json, random, math
from urllib.parse import quote

OUT = "src"

def uri(svg):
    return 'url("data:image/svg+xml,' + quote(svg, safe=" /:=,.;-_()'!*") + '")'

def svg(inner, defs="", w=600, h=560):
    return uri(f"<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 {w} {h}' preserveAspectRatio='xMidYMid slice'>{defs}{inner}</svg>")

def stars(seed, n=70, h=560, color="white", maxy=0.92):
    r = random.Random(seed); o = []
    for _ in range(n):
        x, y = r.uniform(0, 600), r.uniform(0, h * maxy)
        o.append(f"<circle cx='{x:.0f}' cy='{y:.0f}' r='{r.choice([.6,.8,1,1.2,1.6])}' fill='{color}' fill-opacity='{r.uniform(.3,.9):.2f}'/>")
    return "".join(o)

LEAF = "M0,-12 L3,-6 L9,-8 L6,-1 L11,2 L4,3 L5,10 L0,6 L-5,10 L-4,3 L-11,2 L-6,-1 L-9,-8 L-3,-6 Z"
def leaves(seed, n, colors, smin=1.0, smax=2.6):
    r = random.Random(seed); o = []
    for _ in range(n):
        x, y = r.uniform(10, 590), r.uniform(10, 550)
        o.append(f"<path d='{LEAF}' transform='translate({x:.0f} {y:.0f}) rotate({r.uniform(0,360):.0f}) scale({r.uniform(smin,smax):.2f})' fill='{r.choice(colors)}' fill-opacity='{r.uniform(.12,.26):.2f}'/>")
    return "".join(o)

PETAL = "M0,0 C7,-10 20,-8 18,3 C15,13 3,14 0,0 Z"
def petals(seed, n, colors):
    r = random.Random(seed); o = []
    for _ in range(n):
        x, y = r.uniform(10, 590), r.uniform(10, 550)
        o.append(f"<path d='{PETAL}' transform='translate({x:.0f} {y:.0f}) rotate({r.uniform(0,360):.0f}) scale({r.uniform(.9,2.2):.2f})' fill='{r.choice(colors)}' fill-opacity='{r.uniform(.16,.34):.2f}'/>")
    return "".join(o)

def pines(seed, base, color, op, hmax, step):
    r = random.Random(seed); o = []; x = -10
    while x < 620:
        hh = r.uniform(hmax * .6, hmax); ww = hh * .42
        pts = f"{x:.0f},{base} {x+ww/2:.0f},{base-hh:.0f} {x+ww:.0f},{base}"
        o.append(f"<polygon points='{pts}' fill='{color}' fill-opacity='{op}'/>")
        x += r.uniform(step * .7, step * 1.2)
    return "".join(o)

def wave(y, amp, fill, op, phase=0, h=560):
    pts = [f"M0,{h}", f"L0,{y}"]
    for i in range(0, 13):
        x = i * 50
        pts.append(f"L{x},{y + amp * math.sin(i * 0.9 + phase):.1f}")
    pts += [f"L600,{h}", "Z"]
    return f"<path d='{' '.join(pts)}' fill='{fill}' fill-opacity='{op}'/>"


# ── 글자색 자동 보정: 색상은 유지하고 배경(panel)과의 대비가 목표 이상이 되도록 한쪽으로 밀어 준다 ──
def _rgb(h): h = h.lstrip('#'); return [int(h[i:i+2], 16) for i in (0, 2, 4)]
def _hex(c): return '#%02x%02x%02x' % tuple(max(0, min(255, round(v))) for v in c)
def _lum(c):
    f = lambda v: (v/255/12.92) if v/255 <= 0.03928 else (((v/255)+0.055)/1.055) ** 2.4
    r, g, b = map(f, c); return 0.2126*r + 0.7152*g + 0.0722*b
def _cr(a, b):
    la, lb = sorted([_lum(a), _lum(b)], reverse=True); return (la+0.05)/(lb+0.05)
def push(color, panel, target, toward):
    c, p, t_ = _rgb(color), _rgb(panel), _rgb(toward)
    for i in range(0, 101):
        k = i / 100
        cand = [c[j]*(1-k) + t_[j]*k for j in range(3)]
        if _cr(cand, p) >= target: return _hex(cand)
    return toward
import colorsys as _cs
import math

def _mix(a, b, k):
    return [a[j] * (1 - k) + b[j] * k for j in range(3)]

def _lab(c):
    f = lambda v: (v / 255 / 12.92) if v / 255 <= 0.04045 else (((v / 255) + 0.055) / 1.055) ** 2.4
    r, g, b = map(f, c)
    X = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047; Y = 0.2126 * r + 0.7152 * g + 0.0722 * b; Z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883
    t = lambda v: v ** (1 / 3) if v > 0.008856 else 7.787 * v + 16 / 116
    return (116 * t(Y) - 16, 500 * (t(X) - t(Y)), 200 * (t(Y) - t(Z)))

def vivid(color, panel, ink, dark, spread, target=4.8):
    """일요일·토요일 색: 색상은 원래 색 근처(±spread도)에서, 채도는 높게 유지하고 밝기만 조절해
    바탕과 '바탕화면이 비치는 최악의 바탕'(투명도 85%에서 흰/검은 바탕화면이 15% 섞인 색) 모두에 target 이상이면서
    본문 글자와 가장 잘 구분되는(색차가 큰) 색을 고른다. 못 찾으면 None."""
    c, p, ik = _rgb(color), _rgb(panel), _rgb(ink)
    worst = _mix(p, [255, 255, 255] if dark else [0, 0, 0], 0.15)
    h0, l0, s0 = _cs.rgb_to_hls(*[v / 255 for v in c])
    best = None
    for dh in range(-spread, spread + 1, 3):
        h = (h0 + dh / 360) % 1
        for s in (1.0, 0.9, 0.8):
            steps = [l0 + i * 0.004 for i in range(0, 251)] if dark else [l0 - i * 0.004 for i in range(0, 251)]
            for L in steps:
                if not (0 <= L <= 1): break
                cand = [v * 255 for v in _cs.hls_to_rgb(h, L, s)]
                if _cr(cand, p) >= target and _cr(cand, worst) >= target:
                    score = math.dist(_lab(cand), _lab(ik)) - abs(dh) * 0.15   # 본문과의 색차 우선, 원래 색상에서 멀어질수록 약간 감점
                    if best is None or score > best[0]: best = (score, _hex(cand))
                    break
    return best[1] if best else None

def vivid_min(color, panel, dark, target=4.8):
    """1단계: 원래 디자인한 색상을 그대로 두고(채도는 0.75 이상) 밝기만 최소한으로 바꿔 대비를 맞춘다."""
    c, p = _rgb(color), _rgb(panel)
    worst = _mix(p, [255, 255, 255] if dark else [0, 0, 0], 0.15)
    h, l, s = _cs.rgb_to_hls(*[v / 255 for v in c])
    s = max(s, 0.75)
    steps = [l + i * 0.004 for i in range(0, 251)] if dark else [l - i * 0.004 for i in range(0, 251)]
    for L in steps:
        if not (0 <= L <= 1): break
        cand = [v * 255 for v in _cs.hls_to_rgb(h, L, s)]
        if _cr(cand, p) >= target and _cr(cand, worst) >= target:
            return _hex(cand)
    return None

import json as _json, os as _os
# 실측(배경 그림·칸 바탕까지 겹친 실제 화면)에서 여유가 필요했던 테마는 주말 색 목표 대비를 높인다
SUNSAT_TARGET = _json.load(open(_os.path.join(_os.path.dirname(_os.path.abspath(__file__)), 'sunsat_target.json'))) if _os.path.exists(_os.path.join(_os.path.dirname(_os.path.abspath(__file__)), 'sunsat_target.json')) else {}

def tune(pal, dark, tid=None):
    ext = '#ffffff' if dark else '#000000'
    pal['muted'] = push(pal['muted'], pal['panel'], 12.5 if dark else 10.0, pal['ink'])
    for k, spread in (('sun', 12), ('sat', 45)):
        # 1단계: 디자인한 색상 그대로 밝기만 조절
        # 색감이 먼저: 본문 글자와 확실히 구분되는 범위(색차 30 이상) 안에서 대비를 최대로 올린다.
        cap = SUNSAT_TARGET.get(tid, 4.8)
        tgt, v = 4.8, None
        t_ = cap
        while t_ >= 4.8 - 1e-9:
            cand = vivid_min(pal[k], pal['panel'], dark, t_)
            if cand and math.dist(_lab(_rgb(cand)), _lab(_rgb(pal['ink']))) >= 30:
                tgt, v = t_, cand
                break
            t_ = round(t_ - 0.1, 2)
        if v is None:
            v = vivid_min(pal[k], pal['panel'], dark, 4.8)
            # 중간 톤 어두운 바탕: 극단 조건(흰 바탕화면) 기준을 4.0까지만 낮춰 색감을 살린다(위젯 바탕 위 대비는 그대로 높음)
            t_ = 4.6
            while v is not None and math.dist(_lab(_rgb(v)), _lab(_rgb(pal['ink']))) < 30 and t_ >= 4.0 - 1e-9:
                cand = vivid_min(pal[k], pal['panel'], dark, t_)
                if cand: v = cand
                t_ = round(t_ - 0.1, 2)
        # 2단계: 본문 글자와 구분이 잘 안 되면(색차 25 미만) 색상을 조금 움직여 가장 잘 구분되는 색으로
        if not v or math.dist(_lab(_rgb(v)), _lab(_rgb(pal['ink']))) < 25:
            v = vivid(pal[k], pal['panel'], pal['ink'], dark, spread, tgt) or v
        # 그래도 없으면(중간 톤 바탕) 기준을 조금 낮춰 색감을 지킨다(바탕 대비는 4.0 이상)
        pal[k] = v or vivid(pal[k], pal['panel'], pal['ink'], dark, spread, 4.0) or push(pal[k], pal['panel'], 4.5, ext)
    return pal

# ── 팔레트 + 레이아웃 + 배경 ─────────────────────────────────────────
T = []

def theme(id, name, mood, dark, pal, layout, art, size=None, font=None, pos=None, repeat=None):
    T.append(dict(id=id, name=name, mood=mood, dark=dark, pal=tune(dict(pal), dark, id), layout=layout, art=art, size=size, font=font, pos=pos, repeat=repeat))

dk = lambda r: dict(line=f"rgba({r}, 0.09)", cell=f"rgba({r}, 0.04)", cellHover=f"rgba({r}, 0.08)", stripe=f"rgba({r}, 0.07)")
lt = lambda r: dict(line=f"rgba({r}, 0.13)", cell=f"rgba({r}, 0.04)", cellHover=f"rgba({r}, 0.085)", stripe=f"rgba({r}, 0.09)")

# 1 미드나잇
theme("midnight", "미드나잇", "깊은 밤하늘", True,
  dict(panel="#1a1d26", ink="#e8ebf3", muted="#8b93a7", accent="#6ea8ff", onAccent="#0b1020", sun="#ff7a85", sat="#7fb2ff", **dk("255, 255, 255")),
  dict(hdr="top", grid="cells", chip="bar", panel="none", num="left", wk="off"),
  ["radial-gradient(420px 300px at 88% 0%, rgba(110,168,255,.20), transparent 70%)",
   "radial-gradient(380px 300px at 0% 100%, rgba(123,77,214,.20), transparent 70%)",
   svg(stars(11))])

# 2 단풍
theme("maple", "단풍", "가을 일기장", True,
  dict(panel="#261a1c", ink="#f4e8e1", muted="#ab948b", accent="#f0a14e", onAccent="#2a1405", sun="#ff8d7c", sat="#9cc2ee", **dk("255, 232, 214")),
  dict(hdr="journal", grid="ruled", chip="dot", panel="none", num="right", wk="off"),
  ["radial-gradient(520px 360px at 100% 100%, rgba(232,116,42,.22), transparent 70%)",
   "radial-gradient(300px 220px at 0% 0%, rgba(183,50,44,.18), transparent 70%)",
   svg(leaves(5, 12, ["#f0a14e", "#e8742a", "#b7322c", "#f2c14a"]))])

# 3 숲
theme("forest", "숲", "이끼 낀 숲길", True,
  dict(panel="#15231c", ink="#e4f0e8", muted="#8fa89a", accent="#7fd8a6", onAccent="#072115", sun="#ff9088", sat="#8cc6ff", **dk("214, 255, 232")),
  dict(hdr="top", grid="tight", chip="bar", panel="agenda", num="left", wk="off"),
  ["linear-gradient(to top, rgba(127,216,166,.12), transparent 42%)",
   "radial-gradient(360px 260px at 90% 0%, rgba(47,166,106,.20), transparent 70%)",
   svg(pines(3, 560, "#2c6a4c", .50, 150, 26) + pines(4, 560, "#1c4a35", .60, 110, 22) + pines(9, 560, "#10301f", .70, 78, 18)
       + "".join(f"<circle cx='{random.Random(i).uniform(20,580):.0f}' cy='{random.Random(i+50).uniform(300,520):.0f}' r='1.8' fill='#d8ff9a' fill-opacity='.7'/>" for i in range(9)))])

# 4 라벤더
theme("lavender", "라벤더", "해질녘 보랏빛", True,
  dict(panel="#211c33", ink="#eeeafb", muted="#9d96bb", accent="#b49cff", onAccent="#170f33", sun="#ff88aa", sat="#88b8ff", **dk("230, 222, 255")),
  dict(hdr="centered", grid="bubble", chip="pill", panel="none", num="circle", wk="off"),
  ["radial-gradient(420px 320px at 0% 0%, rgba(180,156,255,.24), transparent 70%)",
   "radial-gradient(360px 260px at 100% 40%, rgba(255,136,170,.14), transparent 70%)",
   svg(wave(430, 18, "#b49cff", .10) + wave(470, 14, "#ff88aa", .09, 1.4) + wave(510, 10, "#88b8ff", .12, 2.6) + stars(21, 24, maxy=.5))])

# 5 그래파이트
theme("graphite", "그래파이트", "도면 위의 모눈", True,
  dict(panel="#171717", ink="#f1f1f1", muted="#909090", accent="#f1f1f1", onAccent="#111111", sun="#ff7070", sat="#84adff", **dk("255, 255, 255")),
  dict(hdr="minimal", grid="table", chip="text", panel="none", num="left", wk="off"),
  ["radial-gradient(rgba(255,255,255,.075) 1px, transparent 1.3px)",
   "linear-gradient(160deg, rgba(255,255,255,.05), transparent 45%)"],
  size="18px 18px, cover")

# 6 오로라
aur = ("<defs><linearGradient id='a' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='#4fe0c0' stop-opacity='.24'/><stop offset='1' stop-color='#4fe0c0' stop-opacity='0'/></linearGradient>"
       "<linearGradient id='b' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='#ff82b0' stop-opacity='.18'/><stop offset='1' stop-color='#ff82b0' stop-opacity='0'/></linearGradient>"
       "<linearGradient id='c' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='#78bcff' stop-opacity='.16'/><stop offset='1' stop-color='#78bcff' stop-opacity='0'/></linearGradient>"
       "<filter id='f'><feGaussianBlur stdDeviation='16'/></filter></defs>")
aur_body = ("<g filter='url(#f)'><path d='M-20,60 C140,-20 300,170 640,40 L640,230 C420,320 220,180 -20,280Z' fill='url(#a)'/>"
            "<path d='M-20,170 C160,90 330,260 640,150 L640,330 C430,400 230,280 -20,380Z' fill='url(#b)'/>"
            "<path d='M-20,300 C150,230 330,380 640,260 L640,440 C440,500 240,400 -20,470Z' fill='url(#c)'/></g>")
theme("aurora", "오로라", "북극의 밤", True,
  dict(panel="#0f1c25", ink="#e5f4f3", muted="#88a6ab", accent="#4fe0c0", onAccent="#04211b", sun="#ff82b0", sat="#78bcff", **dk("200, 255, 245")),
  dict(hdr="top", grid="soft", chip="glow", panel="hero", num="left", wk="off"),
  [svg(aur_body + stars(33, 50, maxy=.7), defs=aur)])

# 7 한지
paper = ("<defs><filter id='n' x='0' y='0' width='100%' height='100%'><feTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='2' seed='3'/>"
         "<feColorMatrix values='0 0 0 0 .36  0 0 0 0 .30  0 0 0 0 .22  0 0 0 .20 0'/></filter></defs>"
         "<rect width='100%' height='100%' filter='url(#n)'/>"
         "<circle cx='500' cy='450' r='74' fill='none' stroke='#2c4a7c' stroke-width='11' stroke-opacity='.075' stroke-dasharray='400 70' stroke-linecap='round' transform='rotate(-30 500 450)'/>")
theme("hanji", "한지", "먹과 종이", False,
  dict(panel="#f0eeea", ink="#23262e", muted="#5f636d", accent="#2c4a7c", onAccent="#ffffff", sun="#b0303a", sat="#2a579e", **lt("30, 30, 40")),
  dict(hdr="centered", grid="ruled", chip="underline", panel="none", num="left", wk="on"),
  ["radial-gradient(380px 280px at 0% 0%, rgba(44,74,124,.13), transparent 70%)", svg(paper)],
  font="'Batang','Noto Serif CJK KR','Noto Serif KR','Nanum Myeongjo',serif")

# 8 바다
theme("ocean", "바다", "맑은 바닷가", False,
  dict(panel="#e6f2f6", ink="#10303c", muted="#3f6672", accent="#0f7f9e", onAccent="#ffffff", sun="#b42d47", sat="#1b5fae", **lt("16, 48, 60")),
  dict(hdr="top", grid="soft", chip="bar", panel="none", num="right", wk="off"),
  ["radial-gradient(320px 240px at 92% 0%, rgba(255,255,255,.65), transparent 70%)",
   svg(wave(430, 14, "#0f7f9e", .10) + wave(470, 12, "#0f7f9e", .13, 1.7) + wave(510, 9, "#1b5fae", .16, 3.1)
       + "".join(f"<circle cx='{random.Random(i).uniform(30,570):.0f}' cy='{random.Random(i+9).uniform(120,400):.0f}' r='{random.Random(i+3).choice([4,6,9])}' fill='none' stroke='white' stroke-opacity='.7' stroke-width='1.6'/>" for i in range(8)))])

# 9 벚꽃
theme("sakura", "벚꽃", "봄날 꽃잎", False,
  dict(panel="#fbeef1", ink="#43222c", muted="#84596a", accent="#c8416d", onAccent="#ffffff", sun="#b8304c", sat="#3a68ae", **lt("67, 34, 44")),
  dict(hdr="pill", grid="bubble", chip="pill", panel="strip", num="circle", wk="off"),
  ["radial-gradient(420px 300px at 100% 0%, rgba(238,143,176,.30), transparent 70%)",
   "radial-gradient(360px 260px at 0% 100%, rgba(201,166,232,.22), transparent 70%)",
   svg(petals(8, 22, ["#e8668f", "#f6a1ba", "#f4b8c8", "#ee8fb0"]))])

# 10 청사과
theme("apple", "청사과", "소풍 담요", False,
  dict(panel="#eef4e1", ink="#1f2b10", muted="#566a3c", accent="#4a7a00", onAccent="#ffffff", sun="#b0322b", sat="#2b64a8", **lt("31, 43, 16")),
  dict(hdr="stack", grid="tight", chip="bar", panel="none", num="right", wk="off"),
  ["radial-gradient(340px 260px at 0% 0%, rgba(140,198,63,.30), transparent 70%)",
   "repeating-linear-gradient(0deg, rgba(74,122,0,.085) 0 22px, transparent 22px 44px)",
   "repeating-linear-gradient(90deg, rgba(74,122,0,.085) 0 22px, transparent 22px 44px)"])


# ════════════ 새 테마 10종 (깔끔 2 · 포근 2 · 눈이 편안 2 · 특별 2 · 시원 2) ════════════
CATS = {"snow":"깔끔한","slate":"깔끔한","graphite":"깔끔한",
        "cocoa":"포근한","peach":"포근한","maple":"포근한","sakura":"포근한","lavender":"포근한",
        "sage":"눈이 편안한","night":"눈이 편안한","forest":"눈이 편안한","hanji":"눈이 편안한","apple":"눈이 편안한",
        "neon":"특별한","dancheong":"특별한","aurora":"특별한",
        "mint":"시원한","glacier":"시원한","ocean":"시원한","midnight":"시원한"}

def bokeh(seed, n, colors):
    r = random.Random(seed); o = []
    for _ in range(n):
        o.append(f"<circle cx='{r.uniform(0,600):.0f}' cy='{r.uniform(0,560):.0f}' r='{r.uniform(14,48):.0f}' fill='{r.choice(colors)}' fill-opacity='{r.uniform(.07,.18):.2f}'/>")
    return svg("<g filter='url(#b)'>" + "".join(o) + "</g>", defs="<defs><filter id='b'><feGaussianBlur stdDeviation='7'/></filter></defs>")

def clouds():
    e = "".join(f"<ellipse cx='{x}' cy='{y}' rx='{rx}' ry='{ry}' fill='white' fill-opacity='{a}'/>" for x, y, rx, ry, a in
                [(120,470,120,38,.55),(260,500,150,44,.5),(470,455,130,40,.5),(540,520,120,36,.55),(40,520,100,34,.5)])
    return svg(f"<g filter='url(#cb)'>{e}</g>", defs="<defs><filter id='cb'><feGaussianBlur stdDeviation='9'/></filter></defs>")

def bubbles(seed, n):
    r = random.Random(seed)
    return svg("".join(f"<circle cx='{r.uniform(20,580):.0f}' cy='{r.uniform(40,540):.0f}' r='{r.choice([6,9,14,22,34])}' fill='white' fill-opacity='.2' stroke='white' stroke-opacity='.65' stroke-width='1.6'/>" for _ in range(n)))

def shards(seed):
    r = random.Random(seed); o = []
    for _ in range(16):
        cx = r.uniform(260, 640); h = r.uniform(60, 190); w = r.uniform(26, 70)
        o.append(f"<polygon points='{cx-w/2:.0f},560 {cx+r.uniform(-8,8):.0f},{560-h:.0f} {cx+w/2:.0f},560' fill='#bfeaff' fill-opacity='{r.uniform(.05,.16):.2f}' stroke='#e8f8ff' stroke-opacity='.18'/>")
    return svg("".join(o))

def synth():
    stripes = "".join(f"<rect x='0' y='{y}' width='600' height='{h}' fill='black'/>" for y, h in [(302,3),(312,4),(322,5),(333,6)])
    defs = ("<defs><linearGradient id='sky' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='#0a0b14' stop-opacity='0'/><stop offset='1' stop-color='#7a2cff' stop-opacity='.5'/></linearGradient>"
            "<linearGradient id='sun' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='#ffb347'/><stop offset='1' stop-color='#ff3df2'/></linearGradient>"
            "<linearGradient id='gnd' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='#2a0a4a' stop-opacity='.9'/><stop offset='1' stop-color='#0a0b14' stop-opacity='.9'/></linearGradient>"
            f"<mask id='m'><rect width='600' height='560' fill='white'/>{stripes}</mask></defs>")
    lines = "".join(f"<line x1='300' y1='344' x2='{xb}' y2='560' stroke='#ff3df2' stroke-opacity='.4' stroke-width='1.3'/>" for xb in range(-700, 1301, 130))
    lines += "".join(f"<line x1='0' y1='{y}' x2='600' y2='{y}' stroke='#ff3df2' stroke-opacity='.4' stroke-width='1.3'/>" for y in (350, 358, 370, 388, 414, 452, 506))
    body = ("<g opacity='.34'><rect y='200' width='600' height='160' fill='url(#sky)'/>"
            "<circle cx='300' cy='318' r='88' fill='url(#sun)' mask='url(#m)' fill-opacity='.85'/>"
            "<rect y='344' width='600' height='216' fill='url(#gnd)'/>" + lines + "</g>")
    return svg(body, defs=defs)

GRAIN = lambda rgb, a, seed: svg("<rect width='100%' height='100%' filter='url(#n)'/>",
    defs=f"<defs><filter id='n' x='0' y='0' width='100%' height='100%'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' seed='{seed}'/><feColorMatrix values='0 0 0 0 {rgb[0]}  0 0 0 0 {rgb[1]}  0 0 0 0 {rgb[2]}  0 0 0 {a} 0'/></filter></defs>")

# 11 스노우 (깔끔)
theme("snow","스노우","순백에 파란 포인트",False,
  dict(panel="#fbfcfd", ink="#1b2430", muted="#5b6675", accent="#2563eb", onAccent="#ffffff", sun="#d1364f", sat="#1d4ed8", **lt("27, 36, 48")),
  dict(hdr="top", grid="airy", chip="dot", panel="none", num="left", wk="off"),
  ["radial-gradient(520px 260px at 50% -8%, rgba(37,99,235,.10), transparent 70%)","radial-gradient(420px 260px at 100% 100%, rgba(37,99,235,.05), transparent 70%)"])
# 12 슬레이트 (깔끔)
theme("slate","슬레이트","모눈종이 위 업무 대시보드",False,
  dict(panel="#eef1f5", ink="#1f2937", muted="#5b6573", accent="#1f2937", onAccent="#ffffff", sun="#c2253d", sat="#2b5cab", **lt("31, 41, 55")),
  dict(hdr="compact", grid="tight", chip="bar", panel="agenda", num="right", wk="off"),
  ["repeating-linear-gradient(0deg, rgba(31,41,55,.055) 0 1px, transparent 1px 24px)","repeating-linear-gradient(90deg, rgba(31,41,55,.055) 0 1px, transparent 1px 24px)"])
# 13 코코아 (포근)
theme("cocoa","코코아","따뜻한 조명 아래 한 잔",True,
  dict(panel="#2b201b", ink="#f3e7dc", muted="#b79f8d", accent="#e3a46f", onAccent="#2b1608", sun="#ff9a85", sat="#9bc1e8", **dk("255, 228, 205")),
  dict(hdr="centered", grid="soft", chip="pill", panel="none", num="circle", wk="off"),
  ["radial-gradient(460px 320px at 50% 0%, rgba(227,164,111,.22), transparent 70%)","radial-gradient(380px 300px at 0% 100%, rgba(180,90,60,.20), transparent 70%)", bokeh(13, 16, ["#ffd9a8","#e3a46f","#ffb98a"])])
# 14 피치 (포근)
theme("peach","피치","햇살 가득한 오후",False,
  dict(panel="#fff2e8", ink="#3b2417", muted="#7a5a48", accent="#c2410c", onAccent="#ffffff", sun="#b91c1c", sat="#1d5fa8", **lt("59, 36, 23")),
  dict(hdr="stack", grid="card", chip="pill", panel="none", num="circle", wk="off"),
  ["radial-gradient(420px 320px at 100% 0%, rgba(255,186,120,.55), transparent 70%)","radial-gradient(360px 260px at 0% 100%, rgba(255,214,170,.5), transparent 70%)", clouds()])
# 15 세이지 (눈이 편안)
theme("sage","세이지","차분한 허브 정원",False,
  dict(panel="#e8eee4", ink="#26332a", muted="#5f6f61", accent="#4a6b4f", onAccent="#ffffff", sun="#a8453a", sat="#3d6a8c", **lt("38, 51, 42")),
  dict(hdr="top", grid="soft", chip="outline", panel="hero", num="left", wk="off"),
  ["radial-gradient(420px 300px at 0% 0%, rgba(120,160,120,.22), transparent 70%)", GRAIN((.22,.32,.22), .13, 5)])
# 16 나이트 (눈이 편안: 푸른 빛을 줄인 어두운 테마)
theme("night","나이트","푸른빛을 줄인 따뜻한 야간",True,
  dict(panel="#1d1b18", ink="#ddd6c8", muted="#9a9283", accent="#c8a869", onAccent="#1d1608", sun="#e58f7b", sat="#8fb4d6", **dk("240, 226, 196")),
  dict(hdr="journal", grid="card", chip="dot", panel="none", num="right", wk="off"),
  ["radial-gradient(520px 420px at 50% 40%, transparent 55%, rgba(0,0,0,.25))", svg(stars(41, 26, color="#f3e2bd", maxy=.6))])
# 17 네온 시티 (특별)
theme("neon","네온 시티","레트로 신스웨이브",True,
  dict(panel="#0a0b14", ink="#e9ecff", muted="#8a90b8", accent="#ff3df2", onAccent="#14001a", sun="#ff5c8a", sat="#3de6ff", **dk("200, 210, 255")),
  dict(hdr="minimal", grid="table", chip="glow", panel="none", num="left", wk="off"),
  ["radial-gradient(420px 260px at 50% 0%, rgba(255,61,242,.16), transparent 70%)", synth()],
  font="'Consolas','D2Coding','Cascadia Mono',monospace")
# 18 단청 (특별: 오방색)
theme("dancheong","단청","청·적·황 오방색 문양",True,
  dict(panel="#101a22", ink="#f2efe6", muted="#9fb0b8", accent="#e0b341", onAccent="#20180a", sun="#ff8a7a", sat="#6fb5e8", **dk("242, 239, 230")),
  dict(hdr="centered", grid="card", chip="bar", panel="none", num="circle", wk="off"),
  ["linear-gradient(to bottom, #1f6fb2 0 3px, #c0392b 3px 6px, #e0b341 6px 8px, rgba(0,0,0,0) 8px)",
   "linear-gradient(to top, #1f6fb2 0 3px, #c0392b 3px 6px, #e0b341 6px 8px, rgba(0,0,0,0) 8px)",
   svg("<path d='M16 0 L32 16 L16 32 L0 16 Z' fill='none' stroke='#e0b341' stroke-opacity='.10'/>", w=32, h=32),
   "radial-gradient(420px 300px at 50% 0%, rgba(31,111,178,.26), transparent 70%)"],
  size="100% 8px, 100% 8px, 32px 32px, cover", pos="top, bottom, center, center",
  repeat="no-repeat, no-repeat, repeat, no-repeat")
# 19 민트 (시원)
theme("mint","민트","톡 쏘는 청량감",False,
  dict(panel="#eafaf6", ink="#0f2b27", muted="#4a6f69", accent="#0b7a6b", onAccent="#ffffff", sun="#c2314b", sat="#1f62b8", **lt("15, 43, 39")),
  dict(hdr="compact", grid="bubble", chip="pill", panel="strip", num="circle", wk="off"),
  ["radial-gradient(420px 320px at 0% 0%, rgba(80,220,190,.38), transparent 70%)","radial-gradient(360px 260px at 100% 100%, rgba(120,200,255,.28), transparent 70%)", bubbles(19, 16), svg(wave(480, 12, "#0b7a6b", .09) + wave(515, 9, "#1f62b8", .10, 2))])
# 20 글래시어 (시원)
theme("glacier","글래시어","얼음 절벽의 푸른 빛",True,
  dict(panel="#0c2030", ink="#e4f4ff", muted="#86a8c0", accent="#5ad1ff", onAccent="#04202e", sun="#ff8fa8", sat="#7fc8ff", **dk("200, 235, 255")),
  dict(hdr="compact", grid="card", chip="outline", panel="agenda", num="right", wk="off"),
  ["radial-gradient(420px 260px at 20% 0%, rgba(90,209,255,.26), transparent 70%)","radial-gradient(360px 240px at 100% 100%, rgba(181,236,255,.16), transparent 70%)", shards(23), svg(stars(24, 30, color="#d8f4ff", maxy=.55))])


# ════ 교체 테마 ════ (겹치는 slate·cocoa·night·mint 를 빼고 그 자리에 넣는다)
def ripples(seed):
    o = []
    for i, r in enumerate(range(40, 620, 56)):
        o.append(f"<circle cx='300' cy='430' r='{r}' fill='none' stroke='#7fb8ff' stroke-opacity='{max(.03, .16 - i*.012):.3f}' stroke-width='1.4'/>")
    return svg("".join(o))

# 13 와인 (포근한)
theme("wine","와인","촛불 켜진 라운지",True,
  dict(panel="#2a1020", ink="#f6e6ea", muted="#c7a0ad", accent="#e8869b", onAccent="#2a0c14", sun="#ff9aa8", sat="#a9b8f0", **dk("255, 214, 224")),
  dict(hdr="centered", grid="airy", chip="outline", panel="none", num="circle", wk="off"),
  ["radial-gradient(420px 320px at 50% 100%, rgba(232,134,155,.26), transparent 70%)","radial-gradient(300px 220px at 0% 0%, rgba(150,40,80,.36), transparent 70%)", bokeh(31, 10, ["#ffd2a8","#e8869b","#ffb3c4"])])
# 16 세피아 (눈이 편안한)
theme("sepia","세피아","오래된 종이책의 누런빛",False,
  dict(panel="#e9dcc3", ink="#3a2a1a", muted="#6e5a43", accent="#7a4a1d", onAccent="#ffffff", sun="#a32d22", sat="#2d5d8f", **lt("58, 42, 26")),
  dict(hdr="journal", grid="airy", chip="text", panel="agenda", num="left", wk="off"),
  ["radial-gradient(620px 480px at 50% 50%, transparent 55%, rgba(120,80,30,.20))", GRAIN((.35,.25,.12), .16, 9)])
# 19 코발트 (시원한)
theme("cobalt","코발트","깊고 푸른 물결",True,
  dict(panel="#0d2457", ink="#e8f1ff", muted="#9db8e6", accent="#4da3ff", onAccent="#031a3a", sun="#ff9bb0", sat="#8ec5ff", **dk("190, 215, 255")),
  dict(hdr="pill", grid="tight", chip="glow", panel="none", num="right", wk="off"),
  ["radial-gradient(460px 300px at 50% 0%, rgba(77,163,255,.30), transparent 70%)", ripples(5)])
# 12 콘크리트 (깔끔한)
theme("concrete","콘크리트","노출 콘크리트의 담백한 회색",False,
  dict(panel="#d6d9de", ink="#111827", muted="#4b5563", accent="#111827", onAccent="#ffffff", sun="#b4233a", sat="#244f9e", **lt("17, 24, 39")),
  dict(hdr="compact", grid="card", chip="text", panel="strip", num="left", wk="off"),
  ["radial-gradient(500px 340px at 100% 0%, rgba(255,255,255,.45), transparent 70%)", GRAIN((.2,.22,.26), .10, 11)])

# 겹치는 4개를 빼고, 교체 테마를 같은 순서(번호)에 넣는다
_swap = {"slate": "concrete", "cocoa": "wine", "night": "sepia", "mint": "cobalt"}
_by_id = {t["id"]: t for t in T}
T[:] = [(_by_id[_swap[t["id"]]] if t["id"] in _swap else t) for t in T if t["id"] not in _swap.values()]
CATS.update({"concrete": "깔끔한", "wine": "포근한", "sepia": "눈이 편안한", "cobalt": "시원한"})

# ════ 6개씩 맞추기 ════ (깔끔 3 · 포근 1 · 눈이 편안 1 · 특별 3 · 시원 2)
import math as _m

def sprinkles(seed):
    r = random.Random(seed); cols = ["#ff5fa2", "#7c3aed", "#22c3ee", "#ffd166", "#34d399"]; o = []
    for _ in range(40):
        x, y, ang = r.uniform(0, 600), r.uniform(0, 560), r.uniform(0, 180)
        o.append(f"<rect x='{x:.0f}' y='{y:.0f}' width='14' height='4' rx='2' fill='{r.choice(cols)}' fill-opacity='.45' transform='rotate({ang:.0f} {x:.0f} {y:.0f})'/>")
    return svg("".join(o))

def lemons():
    o = []
    for (x, y, rr) in [(520, 90, 46), (80, 470, 38), (560, 440, 30)]:
        o.append(f"<circle cx='{x}' cy='{y}' r='{rr}' fill='#ffe066' fill-opacity='.55' stroke='#ffffff' stroke-opacity='.8' stroke-width='4'/>")
        for k in range(8):
            a = k * _m.pi / 4
            o.append(f"<line x1='{x}' y1='{y}' x2='{x + (rr - 6) * _m.cos(a):.1f}' y2='{y + (rr - 6) * _m.sin(a):.1f}' stroke='#ffffff' stroke-opacity='.75' stroke-width='2'/>")
    return svg("".join(o))

def compass():
    o = [f"<circle cx='470' cy='420' r='{r}' fill='none' stroke='#ffffff' stroke-opacity='{a}' stroke-width='1.2'/>" for r, a in [(120, .16), (80, .12), (40, .10)]]
    o.append("<line x1='330' y1='420' x2='610' y2='420' stroke='#ffffff' stroke-opacity='.14'/><line x1='470' y1='280' x2='470' y2='560' stroke='#ffffff' stroke-opacity='.14'/>")
    o.append("<rect x='40' y='40' width='200' height='120' fill='none' stroke='#ffffff' stroke-opacity='.12' stroke-dasharray='6 4'/>")
    return svg("".join(o))

# 애시 (깔끔한): 진회색 + 노란 포인트
theme("ash","애시","잿빛 바탕에 노란 포인트",True,
  dict(panel="#3d3a37", ink="#f3f1ee", muted="#b5b9bf", accent="#ffd166", onAccent="#1d1a10", sun="#ffb0a8", sat="#b3d4ff", **dk("230, 232, 236")),
  dict(hdr="pill", grid="table", chip="underline", panel="none", num="right", wk="off"),
  ["radial-gradient(460px 300px at 100% 0%, rgba(255,209,102,.07), transparent 70%)", GRAIN((.9, .9, .92), .035, 13)])
# 슬레이트 블루 (깔끔한): 먹색 + 하늘색
theme("slatemid","슬레이트 블루","먹색 위 하늘빛 선",True,
  dict(panel="#3a4048", ink="#eef3f8", muted="#a9b7c6", accent="#38bdf8", onAccent="#052233", sun="#ffa3aa", sat="#a6d8ff", **dk("226, 236, 246")),
  dict(hdr="stack", grid="airy", chip="outline", panel="agenda", num="left", wk="off"),
  ["radial-gradient(420px 280px at 0% 0%, rgba(56,189,248,.16), transparent 70%)", "radial-gradient(rgba(255,255,255,.06) 1px, transparent 1.4px)"],
  size="cover, 20px 20px", repeat="no-repeat, repeat")
# 포그 (깔끔한): 안개 낀 중간 회색
theme("fog","포그","안개 낀 아침의 회색",False,
  dict(panel="#9aa3ad", ink="#0b1220", muted="#252e3b", accent="#0b1220", onAccent="#ffffff", sun="#6e0b1a", sat="#0a2a66", **lt("11, 18, 32")),
  dict(hdr="minimal", grid="card", chip="text", panel="hero", num="circle", wk="off"),
  ["linear-gradient(to top, rgba(255,255,255,.28), transparent 45%)", GRAIN((.95, .96, .98), .07, 17)])
# 캐러멜 (포근한)
theme("caramel","캐러멜","달콤하게 녹아내린 갈색",True,
  dict(panel="#3a2416", ink="#f7e9dc", muted="#c9a58a", accent="#f0b27a", onAccent="#2b1608", sun="#ffa08c", sat="#b0cdf0", **dk("255, 230, 210")),
  dict(hdr="journal", grid="bubble", chip="pill", panel="none", num="circle", wk="off"),
  ["radial-gradient(480px 320px at 50% 0%, rgba(240,178,122,.22), transparent 70%)", svg(wave(470, 14, "#f0b27a", .14) + wave(505, 10, "#c97b3f", .16, 2)), bokeh(37, 9, ["#ffd2a8", "#f0b27a"])])
# 토프 (눈이 편안한): 따뜻한 회갈색, 낮은 대비의 리넨 결
theme("taupe","토프","리넨처럼 차분한 회갈색",True,
  dict(panel="#2a2622", ink="#e6ddd2", muted="#a89a8b", accent="#c9b59a", onAccent="#221c15", sun="#e8988a", sat="#a3bdd2", **dk("235, 225, 212")),
  dict(hdr="top", grid="ruled", chip="dot", panel="strip", num="left", wk="off"),
  ["repeating-linear-gradient(0deg, rgba(255,240,220,.035) 0 1px, transparent 1px 4px)", "repeating-linear-gradient(90deg, rgba(255,240,220,.03) 0 1px, transparent 1px 5px)", "radial-gradient(560px 440px at 50% 45%, transparent 55%, rgba(0,0,0,.25))"])
# 팝아트 (특별한)
theme("pop","팝아트","만화 같은 노랑과 망점",False,
  dict(panel="#ffe14d", ink="#111111", muted="#3d3420", accent="#111111", onAccent="#ffe14d", sun="#b80f1c", sat="#1a3aa8", **lt("17, 17, 17")),
  dict(hdr="centered", grid="cells", chip="bar", panel="none", num="circle", wk="off"),
  ["radial-gradient(rgba(17,17,17,.13) 1.3px, transparent 1.8px)", "radial-gradient(circle at 100% 0%, #ff4d6d 0 70px, transparent 71px)", "radial-gradient(circle at 0% 100%, #3a86ff 0 80px, transparent 81px)"],
  size="12px 12px, cover, cover", repeat="repeat, no-repeat, no-repeat")
# 블루프린트 (특별한): 설계 도면
theme("blueprint","블루프린트","설계 도면의 흰 선",True,
  dict(panel="#123f73", ink="#f4f8ff", muted="#b9cdea", accent="#ffffff", onAccent="#123f73", sun="#ffbdbd", sat="#cfe2ff", **dk("220, 235, 255")),
  dict(hdr="compact", grid="table", chip="text", panel="agenda", num="left", wk="on"),
  ["repeating-linear-gradient(0deg, rgba(255,255,255,.09) 0 1px, transparent 1px 32px)", "repeating-linear-gradient(90deg, rgba(255,255,255,.09) 0 1px, transparent 1px 32px)",
   "repeating-linear-gradient(0deg, rgba(255,255,255,.035) 0 1px, transparent 1px 8px)", "repeating-linear-gradient(90deg, rgba(255,255,255,.035) 0 1px, transparent 1px 8px)", compass()],
  font="'Bahnschrift','Segoe UI',sans-serif")
# 캔디 (특별한)
theme("candy","캔디","사탕 줄무늬와 스프링클",False,
  dict(panel="#ffe3f6", ink="#3b0d4f", muted="#7a4b86", accent="#7c3aed", onAccent="#ffffff", sun="#c0134e", sat="#1f5fc4", **lt("59, 13, 79")),
  dict(hdr="pill", grid="bubble", chip="pill", panel="strip", num="circle", wk="off"),
  ["repeating-linear-gradient(135deg, rgba(255,255,255,.30) 0 14px, rgba(255,160,214,.16) 14px 28px)", sprinkles(29)])
# 레모네이드 (시원한)
theme("lemonade","레모네이드","얼음 띄운 레몬 한 잔",False,
  dict(panel="#fffbd1", ink="#10302f", muted="#4e6a62", accent="#0e7c86", onAccent="#ffffff", sun="#c2263f", sat="#1d5fb0", **lt("16, 48, 47")),
  dict(hdr="stack", grid="soft", chip="dot", panel="none", num="right", wk="off"),
  ["radial-gradient(420px 300px at 0% 100%, rgba(14,124,134,.16), transparent 70%)", lemons(), bubbles(41, 10)])
# 라군 (시원한)
theme("lagoon","라군","햇빛이 일렁이는 얕은 바다",False,
  dict(panel="#cff5f0", ink="#062e2a", muted="#3d6b65", accent="#0f766e", onAccent="#ffffff", sun="#b4233a", sat="#1c5aa8", **lt("6, 46, 42")),
  dict(hdr="journal", grid="airy", chip="bar", panel="hero", num="left", wk="off"),
  ["radial-gradient(520px 260px at 50% 0%, rgba(255,255,255,.55), transparent 70%)", svg(wave(400, 10, "#0f766e", .10) + wave(440, 14, "#14b8a6", .10, 2) + wave(490, 12, "#0ea5e9", .10, 3) + wave(530, 9, "#0f766e", .12, 4))])

CATS.update({"ash": "깔끔한", "slatemid": "깔끔한", "fog": "깔끔한", "caramel": "포근한", "taupe": "눈이 편안한",
             "pop": "특별한", "blueprint": "특별한", "candy": "특별한", "lemonade": "시원한", "lagoon": "시원한"})
# ── 출력 ────────────────────────────────────────────────────────────
css = ["/* 자동 생성 파일(테마 10종). <html data-theme=\"id\"> 로 선택한다.\n   색 변수 + 배경 그림. 레이아웃 차이는 layouts.css가 data-hdr/grid/chip/panel/num/wk 로 처리한다. */\n"]
for t in T:
    p = t["pal"]
    lines = [f"  --panel: {p['panel']}; --ink: {p['ink']}; --muted: {p['muted']}; --accent: {p['accent']}; --on-accent: {p['onAccent']};",
             f"  --sun: {p['sun']}; --sat: {p['sat']};",
             f"  --line: {p['line']}; --cell: {p['cell']}; --cell-hover: {p['cellHover']}; --stripe: {p['stripe']};",
             f"  color-scheme: {'dark' if t['dark'] else 'light'};",
             f"  --bg-art: {', '.join(t['art'])};"]
    if t["size"]: lines.append(f"  --bg-size: {t['size']};")
    else: lines.append("  --bg-size: cover;")
    if t.get("pos"): lines.append(f"  --bg-pos: {t['pos']};")
    if t.get("repeat"): lines.append(f"  --bg-repeat: {t['repeat']};")
    if t["font"]: lines.append(f"  --font-display: {t['font']};")
    else: lines.append("  --font-display: inherit;")
    css.append(f":root[data-theme='{t['id']}'] {{\n" + "\n".join(lines) + "\n}\n")
open(f"{OUT}/themes.css", "w", encoding="utf-8").write("\n".join(css))

js = ["// 자동 생성 파일: 테마 목록(이름, 분위기, 미리보기 색, 레이아웃).\nexport const THEMES = " +
      json.dumps([dict(id=t["id"], name=t["name"], mood=t["mood"], dark=t["dark"],
                       colors={k: t["pal"][k] for k in ("panel", "ink", "muted", "accent", "sun", "sat")},
                       cat=CATS[t["id"]],
                       layout=t["layout"]) for t in T], ensure_ascii=False, indent=1) + ";\n"]
open(f"{OUT}/themes.js", "w", encoding="utf-8").write("\n".join(js))
print("themes.css", len(open(f"{OUT}/themes.css", encoding="utf-8").read()) // 1024, "KB;", len(T), "themes")
