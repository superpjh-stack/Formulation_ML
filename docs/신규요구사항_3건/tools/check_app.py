#!/usr/bin/env python3
"""배포본 화면설명서 HTML을 실제로 눌러 보는 기능 테스트.

`check_pptx.py`가 PPT를 보듯, 이쪽은 브라우저에서 앱을 조작한다. 문서 검사
(`analyze verify` / `design verify`)는 docx 글자만 보므로 **탭 전환·검색·
메뉴 이동·키보드 이동이 실제로 동작하는지는 아무것도 말해주지 않는다.**

특히 메뉴구조도는 메뉴명과 화면명을 **글자 그대로** 맞춰 이동한다
(`DocViews.jsx: indexByName`). 설계서에서 메뉴명을 화면명과 다르게 적으면
그 메뉴는 눌러도 아무 일이 없고, 어떤 문서 검사도 이것을 잡지 못한다.

하네스 규칙 — 이 둘을 지키지 않으면 테스트를 믿을 수 없다:

1. **검사 하나가 터져도 나머지는 계속 돈다.** 결함본으로 시험해 보니 초판은
   메뉴명이 어긋나자 Playwright 예외로 통째로 죽어, 검사 결과 대신 traceback만
   남았다. 그러면 '앱의 결함'과 '테스트 자체의 오류'를 구분할 수 없다.
   이제 검사는 전부 `Report.step()`을 거치며, 예외는 그 검사 한 건의 실패로 적힌다.
2. **기다림은 짧게.** Playwright 기본 타임아웃 30초로는 실패 한 건마다 30초를
   버린다. 못 찾을 요소를 기다리는 것이 이 테스트의 정상적인 실패 경로이므로
   기본값을 `STEP_TIMEOUT`으로 낮춘다. 부팅만 예외로 넉넉히 준다(번들 600KB).

사용법
  .venv/bin/python tools/check_app.py                    # outputs 의 개별 배포본
  .venv/bin/python tools/check_app.py <html경로|URL>     # 개발서버도 된다
  .venv/bin/python tools/check_app.py <대상> --company 고려솔더
      회사가 둘 이상 담긴 배포본은 회사 선택 화면으로 시작한다. 검사할 회사를 고른다
      (생략하면 고려솔더). 검사 기준(화면 42건 등)은 그 회사의 것이다.
"""
import re
import sys
import time
from pathlib import Path
from urllib.parse import unquote

from playwright.sync_api import Error as PWError
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent

BOOT_TIMEOUT = 20_000   # 번들 파싱까지 기다린다
STEP_TIMEOUT = 2_500    # 그 뒤로는 짧게 — 못 찾으면 그게 결과다

# 깊이 볼 표본 — 화면명 / 화면ID / 요구사항ID / 프로그램ID / 목업 유형.
# 목업 유형 두 가지를 모두 덮도록 고른다(대시보드형 5건 · 목록형 37건).
SAMPLE_SCREENS = [
    ("생산현황 분석", "MES-TD3-001", "MES-AD2-001", "MES-TD4-001", "대시보드형"),
    ("입고관리", "MES-TD3-005", "MES-AD2-005", "MES-TD4-005", "목록형"),
    ("출하관리", "MES-TD3-014", "MES-AD2-014", "MES-TD4-014", "목록형"),
]

# 2026-08 킥오프 추가 3건. 계약 범위를 지키려고 본 산출물에서 되돌린 것이므로,
# 여기 다시 섞여 들어오면 그것이 결함이다. 별도 화면정의서로만 관리한다
# (`tools/build_addendum.py`).
ADDENDUM_IDS = ["MES-TD3-043", "MES-TD3-044", "MES-TD3-045"]

TAB_LABELS = ["화면 설명", "개요·표준", "메뉴구조도", "화면 목록", "검토"]
TOTAL_SCREENS = 42      # 업무화면 — 계약 범위
TOTAL_WITH_COMMON = 46  # + 공통화면 4


class Failed(Exception):
    """검사가 스스로 실패를 선언할 때. 메시지가 그대로 사유로 적힌다."""


class Report:
    """검사 결과. 상태는 통과/실패/건너뜀 세 가지다.

    건너뜀이 있는 이유: 화면이 열리지 않으면 그 화면의 목업·테이블 검사는 같은
    사유로 줄줄이 실패해 진짜 원인을 덮는다. 그렇다고 조용히 빼면 총 검사 수가
    실행마다 달라져 무엇이 안 돌았는지 알 수 없다. 건너뛴 것도 줄을 남긴다."""

    def __init__(self):
        self.rows: list[tuple[str, str, str]] = []  # (상태, 이름, 사유)
        self.started = time.monotonic()

    def skip(self, name: str, why: str) -> None:
        self.rows.append(("건너뜀", name, why))

    def step(self, name: str, fn) -> bool:
        """검사 한 건. 무엇이 터지든 이 검사의 실패로만 적고 넘어간다."""
        try:
            out = fn()
            ok, detail = out if isinstance(out, tuple) else (out, "")
        except Failed as e:
            ok, detail = False, str(e)
        except PWError as e:
            # 못 찾은 요소가 사유다 — 스택이 아니라 무엇을 기다렸는지를 적는다.
            first = str(e).splitlines()[0]
            waited = re.search(r"waiting for (.+)", str(e))
            ok = False
            detail = f"{first[:90]}" + (f" / {waited.group(1)[:90]}" if waited else "")
        except Exception as e:  # noqa: BLE001 — 하네스가 죽는 것보다 낫다
            ok, detail = False, f"{type(e).__name__}: {str(e).splitlines()[0][:120]}"
        self.rows.append(("통과" if ok else "실패", name, detail))
        return bool(ok)

    def show(self) -> int:
        for state, name, detail in self.rows:
            show = detail and (state != "통과" or name == "회사 선택")
            print(f"  [{state}] {name}" + (f" — {detail}" if show else ""))
        n = {s: sum(1 for r in self.rows if r[0] == s) for s in ("통과", "실패", "건너뜀")}
        secs = time.monotonic() - self.started
        tail = f", 건너뜀 {n['건너뜀']}" if n["건너뜀"] else ""
        print(f"\n검사 {len(self.rows)}건 — 통과 {n['통과']}, 실패 {n['실패']}{tail} ({secs:.1f}초)")
        return 1 if n["실패"] else 0


# --------------------------------------------------------------------------- #
# 조작 헬퍼 — 못 찾으면 Failed 를 던져 사유가 그대로 보고서에 적히게 한다.
# --------------------------------------------------------------------------- #

def texts_of(loc) -> list[str]:
    return [t.strip() for t in loc.all_inner_texts()]


def click_exact(loc, want: str, what: str) -> None:
    """`has_text`는 부분일치라 '작업지시관리'가 '작업지시 관리'를 못 집는 식으로
    엉뚱하게 기다린다. 눈에 보이는 글자로 정확히 찾아 그 자리를 누른다."""
    found = texts_of(loc)
    if want not in found:
        near = [t for t in found if want[:4] in t][:3]
        raise Failed(f"{what}에 '{want}' 없음" + (f" (비슷한 것: {', '.join(near)})" if near else ""))
    loc.nth(found.index(want)).click()


def tab(pg, label: str) -> None:
    click_exact(pg.locator(".app-tabs button"), label, "탭")
    pg.wait_for_timeout(200)


def current_tab(pg) -> str:
    cur = pg.locator('.app-tabs button[aria-current="page"]')
    if cur.count() == 0:
        raise Failed("현재 탭 표시(aria-current)가 없음")
    return cur.first.inner_text().strip()


def sidebar_names(pg) -> list[str]:
    return texts_of(pg.locator(".nav-item .nm"))


def search(pg, text: str) -> list[str]:
    pg.locator(".nav-search input").fill(text)
    pg.wait_for_timeout(200)
    return sidebar_names(pg)


def open_screen(pg, name: str) -> None:
    """검색으로 좁힌 뒤 고른다 — 같은 글자가 본문에도 있어 목록만 노려야 한다."""
    search(pg, name)
    click_exact(pg.locator(".nav-item .nm"), name, "화면 목록")
    pg.wait_for_timeout(250)


def head(pg) -> tuple[str, list[str]]:
    h2 = pg.locator(".screen-head h2")
    if h2.count() == 0:
        raise Failed("화면 상세가 열리지 않음(.screen-head 없음)")
    return h2.first.inner_text().strip(), texts_of(pg.locator(".screen-head .ids code"))


# --------------------------------------------------------------------------- #

def default_target() -> str:
    hits = sorted((ROOT / "outputs").glob("*_화면설명서_*.html"))
    if not hits:
        sys.exit("outputs 에 화면설명서 HTML이 없습니다. bundle_singlefile.py 를 먼저 돌리세요.")
    return max(hits, key=lambda p: p.stat().st_mtime).as_uri()


def to_url(arg: str) -> str:
    return arg if re.match(r"^https?://", arg) else Path(arg).resolve().as_uri()


def enter_company(pg, company: str) -> str:
    """회사가 둘 이상이면 앱은 선택 화면으로 시작한다. 해당 회사를 열고 들어간다.

    한 회사만 담긴 배포본은 이 화면을 건너뛰므로 아무것도 하지 않는다."""
    if pg.locator(".card-co").count() == 0:
        return "단일 회사 배포본 — 선택 화면 없음"
    names = texts_of(pg.locator(".card-co .card-name"))
    if company not in names:
        raise Failed(f"선택 화면에 '{company}' 없음 (있는 것: {', '.join(names)})")
    pg.locator(".card-co").nth(names.index(company)).click()
    pg.wait_for_selector(".app-tabs button", timeout=BOOT_TIMEOUT)
    return f"{len(names)}개 중 '{company}' 열기"


def run(pg, r: Report) -> None:
    # --- 탭 --------------------------------------------------------------- #
    r.step("탭 5개", lambda: (texts_of(pg.locator(".app-tabs button")) == TAB_LABELS,
                             str(texts_of(pg.locator(".app-tabs button")))))

    for label, marker in [("화면 설명", ".nav-item"), ("개요·표준", ".doc"),
                          ("메뉴구조도", ".tree"), ("화면 목록", ".doc table"),
                          ("검토", ".doc")]:
        def check_tab(label=label, marker=marker):
            tab(pg, label)
            n = pg.locator(marker).count()
            return current_tab(pg) == label and n > 0, f"현재 '{current_tab(pg)}', {marker} {n}개"
        r.step(f"탭 전환 · {label}", check_tab)

    # --- 사이드바 ----------------------------------------------------------- #
    r.step("화면 설명 탭 진입", lambda: (tab(pg, "화면 설명"), True)[1])

    def count_ok():
        n = len(sidebar_names(pg))
        return n == TOTAL_WITH_COMMON, f"{n}건"
    r.step(f"사이드바 화면 {TOTAL_WITH_COMMON}건(업무 {TOTAL_SCREENS} + 공통 4)", count_ok)

    def no_dup():
        names = sidebar_names(pg)
        dups = sorted({n for n in names if names.count(n) > 1})
        return not dups, ", ".join(dups[:4])
    r.step("화면명 중복 없음", no_dup)

    for name, *_ in SAMPLE_SCREENS:
        r.step(f"표본 화면이 목록에 있음 · {name}",
               lambda name=name: (name in sidebar_names(pg), "목록에 없음"))

    def addendum_absent():
        """추가분 3건이 본 산출물에 섞여 있으면 계약 범위가 조용히 늘어난 것이다."""
        tab(pg, "화면 목록")
        ids = texts_of(pg.locator(".list-link"))
        leaked = [i for i in ADDENDUM_IDS if i in ids]
        tab(pg, "화면 설명")
        return not leaked, f"본 산출물에 섞임: {', '.join(leaked)}"
    r.step("킥오프 추가 3건이 본 산출물에 없음(계약 범위 유지)", addendum_absent)

    def area_sum():
        counts = [int(c) for c in texts_of(pg.locator(".nav-group-title .count"))]
        return sum(counts) == TOTAL_WITH_COMMON, str(counts)
    r.step(f"업무영역별 건수 합계 = {TOTAL_WITH_COMMON}", area_sum)

    # --- 검색 -------------------------------------------------------------- #
    for label, term, expect in [
        ("화면명", "입고관리", ["입고관리"]),
        ("화면ID", "MES-TD3-001", ["생산현황 분석"]),
        ("요구사항ID", "MES-AD2-014", ["출하관리"]),
    ]:
        r.step(f"검색 · {label}",
               lambda term=term, expect=expect: (search(pg, term) == expect,
                                                 str(search(pg, term))))
    r.step("검색 · 업무영역(공정관리 5건)",
           lambda: (len(search(pg, "공정관리")) == 5, f"{len(search(pg, '공정관리'))}건"))
    r.step("검색 · 결과 없음 안내",
           lambda: (search(pg, "없는화면이름zzz") == []
                    and pg.locator(".nav-empty").count() == 1, "안내 문구 없음"))
    r.step("검색 초기화", lambda: (search(pg, ""), True)[1])

    # --- 신규 3건 상세 -------------------------------------------------------- #
    for name, sid, req, prog, kind in SAMPLE_SCREENS:
        def detail(name=name, sid=sid, req=req, prog=prog):
            open_screen(pg, name)
            title, codes = head(pg)
            return title == name and codes[:3] == [sid, req, prog], f"{title} {codes[:3]}"
        if not r.step(f"상세 헤더 ID · {name}", detail):
            # 화면이 안 열렸으면 그 아래 검사는 같은 사유로 줄줄이 실패해 원인을 덮는다.
            for what in ("목업 유형", "목업 본문", "연계 테이블 개수 일치",
                         "테이블 컬럼 정의가 펼쳐짐"):
                r.skip(f"{what} · {name}", "상세 헤더 ID 실패로 건너뜀")
            continue

        def mock_kind(name=name, kind=kind):
            got = pg.locator(".mock-caption .kind").first.inner_text().strip()
            return got == kind, f"'{got}' (기대 '{kind}')"
        r.step(f"목업 유형 · {name}", mock_kind)

        def mock_body(kind=kind):
            if kind == "대시보드형":
                c = pg.locator(".mock-card").count()
                bars = pg.locator(".mock-bars .bar").count()
                rows = pg.locator(".mock-rows .r").count()
                return c == 4 and bars > 0 and rows > 0, f"카드 {c} 막대 {bars} 행 {rows}"
            f = pg.locator(".mock-search .f").count()
            cols = pg.locator(".mock-grid thead th").count()
            btns = pg.locator(".mock-footer-btns .btn").count()
            return f > 0 and cols > 0 and btns > 0, f"조회조건 {f} 컬럼 {cols} 버튼 {btns}"
        r.step(f"목업 본문 · {name}", mock_body)

        def tables_match():
            m = re.search(r"연계 테이블 (\d+)종", pg.inner_text(".spec"))
            n = pg.locator(".spec .db-table").count()
            if not m:
                raise Failed("'연계 테이블 N종' 머리글이 없음")
            return int(m.group(1)) == n and n > 0, f"머리글 {m.group(1)} / 실제 {n}"
        r.step(f"연계 테이블 개수 일치 · {name}", tables_match)

        def columns_open():
            pg.locator(".spec .db-table").first.click()
            pg.wait_for_timeout(150)
            n = pg.locator(".spec .tbl.cols tbody tr").count()
            return n > 0, "컬럼 정의가 비어 있음"
        r.step(f"테이블 컬럼 정의가 펼쳐짐 · {name}", columns_open)

    # --- 메뉴구조도 ---------------------------------------------------------- #
    r.step("메뉴구조도 탭 진입", lambda: (tab(pg, "메뉴구조도"), True)[1])
    r.step(f"메뉴 {TOTAL_SCREENS}건",
           lambda: (len(texts_of(pg.locator(".tree li"))) == TOTAL_SCREENS,
                    f"{len(texts_of(pg.locator('.tree li')))}건"))

    def menus_linked():
        """메뉴명이 화면명과 글자까지 같아야 눌렀을 때 이동한다."""
        tab(pg, "화면 설명")
        screens = set(sidebar_names(pg))
        tab(pg, "메뉴구조도")
        orphans = [m for m in texts_of(pg.locator(".tree li")) if m not in screens]
        return not orphans, f"이동 안 되는 메뉴 {len(orphans)}건: {', '.join(orphans[:5])}"
    r.step("모든 메뉴가 화면과 이어짐(이름 일치)", menus_linked)

    for name, sid, *_ in SAMPLE_SCREENS:
        def jump(name=name, sid=sid):
            tab(pg, "메뉴구조도")
            click_exact(pg.locator(".tree li"), name, "메뉴구조도")
            pg.wait_for_timeout(300)
            title, codes = head(pg)
            return (current_tab(pg) == "화면 설명" and title == name
                    and codes[:1] == [sid]), f"{current_tab(pg)} / {title} / {codes[:1]}"
        r.step(f"메뉴 클릭 → 화면 이동 · {name}", jump)

    # --- 화면 목록 ----------------------------------------------------------- #
    r.step("화면 목록 탭 진입", lambda: (tab(pg, "화면 목록"), True)[1])
    r.step(f"화면 목록 {TOTAL_SCREENS}행",
           lambda: (pg.locator(".doc table tbody tr").count() == TOTAL_SCREENS,
                    f"{pg.locator('.doc table tbody tr').count()}행"))
    for name, sid, req, prog, _ in SAMPLE_SCREENS:
        def jump(name=name, sid=sid):
            tab(pg, "화면 목록")
            click_exact(pg.locator(".list-link"), sid, "화면 목록")
            pg.wait_for_timeout(300)
            title, codes = head(pg)
            return title == name and codes[:1] == [sid], f"{title} / {codes[:1]}"
        r.step(f"화면ID 클릭 → 화면 이동 · {sid}", jump)

        # 목록 표(TD3 screen_list)와 상세(TD3 screens + TD4)는 설계서상 다른 자리에서
        # 온다. 한쪽만 고치면 표와 화면이 서로 다른 프로그램을 가리키는데, 화면을
        # 열어 보는 것만으로는 드러나지 않는다.
        def row_matches(name=name, sid=sid, prog=prog):
            tab(pg, "화면 목록")
            cells = texts_of(pg.locator(".doc table tbody tr", has_text=sid).first
                             .locator("td"))
            if len(cells) < 6:
                raise Failed(f"'{sid}' 행을 읽지 못함 (칸 {len(cells)}개)")
            got_name, got_prog = cells[3].strip(), cells[4].strip()
            return (got_name == name and got_prog == prog,
                    f"표 '{got_name}' / {got_prog} ↔ 상세 '{name}' / {prog}")
        r.step(f"화면 목록 표 ↔ 상세 일치 · {sid}", row_matches)

    # --- 키보드 ------------------------------------------------------------- #
    def arrows():
        tab(pg, "화면 설명")
        open_screen(pg, "생산현황 분석")
        search(pg, "")
        pg.locator("body").click()
        before = head(pg)[0]
        pg.keyboard.press("ArrowDown")
        pg.wait_for_timeout(250)
        after = head(pg)[0]
        if after == before:
            raise Failed(f"↓ 를 눌러도 '{before}' 그대로")
        pg.keyboard.press("ArrowUp")
        pg.wait_for_timeout(250)
        return head(pg)[0] == before, f"↑ 뒤 '{head(pg)[0]}' (기대 '{before}')"
    r.step("↑↓ 로 앞뒤 화면 이동", arrows)

    def arrows_ignored_in_search():
        pg.locator(".nav-search input").click()
        held = head(pg)[0]
        pg.keyboard.press("ArrowDown")
        pg.wait_for_timeout(200)
        return head(pg)[0] == held, f"'{held}' → '{head(pg)[0]}'"
    r.step("검색 입력 중 ↓ 는 화면을 바꾸지 않음", arrows_ignored_in_search)


def main() -> int:
    args = [a for i, a in enumerate(sys.argv[1:], 1)
            if not a.startswith("--") and sys.argv[i - 1] != "--company"]
    url = to_url(args[0]) if args else default_target()
    # file:// 는 한글이 퍼센트 인코딩돼 있어 그대로 찍으면 읽을 수 없다.
    print(f"기능 테스트 — {unquote(url).rsplit('/', 1)[-1] or url}\n")
    r = Report()
    errors: list[str] = []

    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page(viewport={"width": 1680, "height": 1050})
        pg.on("pageerror", lambda e: errors.append(f"pageerror: {str(e).splitlines()[0][:160]}"))
        pg.on("console", lambda m: errors.append(f"console: {m.text[:160]}")
              if m.type == "error" else None)

        company = "고려솔더"
        if "--company" in sys.argv:
            company = sys.argv[sys.argv.index("--company") + 1]

        def boot():
            pg.goto(url, timeout=BOOT_TIMEOUT)
            pg.wait_for_selector(".card-co, .app-tabs button", timeout=BOOT_TIMEOUT)
            return True, ""
        booted = r.step("앱 부팅", boot)
        if booted:
            booted = r.step("회사 선택", lambda: (True, enter_company(pg, company)))

        if booted:
            pg.set_default_timeout(STEP_TIMEOUT)
            run(pg, r)
        else:
            # 화면이 안 뜨면 나머지는 전부 같은 사유로 실패한다. 사유만 남기고 끝낸다.
            print("  ! 앱이 뜨지 않아 이후 검사를 건너뜁니다.")

        b.close()

    r.step("콘솔·페이지 오류 없음",
           lambda: (not errors, "; ".join(dict.fromkeys(errors))[:400]))
    return r.show()


if __name__ == "__main__":
    sys.exit(main())
