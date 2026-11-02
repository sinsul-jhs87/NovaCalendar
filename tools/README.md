# 개발 도구

| 폴더 | 내용 | 실행 |
|---|---|---|
| `theme-gen/` | 테마 30종 생성기(색·배경 그림·레이아웃·범주, 글자 대비 자동 보정) → `src/themes.css`, `src/themes.js` | `python tools/theme-gen/gen_themes.py` |
| `kcal/` | 음력(윤달 포함)·24절기 표 생성기 → `src/kcal-data.js` | `pip install korean_lunar_calendar ephem` 후 `python tools/kcal/gen.py` |
| `browser-tests/` | 실제 브라우저로 화면 동작과 글자 대비를 검사하는 스크립트(가짜 Tauri API `mock.js` 사용) | 아래 참고 |

## 화면·대비 검사

1. `src` 폴더를 정적 서버로 띄웁니다: `cd src && python -m http.server 8765 --bind 127.0.0.1`
2. `cd tools/browser-tests && npm install`
3. 예시
   - `node t13.mjs` 테마 30종을 선택창에서 하나씩 적용
   - `node t14.mjs` 헤더 위치·메뉴 위치·음력 위치·패널 스위치
   - `node t16.mjs` / `node t21.mjs` 날짜 팝업·연월 선택 / 반복 일정·끌어서 옮기기·검색
   - `FAST=1 node audit.mjs <테마ID>` 후 `python audit.py` 글자 대비(흰·검은 바탕화면, 투명도 85%)
   - `node snap.mjs <폴더>` 정리 전후 화면 비교용 촬영

스크립트는 리눅스의 헤드리스 크로미움(`@sparticuz/chromium`)으로 만들었습니다. 윈도우에서는 `puppeteer`를 설치하고 각 스크립트의 `puppeteer.launch(...)`에서 `executablePath`를 설치된 Chrome/Edge 경로로 바꾸면 됩니다.

## Rust 단위 테스트

`cd src-tauri && cargo test --lib` (반복 날짜 계산·저장소·iCal·CalDAV·Google 모의 서버 테스트)
