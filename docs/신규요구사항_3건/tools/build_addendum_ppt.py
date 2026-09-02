#!/usr/bin/env python3
"""킥오프 신규 요구사항 3건 상세설명서 — PPT.

`build_addendum_doc.py`가 만드는 HTML과 **같은 내용을 같은 근거에서** 만든다.
데이터는 `content/addendum-고려솔더/ui-spec.json` 보존본, 개선업무(AS-IS/TO-BE)는
`build_addendum_doc.IMPROVE` 를 그대로 가져온다 — 두 벌로 적어 두면 한쪽만 고쳐져
문서와 슬라이드가 갈라진다.

그림·표 헬퍼는 `build_pptx.py` 것을 그대로 쓴다. 같은 팔레트·같은 여백이라야
화면정의서와 나란히 놓았을 때 한 벌로 보이고, `check_pptx.py`의 넘침 검사도
같은 식으로 계산된다.

HTML과 다른 점 하나 — **컬럼 정의는 신규 테이블 5종만 싣는다.** 기존 테이블까지
넣으면 185행이 되어 슬라이드가 표로만 채워진다. 기존 테이블은 목록에 참조 이유와
함께 남기고, 정의는 SF-TD5 데이터베이스설계서를 가리킨다.

사용법
  .venv/bin/python tools/build_addendum_ppt.py
  → outputs/고려솔더_신규요구사항3건_상세설명서_v1.0.pptx
"""
import json
import re
import sys
from pathlib import Path

from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN
from pptx.util import Inches

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_pptx as B  # noqa: E402  — 팔레트·헬퍼를 그대로 쓴다
from build_addendum_doc import IMPROVE, NEW_TABLES, SOURCE  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
SPEC = ROOT / "content" / "addendum-고려솔더" / "ui-spec.json"
OUT = ROOT / "outputs" / "고려솔더_신규요구사항3건_상세설명서_v1.0.pptx"

W, H = B.W, B.H
PAD = 0.45
CW = W - PAD * 2          # 본문 폭
TOP = 1.02                # 머리글 아래
BOTTOM = H - 0.42         # 바닥선 위
AVAIL = BOTTOM - TOP

EYEBROW = "신규 요구사항 상세설명서"

# build_pptx 팔레트에 초록이 상수로는 없다(TONE['입고재고관리']에만 있다).
# 화면설명서 CSS의 --green 과 같은 값을 쓴다.
GREEN = RGBColor(0x4E, 0x8F, 0x43)


def plain(s: str) -> str:
    """HTML 조각을 슬라이드용 순수 문자열로. <code>·<b>만 쓰였다."""
    return re.sub(r"<[^>]+>", "", s).replace("&nbsp;", " ").strip()


def card(s, left, top, width, height, title, tone=None):
    """제목 띠가 붙은 상자. 안쪽에 글을 넣을 좌표를 돌려준다."""
    B.rect(s, left, top, width, height, fill=B.WHITE, line_color=B.LINE)
    B.rect(s, left, top, width, 0.30, fill=B.SOFT)
    if tone:
        B.rect(s, left, top, 0.05, height, fill=tone)
    B.text(s, title, left + 0.14, top + 0.055, width - 0.28, 0.20,
           size=10.5, bold=True, color=B.NAVY_D)
    return left + 0.16, top + 0.42, width - 0.32, height - 0.56


LINE_R, SPACE_AFTER = 1.24, 5


def bullets(s, items, left, top, width, height, size=10.5, color=None):
    B.text(s, [f"·  {t}" for t in items], left, top, width, height,
           size=size, color=color or B.INK2, space_after=SPACE_AFTER, line=LINE_R)


CARD_CHROME = 0.58   # 제목 띠 + 위아래 안쪽 여백


def fit_card(s, left, top, width, title, items=None, body=None, tone=None,
             size=10.5, min_h=0.0, max_h=None) -> float:
    """내용 높이에 맞춘 카드를 그리고 **카드 바닥 y**를 돌려준다.

    처음에는 카드 높이를 손으로 박아 뒀는데, 내용이 짧은 카드가 절반 넘게 비어
    슬라이드가 헐거워 보였다. 높이를 내용에서 끌어내면 그 문제가 사라지고,
    내용이 늘어도 카드가 알아서 따라온다."""
    inner = width - 0.32
    if items is not None:
        need = bullets_h(items, inner, size)
    else:
        need = B.est_height([body], inner, size, 1.28)
    h = max(min_h, need + CARD_CHROME)
    if max_h:
        h = min(h, max_h)
    l, t, w, _ = card(s, left, top, width, h, title, tone=tone)
    if items is not None:
        bullets(s, items, l, t, w, h - CARD_CHROME, size=size)
    else:
        B.text(s, body, l, t, w, h - CARD_CHROME, size=size, color=B.INK2, line=1.28)
    return top + h


def bullets_h(items, width, size) -> float:
    """불릿 묶음이 실제로 차지하는 높이(inch).

    줄바꿈을 세지 않고 '한 줄에 한 항목'으로 어림했다가 아래 글과 겹쳤다
    (`check_pptx.py`가 잡아냈다). `build_pptx.est_lines` 로 실제 줄 수를 센다."""
    total = 0.0
    for t in items:
        n = B.est_lines(f"·  {t}", width, size)
        total += n * size * LINE_R / 72 + SPACE_AFTER / 72
    return total


def quote_bar(s, screen, imp, top=TOP):
    """요청 원문 — 이 문서의 출발점이므로 요구사항마다 맨 위에 둔다."""
    h = 0.62
    B.rect(s, PAD, top, CW, h, fill=B.AMBER_BG, line_color=B.AMBER, line_w=0.75)
    B.rect(s, PAD, top, 0.05, h, fill=B.AMBER)
    B.text(s, f"고려솔더 요청 원문 — “{imp['req_quote']}”", PAD + 0.16, top + 0.09,
           CW - 0.32, 0.24, size=11, bold=True, color=B.INK)
    B.text(s, f"{imp['impact']}  ·  출처 {SOURCE}", PAD + 0.16, top + 0.34,
           CW - 0.32, 0.20, size=8.5, color=B.INK3)
    return top + h + 0.16


# ── 슬라이드 ────────────────────────────────────────────────

def cover(prs, m, screens):
    s = B.blank(prs)
    B.rect(s, 0, 0, W, H, fill=B.NAVY_D)
    B.rect(s, 0, 0, W, 0.10, fill=B.AMBER)
    B.text(s, m["program_title"], PAD + 0.3, 2.05, 11.5, 0.28, size=11, color=B.INK3)
    B.text(s, f"{m['system_name']}", PAD + 0.3, 2.42, 11.5, 0.55,
           size=29, bold=True, color=B.WHITE)
    B.text(s, "신규 요구사항 3건 상세설명서", PAD + 0.3, 3.02, 11.5, 0.60,
           size=29, bold=True, color=B.BLUE_L)
    B.rect(s, PAD + 0.3, 3.86, 1.5, 0.035, fill=B.AMBER)
    B.text(s, ["요구사항 · 개선업무 · 화면 · 프로그램 · 필요데이터",
               "2026-08 킥오프 회의 추가 요청분 — 계약 범위(화면 42건) 밖, 별도 관리"],
           PAD + 0.3, 4.12, 11.5, 0.70, size=12, color=B.INK3, space_after=4)
    rows = "   ".join(f"{i}. {sc['name']}" for i, sc in enumerate(screens, 1))
    B.text(s, rows, PAD + 0.3, 5.05, 11.5, 0.30, size=12, bold=True, color=B.WHITE)
    B.text(s, [f"도입기업 {m['company']}  ·  공급기업 {m['supplier']}",
               f"{m['version']} ({m['date']})  ·  {m['status']}"],
           PAD + 0.3, 6.25, 11.5, 0.55, size=9.5, color=B.INK3, space_after=3)


def summary(prs, screens):
    s = B.doc_slide(prs, EYEBROW, "요약 — 신규 요구사항 3건")
    cols = [0.5, 1.45, 1.95, 1.55, 1.45, 1.45, 0.72, 0.95, 2.4]
    rows = [[str(i), sc["requirement"]["id"], sc["name"], sc["path"].split(" > ")[1],
             sc["id"], sc["program"]["id"], sc["changeType"],
             f"{len(sc['tables'])}종", IMPROVE[sc["id"]]["impact"]]
            for i, sc in enumerate(screens, 1)]
    B.draw_table(s, ["No", "요구사항ID", "요구사항명", "업무영역", "화면ID",
                     "프로그램ID", "구분", "필요데이터", "영향도"],
                 rows, PAD, TOP, CW, cols, 9.5,
                 center_cols=(0, 6, 7), bold_cols=(2,), navy_cols=(1, 4, 5))

    top = TOP + 0.42 + sum(B.row_height(r, cols, 9.5) for r in rows) + 0.28
    top = fit_card(s, PAD, top, CW, "신규 테이블 5종", tone=B.BLUE, size=10, items=[
        "RCV_STOCK_THRESHOLDS (안전재고기준) — 임계재고 경고의 근거. 설계에 없던 개념을 새로 세운다",
        "PRC_WORK_ORDERS / PRC_WORK_ORDER_TASKS (작업지시 · 작업지시공정별) — 역할(공정)별 게시의 근거",
        "SHP_DOCUMENTS / SHP_DOCUMENT_TEMPLATES (출고서류발행 · 양식) — 발행이력과 양식을 분리",
    ]) + 0.22
    fit_card(s, PAD, top, CW, "기존 납품본과의 관계", tone=B.AMBER, size=10, items=[
        "본 3건은 계약 범위(화면 42건) 밖이며 별도로 관리한다. SF-AD1~AD3 · SF-TD1~TD5 본 "
        "산출물과 화면설명서·화면정의서는 42건 기준 그대로이고, 여기에 3건은 실려 있지 않다.",
        "요구사항ID MES-AD2-063~065는 이 문서와 별도 화면정의서에서만 쓰는 번호다. 본 산출물에 "
        "편입할 때는 그 시점의 번호 체계를 다시 확인해야 한다 — 현행 본 산출물에서 063~075는 "
        "비기능 요구사항이 쓰고 있다.",
        "FP 점수는 모두 산정(안)이며 사업비 산출내역서 반영은 협의 후 확정한다.",
    ])


def req_slide(prs, sc, imp, idx):
    req = sc["requirement"]
    s = B.doc_slide(prs, f"{idx}. {sc['name']}", "요구사항", "SF-AD2 요구사항정의서")
    top = quote_bar(s, sc, imp)

    lw = CW * 0.60
    l, t, w, h = card(s, PAD, top, lw, BOTTOM - top, "요구사항 내용", tone=B.NAVY)
    desc_h = B.est_height([req["description"]], w, 11, 1.3)
    B.text(s, req["description"], l, t, w, desc_h, size=11, color=B.INK, line=1.3)

    y = t + desc_h + 0.18
    B.text(s, "세부 기능 · FP 산정(안)", l, y, w, 0.22, size=10, bold=True,
           color=B.NAVY_D)
    lines = [x.strip() for x in req["details"].split("\n") if x.strip()]
    bh = bullets_h(lines, w, 10)
    bullets(s, lines, l, y + 0.28, w, bh, size=10)

    y = y + 0.28 + bh + 0.10
    B.text(s, "제약사항", l, y, w, 0.22, size=10, bold=True, color=B.NAVY_D)
    B.text(s, req["constraints"], l, y + 0.28, w, h - (y + 0.28 - t),
           size=9.5, color=B.INK2, line=1.28)

    rl = PAD + lw + 0.20
    rw = CW - lw - 0.20
    l, t, w, h = card(s, rl, top, rw, 2.55, "요구사항 정보", tone=B.BLUE)
    for i, (k, v) in enumerate([
            ("요구사항ID", req["id"]), ("구분 (SF-AD3)", sc["changeType"]),
            ("업무영역", sc["path"].split(" > ")[1]), ("연계 모듈", imp["modules"]),
            ("담당자", req.get("owner", "").strip())]):
        B.text(s, k, l, t + i * 0.40, 1.15, 0.20, size=9, color=B.INK3)
        B.text(s, v, l + 1.20, t + i * 0.40, w - 1.20, 0.36, size=9.5,
               bold=(i < 2), color=B.NAVY if i < 2 else B.INK2, line=1.2)

    fit_card(s, rl, top + 2.75, rw, "비고", body=req["notes"], tone=B.INK3, size=9,
             max_h=BOTTOM - (top + 2.75))


def improve_slide(prs, sc, imp, idx):
    s = B.doc_slide(prs, f"{idx}. {sc['name']}", "개선업무 (AS-IS → TO-BE)",
                    "킥오프 회의 논의")
    top = TOP
    cw = (CW - 0.20) / 2
    inner = cw - 0.32
    # 두 칸은 높이를 맞춰야 나란히 보인다 — 둘 중 큰 쪽에 맞춘다.
    ch = max(bullets_h(imp["asis"], inner, 10),
             bullets_h(imp["tobe"], inner, 10)) + CARD_CHROME
    l, t, w, h = card(s, PAD, top, cw, ch, "AS-IS · 현재", tone=B.INK3)
    bullets(s, imp["asis"], l, t, w, ch - CARD_CHROME, size=10)
    l, t, w, h = card(s, PAD + cw + 0.20, top, cw, ch, "TO-BE · 개선 후", tone=GREEN)
    bullets(s, imp["tobe"], l, t, w, ch - CARD_CHROME, size=10)

    B.rect(s, PAD + cw - 0.13, top + ch / 2 - 0.14, 0.26, 0.28, fill=B.BLUE)
    B.text(s, "▶", PAD + cw - 0.13, top + ch / 2 - 0.10, 0.26, 0.20, size=11,
           bold=True, color=B.WHITE, align=PP_ALIGN.CENTER)

    y = fit_card(s, PAD, top + ch + 0.22, CW, "설계로 풀어낸 방식", tone=B.NAVY,
                 size=10.5, items=[plain(x) for x in imp["how"]])

    # 남은 자리에 '확인·결정 필요 사항'이 들어가면 여기서 끝낸다 — 아래가 비어 있는
    # 채로 장을 넘기느니 한 장에 모으는 편이 협의 자리에서 짚기 쉽다. 안 들어가면
    # 억지로 줄이지 않고 다음 장으로 넘긴다(줄여 봐야 PowerPoint가 다시 늘린다).
    return open_table(s, imp, y + 0.26, dry_run=False) if fits_open(imp, y + 0.26) else False


OPEN_COLS = [2.6, 4.0, 5.83]   # 합 12.43 = CW


def fits_open(imp, top) -> bool:
    rows = [[a, b, plain(c)] for a, b, c in imp["open"]]
    need = 0.30 + 0.34 + sum(B.row_height(r, OPEN_COLS, 9.5) for r in rows)
    return top + need <= BOTTOM


def open_table(s, imp, top, dry_run=False) -> bool:
    rows = [[a, b, plain(c)] for a, b, c in imp["open"]]
    B.text(s, "확인 · 결정 필요 사항", PAD, top, CW, 0.24, size=11, bold=True,
           color=B.NAVY_D)
    B.draw_table(s, ["항목", "반영한 값", "상태"], rows, PAD, top + 0.30, CW,
                 OPEN_COLS, 9.5, bold_cols=(0,))
    return True


def screen_slide(prs, sc, idx, assets):
    prog = sc["program"]
    s = B.doc_slide(prs, f"{idx}. {sc['name']}", "화면 · 프로그램",
                    "SF-TD3 화면설계서 / SF-TD4")
    iw = CW * 0.615
    png = assets / f"td3-{sc['id']}.png"
    B.rect(s, PAD, TOP, iw, 3.72, fill=B.WHITE, line_color=B.LINE)
    if png.exists():
        B.fit_picture(s, png, PAD + 0.06, TOP + 0.06, iw - 0.12, 3.60)
    B.text(s, f"{sc['id']} {sc['name']} 화면 목업 — 설계 기준 와이어프레임이며 "
              "그리드·차트 수치는 예시값이다", PAD, TOP + 3.78, iw, 0.24,
           size=8.5, color=B.INK3)

    rl = PAD + iw + 0.20
    rw = CW - iw - 0.20
    l, t, w, h = card(s, rl, TOP, rw, 2.30, "화면 정보", tone=B.NAVY)
    for i, (k, v) in enumerate([("화면ID", sc["id"]), ("화면 경로", sc["path"]),
                                ("적용 채널", sc["channels"])]):
        B.text(s, k, l, t + i * 0.62, 0.95, 0.20, size=9, color=B.INK3)
        B.text(s, v, l + 1.00, t + i * 0.62, w - 1.00, 0.58, size=9.5,
               bold=(i == 0), color=B.NAVY if i == 0 else B.INK2, line=1.22)

    t2 = TOP + 2.50
    l, t, w, h = card(s, rl, t2, rw, BOTTOM - t2, f"프로그램 {prog['id']}", tone=B.BLUE)
    B.text(s, "처리 흐름", l, t, w, 0.20, size=9.5, bold=True, color=B.NAVY_D)
    B.text(s, prog["flow"], l, t + 0.26, w, h - 0.30, size=9, color=B.INK2, line=1.26)

    t3 = TOP + 4.10
    body = sc["composition"] + "\n" + sc["items"]
    h3 = min(BOTTOM - t3,
             B.est_height([sc["composition"], sc["items"]], iw - 0.32, 9, 1.26)
             + CARD_CHROME + 0.10)
    l, t, w, _ = card(s, PAD, t3, iw, h3, "화면 구성 · 처리 절차", tone=GREEN)
    B.text(s, [sc["composition"], sc["items"]], l, t, w, h3 - CARD_CHROME, size=9,
           color=B.INK2, space_after=5, line=1.26)


def data_slides(prs, sc, idx):
    s = B.doc_slide(prs, f"{idx}. {sc['name']}", "필요데이터 — 테이블 목록",
                    "SF-TD5 데이터베이스설계서")
    cols = [2.9, 2.1, 1.9, 0.85, 0.8, 3.89]
    rows = [[t["name"], t["label"], t["area"],
             "신규" if t["name"] in NEW_TABLES else "기존",
             str(len(t["columns"])),
             t["basis"] if t["name"] in NEW_TABLES else "기존 설계서에 정의됨 — 읽기 참조"]
            for t in sc["tables"]]
    B.draw_table(s, ["테이블명", "한글명", "업무영역", "구분", "컬럼", "비고"],
                 rows, PAD, TOP, CW, cols, 9.5,
                 center_cols=(3, 4), bold_cols=(0,), navy_cols=(0,))

    n = sum(1 for t in sc["tables"] if t["name"] in NEW_TABLES)
    B.text(s, f"이 화면이 쓰는 테이블 {len(sc['tables'])}종 중 신규 {n}종. "
              "다음 장에 신규 테이블의 컬럼 정의를 싣는다 — 기존 테이블 정의는 "
              "SF-TD5 데이터베이스설계서를 따른다.",
           PAD, TOP + 0.50 + 0.34 * len(rows), CW, 0.4, size=9.5, color=B.INK3)

    # 신규 테이블 컬럼 정의 — 길면 장을 나눈다.
    cols = [2.3, 2.5, 1.7, 0.62, 0.62, 0.72, 3.97]   # 합 12.43 = CW
    for t in sc["tables"]:
        if t["name"] not in NEW_TABLES:
            continue
        rows = [[c[0], c[1], c[2], c[3], c[4], c[5], c[6] if len(c) > 6 else ""]
                for c in t["columns"]]
        pages = B.paginate(rows, cols, 9, AVAIL - 0.30)
        for i, page in enumerate(pages, 1):
            right = f"{i} / {len(pages)}" if len(pages) > 1 else "신규 테이블"
            s = B.doc_slide(prs, f"{idx}. {sc['name']}",
                            f"{t['name']}  {t['label']}", right)
            B.draw_table(s, ["항목명", "컬럼명", "타입", "PK", "FK", "NULL", "비고"],
                         page, PAD, TOP, CW, cols, 9,
                         center_cols=(3, 4, 5), bold_cols=(1,), navy_cols=(1,))


def open_slide(prs, sc, imp, idx):
    """개선업무 장에 못 실은 경우에만 따로 뽑는다."""
    s = B.doc_slide(prs, f"{idx}. {sc['name']}", "확인 · 결정 필요 사항",
                    "협의 후 확정")
    rows = [[a, b, plain(c)] for a, b, c in imp["open"]]
    B.draw_table(s, ["항목", "반영한 값", "상태"], rows, PAD, TOP, CW, OPEN_COLS, 10,
                 bold_cols=(0,))
    top = TOP + 0.50 + sum(B.row_height(r, OPEN_COLS, 10) for r in rows)
    B.text(s, "‘반영한 값’은 킥오프 회의 자료의 ‘내용(안)’을 채택한 것이다. "
              "확정 근거가 없는 항목은 기존 산출물 관례대로 미확정으로 두었다.",
           PAD, top + 0.12, CW, 0.4, size=9.5, color=B.INK3)


def next_slide(prs):
    s = B.doc_slide(prs, EYEBROW, "다음 단계")
    steps = [
        ("1", "‘확인 필요’ 항목을 고려솔더·공급기업 협의로 확정",
         "특히 원자재별 안전재고 기준 수량과 ERP 연계 방식 — 이 둘이 정해져야 "
         "REQ-01 경고와 REQ-02 자동생성·REQ-03 양식이 성립한다"),
        ("2", "확정 내용을 SF-AD2 요구사항정의서에 신규 요구사항으로 추가",
         "편입 시점의 번호 체계를 다시 확인한다 — 현행 063~075는 비기능 요구사항이 쓰고 있다"),
        ("3", "SF-AD3 기능대비표에 신규·변경 항목 반영",
         "구분 판정 — 배합·재고 현황판 추가 / 작업지시관리 추가 / 출고서류 발행 변경"),
        ("4", "추가 FP 산정 및 사업비 영향 협의",
         "REQ-02(작업지시관리) 영향이 가장 크다 — 11점(안) · 단위프로세스 3건"),
    ]
    top = TOP + 0.10
    for no, title, note in steps:
        B.rect(s, PAD, top, 0.44, 0.44, fill=B.NAVY)
        B.text(s, no, PAD, top + 0.09, 0.44, 0.26, size=13, bold=True,
               color=B.WHITE, align=PP_ALIGN.CENTER)
        B.text(s, title, PAD + 0.62, top + 0.02, CW - 0.62, 0.28, size=12.5,
               bold=True, color=B.INK)
        B.text(s, note, PAD + 0.62, top + 0.32, CW - 0.62, 0.44, size=9.5,
               color=B.INK2, line=1.26)
        top += 1.18
    B.rect(s, PAD, BOTTOM - 0.62, CW, 0.02, fill=B.LINE)
    B.text(s, f"근거 : {SOURCE}", PAD, BOTTOM - 0.48, CW, 0.24, size=9, color=B.INK3)


def main() -> int:
    if not SPEC.exists():
        sys.exit(f"보존본이 없습니다: {SPEC}")
    spec = json.loads(SPEC.read_text(encoding="utf-8"))
    screens = spec["areas"][0]["screens"]
    assets = Path(spec["sources"]["assetsDir"])
    m = spec["meta"]

    missing = [sc["id"] for sc in screens if sc["id"] not in IMPROVE]
    if missing:
        sys.exit(f"개선업무가 적히지 않은 화면: {', '.join(missing)}")

    prs = Presentation()
    prs.slide_width = Inches(W)
    prs.slide_height = Inches(H)

    cover(prs, m, screens)
    summary(prs, screens)
    for i, sc in enumerate(screens, 1):
        imp = IMPROVE[sc["id"]]
        req_slide(prs, sc, imp, i)
        merged = improve_slide(prs, sc, imp, i)
        screen_slide(prs, sc, i, assets)
        data_slides(prs, sc, i)
        if not merged:
            open_slide(prs, sc, imp, i)
    next_slide(prs)

    OUT.parent.mkdir(exist_ok=True)
    prs.save(str(OUT))
    print(f"{OUT.name} — 슬라이드 {len(prs.slides.__iter__.__self__._sldIdLst)}장 "
          f"({OUT.stat().st_size / 1024 / 1024:.1f} MB)")
    for i, sc in enumerate(screens, 1):
        new = [t["name"] for t in sc["tables"] if t["name"] in NEW_TABLES]
        print(f"  {i}. {sc['name']:<14} {sc['requirement']['id']} / {sc['id']} / "
              f"{sc['program']['id']} — 신규 테이블 {len(new)}종 {', '.join(new)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
