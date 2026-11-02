# 음력(1900~2050, 윤달 포함)·24절기 표 생성기: src/kcal-data.js 를 만든다.
# 필요: pip install korean_lunar_calendar ephem
# 실행: 프로젝트 맨 위 폴더에서  python tools/kcal/gen.py   (검증용 정답표는 tools/kcal/out/ 에 생긴다)
import os as __os
__os.chdir(__os.path.abspath(__os.path.join(__os.path.dirname(__os.path.abspath(__file__)), "..", "..")))
__os.makedirs("tools/kcal/out", exist_ok=True)
import datetime as dt, json, math
from korean_lunar_calendar import KoreanLunarCalendar
import ephem

c = KoreanLunarCalendar()
Y0, Y1 = 1900, 2050

# ── 음력 표: 해마다 [설날 월, 설날 일, 윤달(0=없음), 달 길이 비트] ──
def valid(y, m, d, leap):
    """(음력 y,m,d,leap)이 실제로 존재하는지: 양력으로 바꿨다가 되돌려서 같은 값이 나오는지로 판정"""
    if not c.setLunarDate(y, m, d, leap): return False
    sy, sm, sd = c.solarYear, c.solarMonth, c.solarDay
    if not c.setSolarDate(sy, sm, sd):
        return not leap          # 라이브러리 양력 범위(2050-12-31)를 넘는 날짜: 일반 달만 직접 조회 결과를 믿는다
    return (c.lunarYear, c.lunarMonth, c.lunarDay, bool(c.isIntercalation)) == (y, m, d, leap)

lunar = []
for y in range(Y0, Y1 + 1):
    assert c.setLunarDate(y, 1, 1, False)
    ny = (c.solarMonth, c.solarDay)
    seq = []; leap = 0
    for m in range(1, 13):
        for is_leap in (False, True):
            if is_leap and leap:
                continue          # 윤달은 한 해에 하나
            if not valid(y, m, 1, is_leap):
                continue
            if is_leap: leap = m
            seq.append(30 if valid(y, m, 30, is_leap) else 29)
    if y == 2050:
        # 라이브러리의 음력 범위가 2050-11-18까지라 마지막 달은 비어 있다. 양력 2050-12-31까지만 쓰므로 자리표시로 채운다.
        assert leap == 3 and len(seq) == 12, (y, leap, seq)
        seq.append(29)
    bits = sum((1 << i) for i, n in enumerate(seq) if n == 30)
    assert len(seq) == (13 if leap else 12), (y, seq)
    lunar.append([ny[0], ny[1], leap, bits])

# ── 정답표(검증용): 양력 → 음력 전체 ──
start, end = dt.date(1900, 1, 31), dt.date(2050, 12, 31)
rows = []; d = start
while d <= end:
    assert c.setSolarDate(d.year, d.month, d.day), d
    rows.append(f"{d.isoformat()},{c.lunarYear},{c.lunarMonth},{c.lunarDay},{int(c.isIntercalation)}")
    d += dt.timedelta(days=1)
open("tools/kcal/out/expected_lunar.csv", "w").write("\n".join(rows))

# ── 24절기: 태양 황경이 15°의 배수가 되는 시각(KST) 의 날짜 ──
NAMES = ["소한","대한","입춘","우수","경칩","춘분","청명","곡우","입하","소만","망종","하지","소서","대서","입추","처서","백로","추분","한로","상강","입동","소설","대설","동지"]
LONS  = [285,300,315,330,345,0,15,30,45,60,75,90,105,120,135,150,165,180,195,210,225,240,255,270]

def sun_lon(jd):  # 시각(ephem.Date)의 태양 겉보기 황경(도)
    s = ephem.Sun(); s.compute(jd, epoch=jd)
    # 겉보기 좌표(광행차·장동 반영) g_ra/g_dec 로 황경을 구한다
    eq = ephem.Equatorial(s.g_ra, s.g_dec, epoch=jd)
    return math.degrees(ephem.Ecliptic(eq, epoch=jd).lon) % 360

def find_time(year, lon_deg, approx_month):
    # 대략 시각 주변에서 이분법
    lo = ephem.Date(dt.datetime(year, approx_month, 1) - dt.timedelta(days=12))
    hi = ephem.Date(dt.datetime(year, approx_month, 1) + dt.timedelta(days=45))
    def f(t): return ((sun_lon(t) - lon_deg + 180) % 360) - 180
    for _ in range(60):
        mid = (lo + hi) / 2
        if f(mid) < 0: lo = mid
        else: hi = mid
    return ephem.Date((lo + hi) / 2).datetime()

# 절기 i의 대략적인 달: 소한=1월 초 ...
approx_month = [1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12]
terms = {}; rows_t = {}
for y in range(Y0, Y1 + 1):
    arr = []
    for i, lon in enumerate(LONS):
        t_utc = find_time(y, lon, approx_month[i])
        kst = t_utc + dt.timedelta(hours=9)
        arr.append((kst.month, kst.day, kst.hour, kst.minute))
        assert kst.year == y, (y, NAMES[i], kst)
    terms[y] = arr
# 저장은 "월*100+일" 정수 24개
packed = {y: [m * 100 + d for (m, d, _, _) in v] for y, v in terms.items()}

js = "// 자동 생성 파일: 한국 음력(1900~2050, 윤달 포함)과 24절기(KST) 표.\n"
js += f"export const LUNAR_START = {Y0};\n"
js += "// 해마다 [설날 월, 설날 일, 윤달(0=없음), 달 길이 비트(비트가 1이면 30일, 0이면 29일; 윤달은 해당 월 바로 뒤)]\n"
js += "export const LUNAR_DATA = " + json.dumps(lunar, separators=(",", ":")) + ";\n"
js += f"export const TERMS_START = {Y0};\n"
js += "export const TERM_NAMES = " + json.dumps(NAMES, ensure_ascii=False) + ";\n"
js += "// 해마다 24절기(소한~동지)의 날짜를 월*100+일 로 적은 값\n"
js += "export const TERM_DATES = " + json.dumps([packed[y] for y in range(Y0, Y1 + 1)], separators=(",", ":")) + ";\n"
open("src/kcal-data.js", "w", encoding="utf-8").write(js)
json.dump({str(y): [[m,d,h,mi] for (m,d,h,mi) in v] for y, v in terms.items() if y in (2022,2023,2024,2025,2026,2027)}, open("tools/kcal/out/terms_sample.json","w"))

print("kcal-data.js", len(js)//1024, "KB; 음력", len(lunar), "년, 절기", len(packed), "년")
for y in (2024, 2025, 2026):
    print(y, " ".join(f"{NAMES[i]}{terms[y][i][0]}/{terms[y][i][1]}" for i in (2, 5, 11, 14, 17, 23)), "| 입춘 시각", "%02d:%02d" % terms[y][2][2:])
# 춘분 2026은 3/20 23:46(KST) 이어야 함
print("2026 춘분 KST:", "%d/%d %02d:%02d" % terms[2026][5], "(공식 3/20 23:46)")
print("2023 하지:", "%d/%d %02d:%02d" % terms[2023][11], "(공식 6/21 23:57 — 날짜가 6/21 이어야 함)")
print("2024 입춘:", "%d/%d %02d:%02d" % terms[2024][2], "(공식 2/4 17:27)", "| 2025 입춘:", "%d/%d %02d:%02d" % terms[2025][2], "(공식 2/3 23:10)")
risky = [(y, NAMES[i], "%d/%d %02d:%02d" % tuple(terms[y][i])) for y in terms for i in range(24) if (terms[y][i][2] == 23 and terms[y][i][3] >= 55) or (terms[y][i][2] == 0 and terms[y][i][3] <= 5)]
print("자정 5분 이내 절기(날짜가 모호할 수 있음):", len(risky), risky[:6])
