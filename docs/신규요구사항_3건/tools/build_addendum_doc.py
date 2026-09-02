#!/usr/bin/env python3
"""킥오프 신규 요구사항 3건 상세설명서 — 파일 하나짜리 HTML.

별도 화면정의서 PPT(`build_addendum.py` → `build_pptx.py`)는 목업 위주라
요구사항 원문·개선업무(AS-IS/TO-BE)·테이블 컬럼 정의가 실리지 않는다. 협의
자리에서 근거를 짚으려면 그것들이 한 문서에 있어야 해서 따로 만든다.

한 건마다 다섯 토막으로 적는다:
  요구사항(AD2) · 개선업무(AS-IS→TO-BE) · 화면(TD3) · 프로그램(TD4) · 필요데이터(TD5)

데이터는 전부 `content/addendum-고려솔더/ui-spec.json` 보존본에서 읽는다 — 손으로
옮겨 적으면 설계와 문서가 조용히 갈라진다. 다만 **개선업무만은 보존본에 없다**
(TD1 개선업무설계서까지는 손대지 않았다). 그래서 AS-IS/TO-BE는 킥오프 PPTX 원문을
근거로 이 파일에 적어 두고, 출처를 문서에 함께 남긴다.

목업 PNG는 data URI로 박아 파일 하나로 끝낸다(메일·USB로 그대로 넘긴다).
인쇄하면 A4 세로로 떨어지도록 잡았다.

사용법
  .venv/bin/python tools/build_addendum_doc.py
  → outputs/고려솔더_신규요구사항3건_상세설명서_v1.0.html
"""
import base64
import html
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
KEEP = ROOT / "content" / "addendum-고려솔더"
SPEC = KEEP / "ui-spec.json"
OUT = ROOT / "outputs" / "고려솔더_신규요구사항3건_상세설명서_v1.0.html"

SOURCE = ("고려솔더_신규요구사항_3건_1.pptx (2026-08 킥오프 회의 논의) · "
          "킥오프 회의록 4-3 / 5장(5-1~5-3)")

# 이 문서에서 새로 만든 테이블. 나머지는 기존 설계서에 이미 있던 것을 읽기만 한다.
NEW_TABLES = {"RCV_STOCK_THRESHOLDS", "PRC_WORK_ORDERS", "PRC_WORK_ORDER_TASKS",
              "SHP_DOCUMENTS", "SHP_DOCUMENT_TEMPLATES"}

# 개선업무 — 킥오프 PPTX의 AS-IS/TO-BE 원문을 그대로 옮기고, 설계로 풀어낸 방식을 덧붙였다.
IMPROVE = {
    "MES-TD3-043": {
        "req_quote": "배합비율 모니터링 및 재고현황을 현황판에 보여줬으면 좋겠다.",
        "impact": "영향도 중간",
        "asis": [
            "배합비율 추천 결과는 담당자 개별 조회 용도로만 설계되어 있고, 공용 대형화면 게시 기능이 없다.",
            "재고현황은 개별 조회는 가능하나 상시 게시판 형태의 화면이 없다.",
            "원자재 재고 임계치(안전재고 경고 기준) 개념이 현재 설계서에 없다.",
        ],
        "tobe": [
            "AI 대시보드에 '배합·재고 현황판' 전용 화면을 신설해 55\" LCD에 상시 게시한다.",
            "추천 배합비율·신뢰도, 원자재별 실시간 재고·임계재고 경고, 최근 배합 이력을 한 화면에 표시한다.",
            "재고 부족으로 인한 생산 차질을 사전에 방지한다.",
        ],
        "how": [
            "안전재고 임계치 개념이 설계에 없던 문제는 <code>RCV_STOCK_THRESHOLDS</code> "
            "테이블을 새로 세워 해결했다 — 품목별 안전재고 수량·주의 임계 수량·경고 단계"
            "(정상/주의/부족)·현황판 게시여부를 둔다.",
            "재고는 <code>RCV_LOTS.REMAIN_QTY</code>(입고LOT 잔량)를 품목별로 합산해 구하고, "
            "그 값을 안전재고 기준과 대비해 경고 단계를 판정한다.",
            "배합 추천값은 기존 배합비율 최적화(MES-TD3-012)가 적재한 "
            "<code>ANL_BLEND_RECOMMENDATIONS</code>를 읽기만 한다 — 현황판은 새로 계산하지 않는다.",
        ],
        "modules": "AI 대시보드(신규 화면) · 성분분석관리 · 입고보관관리 · 데이터허브관리",
        "open": [
            ("현황판 설치 위치·대수", "생산현장 입구 55\" LCD 1대", "킥오프 '내용(안)' 채택 — 확정 필요"),
            ("갱신 주기", "1분 주기 자동 갱신", "킥오프 '내용(안)' 채택 — 확정 필요"),
            ("표시 원자재 범위", "Sn·Pb·Ag·Cu 4종 전체", "킥오프 '내용(안)' 채택 — 확정 필요"),
            ("재고 경고 기준(임계치)", "원자재별 안전재고 수량", "<b>미확정</b> — 도입기업 확정 전까지 경고 미동작"),
            ("화면 레이아웃", "상단 카드 / 중앙 차트 / 우측 경고 목록", "확정 필요"),
            ("FP 산정 반영", "7점(안) · 단위프로세스 2건", "사업비 산출내역서 반영 여부 협의 필요"),
        ],
    },
    "MES-TD3-044": {
        "req_quote": "매일 작업지시서를 화면에 띄워줘. 각 역할별로 보여주면 좋겠다.",
        "impact": "영향도 큼 — 3건 중 가장 큼",
        "asis": [
            "작업지시가 시스템화되어 있지 않고, 현장에서 구두·수기 문서로 전달되는 것으로 추정된다(확인 필요).",
            "작업조건관리(MES-AD2-021)는 '공정 조건 기준'을 다루지만, "
            "'오늘 무엇을 얼마나 생산하는지'를 지시하는 기능은 없다.",
        ],
        "tobe": [
            "공정관리 모듈에 '작업지시관리' 기능을 신설한다.",
            "매일 생성되는 작업지시서를 역할(공정)별로 구분해 현장 화면에 자동 게시한다.",
            "담당자는 로그인한 화면에서 본인 담당 공정의 작업지시만 확인한다.",
        ],
        "how": [
            "'역할별로 보여준다'를 데이터 구조로 풀었다 — 지시 헤더"
            "(<code>PRC_WORK_ORDERS</code>)와 공정별 지시(<code>PRC_WORK_ORDER_TASKS</code>)를 "
            "나누고, 후자의 <code>PROCESS_ID</code>가 <code>BAS_PROCESSES</code>의 8개 공정을, "
            "<code>ASSIGNEE_ID</code>가 <code>SYS_USERS</code>를 가리킨다. 즉 <b>역할 = 공정</b>이다.",
            "담당자가 배정되지 않은 지시는 그 공정 담당 전원에게 게시된다"
            "(<code>ASSIGNEE_ID</code> NULL 허용).",
            "생성 방식은 헤더의 <code>CREATE_TYPE</code>(수동/ERP연계)이 가른다 — 1단계는 수동 입력, "
            "ERP 생산계획 연계 자동 생성은 ERP 연계 방식(MES-AD2-059) 확정 후 2단계로 켠다.",
            "지시에 실을 배합비율은 <code>BLEND_REC_ID</code>로 "
            "<code>ANL_BLEND_RECOMMENDATIONS</code>를, 작업조건 기준은 "
            "<code>BAS_WORK_STANDARDS</code>·<code>PRC_WORK_CONDITIONS</code>를 참조한다.",
        ],
        "modules": "공정관리(신규 기능) · 기준정보관리 · 사용자/시스템관리 · AI Agent 통합관리",
        "open": [
            ("작업지시서 생성 주체", "1단계 수동 입력 / 2단계 ERP 생산계획 연계",
             "ERP 연계 방식(MES-AD2-059) 확정이 선행"),
            ("작업지시서 포함 항목", "생산 품목·목표 수량·배합비율·담당 공정·작업조건 기준",
             "킥오프 '내용(안)' 채택 — 확정 필요"),
            ("역할 구분 기준", "8개 공정별(입고·보관/용해/성분분석/주조/압출/절단/품질검사/포장·출하)",
             "직무별 구분이 필요하면 재설계"),
            ("게시 화면(단말)", "현장 17\" Panel PC + 관리자 Web", "Smart Pad 포함 여부 확정 필요"),
            ("현행 전달 방식", "구두·수기로 추정", "<b>확인 필요</b> — 현행 확인 후 전환 범위 결정"),
            ("FP 산정 반영", "11점(안) · 단위프로세스 3건",
             "<b>신규 FP 산정 및 추가 계약 범위 협의 필요</b>"),
        ],
    },
    "MES-TD3-045": {
        "req_quote": "출하 시 출고서류를 자동으로 뽑아주면 좋겠다.",
        "impact": "영향도 작음~중간",
        "asis": [
            "출하 정보는 수기·Excel로 관리되며, 출고서류도 수작업으로 작성되는 것으로 추정된다(확인 필요).",
            "ERP 연계 방식(API/DB연동/Excel)이 아직 미확정 — 서류 자동화와 직결되는 선행 사안이다.",
        ],
        "tobe": [
            "출하 승인이 완료되는 시점에 시스템이 출고서류를 자동 생성한다.",
            "포장 시점의 바코드·중량 데이터가 출고서류에 자동 반영되는 구조를 지향한다.",
        ],
        "how": [
            "양식과 발행이력을 나눴다 — <code>SHP_DOCUMENT_TEMPLATES</code>가 서류 종류별 양식과 "
            "포함 항목 매핑(<code>FIELD_MAP</code>)을 들고, <code>SHP_DOCUMENTS</code>가 "
            "발행 건별 이력을 쌓는다. 양식이 바뀌어도 과거 발행분은 그대로 남는다.",
            "'바코드·중량 자동 반영'은 <code>SHP_DOCUMENTS</code>의 "
            "<code>TOTAL_WEIGHT</code>·<code>BARCODE_NO</code>가 포장 시점 "
            "<code>SHP_PACKINGS</code>에서 채워지는 구조로 잡았다.",
            "품질성적서는 <code>SHP_INSPECTIONS</code>(검사결과관리)가, 거래명세서는 "
            "<code>SHP_SHIPMENT_ITEMS</code>가 근거가 된다 — 해당 데이터가 등록되지 않으면 "
            "그 서류는 발행되지 않는다.",
            "기존 출하관리(MES-AD2-014)의 범위를 넓히는 것이므로 기능대비표 구분은 "
            "'추가'가 아니라 <b>'변경'</b>으로 판정했다.",
        ],
        "modules": "포장출하관리(기능 확장) · 데이터허브관리 · 시스템 연계(ERP 연계 인터페이스)",
        "open": [
            ("출고서류 종류", "거래명세서 / 출하증명서 / 품질성적서 3종", "킥오프 '내용(안)' 채택 — 확정 필요"),
            ("서류 양식", "기존 ERP 양식 재사용 전제",
             "<b>ERP 연계 방식 확정이 선행 과제</b> — 확정 전까지 양식·항목 잠정"),
            ("발행 방식", "PDF 다운로드 기본 + 인쇄 + 이메일 발송", "킥오프 '내용(안)' 채택 — 확정 필요"),
            ("바코드·중량 연동 범위", "포장 시점 SHP_PACKINGS 데이터 자동 반영", "연동 항목 확정 필요"),
            ("서류 포함 데이터 항목", "SHP_DOCUMENT_TEMPLATES.FIELD_MAP 으로 관리",
             "<b>미확정</b> — ERP 양식 확정 후 채움"),
            ("FP 산정 반영", "9점(안) · 단위프로세스 2건", "ERP 연계 방식에 따라 변동 가능"),
        ],
    },
}

CSS = """
:root{--navy:#1f3864;--navy-d:#162848;--blue:#2f6fc0;--blue-l:#c3d8f3;--ink:#1c2430;
--ink2:#4a5566;--ink3:#7a8598;--line:#d5dae2;--soft:#f2f5fa;--amber:#b8802a;
--amber-bg:#fbf7ec;--green:#4e8f43;--paper:#fff}
*{box-sizing:border-box}
body{margin:0;background:#eef1f6;color:var(--ink);
font:14px/1.65 "맑은 고딕","Malgun Gothic","Apple SD Gothic Neo",system-ui,sans-serif}
.page{max-width:1080px;margin:0 auto;background:var(--paper);
box-shadow:0 1px 3px rgba(0,0,0,.12);padding:0 0 64px}
header.top{background:var(--navy);color:#fff;padding:26px 40px}
header.top h1{margin:0 0 6px;font-size:23px;letter-spacing:-.4px}
header.top .sub{font-size:12.5px;color:#b9c7e0;line-height:1.7}
.tag{display:inline-block;background:rgba(255,255,255,.15);border-radius:3px;
padding:1px 7px;font-size:11px;margin-left:8px;vertical-align:2px}
main{padding:0 40px}
h2.sec{font-size:18px;margin:38px 0 14px;padding-bottom:9px;
border-bottom:2px solid var(--navy);color:var(--navy)}
h3{font-size:15px;margin:26px 0 10px;color:var(--navy-d);
padding-left:9px;border-left:3px solid var(--blue)}
h4{font-size:13.5px;margin:18px 0 7px;color:var(--ink2)}
p{margin:8px 0}
table{border-collapse:collapse;width:100%;font-size:12.5px;margin:10px 0}
th,td{border:1px solid var(--line);padding:6px 9px;text-align:left;vertical-align:top}
th{background:var(--soft);color:var(--navy-d);font-weight:600;white-space:nowrap}
td.c,th.c{text-align:center;white-space:nowrap}
code{background:var(--soft);border:1px solid var(--line);border-radius:3px;
padding:0 4px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px}
ul{margin:7px 0;padding-left:20px}li{margin:3px 0}
.badge{display:inline-block;border-radius:3px;padding:1px 7px;font-size:11px;font-weight:600}
.b-add{background:#e7f2e5;color:var(--green);border:1px solid #bcd9b6}
.b-chg{background:#fdf2dd;color:var(--amber);border:1px solid #e8d3a4}
.b-new{background:#e8f0fb;color:var(--blue);border:1px solid var(--blue-l)}
.note{background:var(--amber-bg);border:1px solid #e8d3a4;border-left:3px solid var(--amber);
padding:10px 13px;margin:12px 0;font-size:12.5px}
.card{border:1px solid var(--line);border-radius:5px;margin:14px 0;overflow:hidden}
.card>.h{background:var(--soft);border-bottom:1px solid var(--line);
padding:7px 12px;font-weight:600;font-size:13px;color:var(--navy-d)}
.card>.b{padding:12px 14px}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.mock{border:1px solid var(--line);border-radius:5px;overflow:hidden;margin:12px 0}
.mock img{display:block;width:100%}
.mock .cap{background:var(--soft);border-top:1px solid var(--line);
padding:6px 11px;font-size:11.5px;color:var(--ink3)}
.kv{display:grid;grid-template-columns:130px 1fr;gap:5px 12px;font-size:12.5px;margin:6px 0}
.kv dt{color:var(--ink3)}.kv dd{margin:0}
footer{margin-top:40px;padding:16px 40px;border-top:1px solid var(--line);
font-size:11.5px;color:var(--ink3);display:flex;gap:14px;flex-wrap:wrap}
@media print{
 body{background:#fff}
 .page{box-shadow:none;max-width:none;padding:0}
 h3,.card,.mock,table{break-inside:avoid}
 h2.sec{break-before:page}
 h2.sec:first-of-type{break-before:auto}
 @page{size:A4 portrait;margin:14mm}
}
"""


def esc(s) -> str:
    return html.escape(str(s or ""))


def img_uri(path: Path) -> str:
    return "data:image/png;base64," + base64.b64encode(path.read_bytes()).decode()


def bullets(items) -> str:
    return "<ul>" + "".join(f"<li>{i}</li>" for i in items) + "</ul>"


def columns_table(cols) -> str:
    head = ("<tr><th>항목명</th><th>컬럼명</th><th>타입</th><th class='c'>PK</th>"
            "<th class='c'>FK</th><th class='c'>NULL</th><th>비고</th></tr>")
    rows = "".join(
        "<tr>"
        f"<td>{esc(c[0])}</td><td><code>{esc(c[1])}</code></td><td>{esc(c[2])}</td>"
        f"<td class='c'>{esc(c[3])}</td><td class='c'>{esc(c[4])}</td>"
        f"<td class='c'>{esc(c[5])}</td><td>{esc(c[6]) if len(c) > 6 else ''}</td>"
        "</tr>" for c in cols)
    return f"<table>{head}{rows}</table>"


def section(s: dict, imp: dict, assets: Path, idx: int) -> str:
    req, prog = s["requirement"], s["program"]
    kind = s["changeType"]
    kcls = "b-add" if kind == "추가" else "b-chg"
    out = [f"<h2 class='sec'>{idx}. {esc(s['name'])} "
           f"<span class='badge {kcls}'>{esc(kind)}</span></h2>"]

    out.append(f"<div class='note'><b>고려솔더 요청 원문</b> — “{esc(imp['req_quote'])}”"
               f"<br><span style='color:var(--ink3)'>{esc(imp['impact'])} · 출처 {esc(SOURCE)}</span></div>")

    # ---- 요구사항 (AD2) ---- #
    out.append("<h3>요구사항 (SF-AD2 요구사항정의서)</h3>")
    out.append("<dl class='kv'>"
               f"<dt>요구사항ID</dt><dd><code>{esc(req['id'])}</code></dd>"
               f"<dt>요구사항명</dt><dd>{esc(req['name'])}</dd>"
               f"<dt>구분(SF-AD3)</dt><dd>{esc(kind)}</dd>"
               f"<dt>연계 모듈</dt><dd>{imp['modules']}</dd>"
               f"<dt>담당자</dt><dd>{esc(req.get('owner', '').strip())}</dd>"
               "</dl>")
    out.append(f"<p>{esc(req['description'])}</p>")
    out.append("<h4>세부 기능 · FP 산정(안)</h4>")
    out.append(bullets(esc(l) for l in req["details"].split("\n") if l.strip()))
    out.append("<h4>제약사항</h4>")
    out.append(f"<p>{esc(req['constraints'])}</p>")
    out.append("<h4>비고</h4>")
    out.append(f"<p>{esc(req['notes'])}</p>")

    # ---- 개선업무 ---- #
    out.append("<h3>개선업무 (AS-IS → TO-BE)</h3>")
    out.append("<div class='grid2'>"
               f"<div class='card'><div class='h'>AS-IS · 현재</div><div class='b'>"
               f"{bullets(esc(x) for x in imp['asis'])}</div></div>"
               f"<div class='card'><div class='h'>TO-BE · 개선 후</div><div class='b'>"
               f"{bullets(esc(x) for x in imp['tobe'])}</div></div></div>")
    out.append("<h4>설계로 풀어낸 방식</h4>")
    out.append(bullets(imp["how"]))  # 태그가 들어 있으므로 이스케이프하지 않는다

    # ---- 화면 (TD3) ---- #
    out.append("<h3>화면 (SF-TD3 화면설계서)</h3>")
    out.append("<dl class='kv'>"
               f"<dt>화면ID</dt><dd><code>{esc(s['id'])}</code></dd>"
               f"<dt>화면명</dt><dd>{esc(s['name'])}</dd>"
               f"<dt>화면 경로</dt><dd>{esc(s['path'])}</dd>"
               f"<dt>적용 채널</dt><dd>{esc(s['channels'])}</dd>"
               "</dl>")
    out.append(f"<h4>화면 구성</h4><p>{esc(s['composition'])}</p>")
    out.append(f"<h4>화면 항목 · 처리 절차</h4><p>{esc(s['items'])}</p>")
    png = assets / f"td3-{s['id']}.png"
    if png.exists():
        out.append(f"<div class='mock'><img alt='{esc(s['name'])} 목업' src='{img_uri(png)}'>"
                   f"<div class='cap'>{esc(s['id'])} {esc(s['name'])} 화면 목업 — "
                   "설계 기준 와이어프레임이며 그리드·차트 수치는 예시값이다</div></div>")

    # ---- 프로그램 (TD4) ---- #
    out.append("<h3>프로그램 (SF-TD4 프로그램설계서)</h3>")
    out.append(f"<dl class='kv'><dt>프로그램ID</dt><dd><code>{esc(prog['id'])}</code></dd>"
               f"<dt>프로그램명</dt><dd>{esc(prog['name'])}</dd></dl>")
    out.append(f"<h4>처리 흐름</h4><p>{esc(prog['flow'])}</p>")
    out.append("<h4>기능</h4>")
    out.append(bullets(esc(l) for l in prog["functions"].split("\n") if l.strip()))

    # ---- 필요데이터 (TD5) ---- #
    tables = s["tables"]
    new_n = sum(1 for t in tables if t["name"] in NEW_TABLES)
    out.append(f"<h3>필요데이터 (SF-TD5 데이터베이스설계서) — {len(tables)}종"
               f"{f', 이 중 신규 {new_n}종' if new_n else ''}</h3>")
    rows = "".join(
        f"<tr><td><code>{esc(t['name'])}</code></td><td>{esc(t['label'])}</td>"
        f"<td>{esc(t['area'])}</td><td class='c'>"
        f"{'<span class=badge b-new>신규</span>' if t['name'] in NEW_TABLES else '기존'}</td>"
        f"<td class='c'>{len(t['columns'])}</td></tr>" for t in tables)
    out.append("<table><tr><th>테이블명</th><th>한글명</th><th>업무영역</th>"
               f"<th class='c'>구분</th><th class='c'>컬럼</th></tr>{rows}</table>")

    for t in tables:
        tag = " <span class='badge b-new'>신규</span>" if t["name"] in NEW_TABLES else ""
        out.append(f"<div class='card'><div class='h'><code>{esc(t['name'])}</code> "
                   f"{esc(t['label'])}{tag}</div><div class='b'>")
        if t.get("basis"):
            out.append(f"<p style='color:var(--ink3);font-size:12px'>{esc(t['basis'])}</p>")
        out.append(columns_table(t["columns"]) if t["columns"]
                   else "<p style='color:var(--ink3)'>컬럼 정의 없음</p>")
        out.append("</div></div>")

    # ---- 확인 필요 ---- #
    out.append("<h3>확인 · 결정 필요 사항</h3>")
    rows = "".join(f"<tr><td>{esc(a)}</td><td>{esc(b)}</td><td>{c}</td></tr>"
                   for a, b, c in imp["open"])
    out.append("<table><tr><th style='width:190px'>항목</th><th>반영한 값</th>"
               f"<th style='width:290px'>상태</th></tr>{rows}</table>")
    return "\n".join(out)


def main() -> int:
    if not SPEC.exists():
        sys.exit(f"보존본이 없습니다: {SPEC}\n"
                 f"tools/build_addendum.py 로 먼저 보존본을 만드세요.")
    spec = json.loads(SPEC.read_text(encoding="utf-8"))
    screens = spec["areas"][0]["screens"]
    assets = Path(spec["sources"]["assetsDir"])
    m = spec["meta"]

    missing = [s["id"] for s in screens if s["id"] not in IMPROVE]
    if missing:
        sys.exit(f"개선업무(AS-IS/TO-BE)가 적히지 않은 화면: {', '.join(missing)}")

    summary = "".join(
        f"<tr><td class='c'>{i}</td><td><code>{esc(s['requirement']['id'])}</code></td>"
        f"<td>{esc(s['name'])}</td><td>{esc(s['path'].split(' > ')[1])}</td>"
        f"<td><code>{esc(s['id'])}</code></td><td><code>{esc(s['program']['id'])}</code></td>"
        f"<td class='c'><span class='badge "
        f"{'b-add' if s['changeType'] == '추가' else 'b-chg'}'>{esc(s['changeType'])}</span></td>"
        f"<td class='c'>{len(s['tables'])}종</td>"
        f"<td>{esc(IMPROVE[s['id']]['impact'])}</td></tr>"
        for i, s in enumerate(screens, 1))

    body = "\n".join(section(s, IMPROVE[s["id"]], assets, i)
                     for i, s in enumerate(screens, 1))

    doc = f"""<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>고려솔더 제조AI 신규 요구사항 3건 상세설명서</title>
<style>{CSS}</style></head><body><div class="page">
<header class="top">
  <h1>{esc(m['system_name'])} 신규 요구사항 3건 상세설명서<span class="tag">킥오프 추가</span></h1>
  <div class="sub">
    {esc(m['program_title'])} · 과제번호 {esc(m['project_no'])}<br>
    도입기업 {esc(m['company'])} · 공급기업 {esc(m['supplier'])} · {esc(m['version'])} ({esc(m['date'])})
  </div>
</header>
<main>
<h2 class="sec">개요</h2>
<p>2026-08 킥오프 회의에서 고려솔더가 추가로 요청한 3건을, 요구사항 · 개선업무 · 화면 ·
프로그램 · 필요데이터로 전개한 문서다. 한 건마다
<b>요구사항(SF-AD2) → 개선업무(AS-IS/TO-BE) → 화면(SF-TD3) → 프로그램(SF-TD4) →
필요데이터(SF-TD5)</b> 순으로 적었다.</p>

<div class="note">
<b>기존 납품본과의 관계</b> — 본 3건은 <b>계약 범위(화면 42건) 밖</b>이며 별도로 관리한다.
SF-AD1~AD3 · SF-TD1~TD5 본 산출물과 화면설명서·화면정의서는 42건 기준 그대로이고,
여기에 3건은 실려 있지 않다. 요구사항ID <code>MES-AD2-063~065</code>는 이 문서와
별도 화면정의서에서만 쓰는 번호이며, 본 산출물에 편입할 때는 그 시점의 번호 체계를
다시 확인해야 한다(현행 본 산출물에서 063~075는 비기능 요구사항이 쓰고 있다).
FP 점수는 모두 <b>산정(안)</b>이며 사업비 산출내역서 반영은 협의 후 확정한다.
</div>

<h2 class="sec">요약</h2>
<table>
<tr><th class="c">No</th><th>요구사항ID</th><th>요구사항명</th><th>업무영역</th>
<th>화면ID</th><th>프로그램ID</th><th class="c">구분</th><th class="c">필요데이터</th><th>영향도</th></tr>
{summary}
</table>
<p style="font-size:12.5px;color:var(--ink2)">신규 테이블 5종 —
<code>RCV_STOCK_THRESHOLDS</code>(안전재고기준) ·
<code>PRC_WORK_ORDERS</code>(작업지시) · <code>PRC_WORK_ORDER_TASKS</code>(작업지시공정별) ·
<code>SHP_DOCUMENTS</code>(출고서류발행) · <code>SHP_DOCUMENT_TEMPLATES</code>(출고서류양식).
나머지는 기존 설계서의 테이블을 읽기만 한다.</p>

{body}
</main>
<footer>
  <span>근거 : {esc(SOURCE)}</span>
  <span>설계 근거 : SF-AD2 · SF-TD3 · SF-TD4 · SF-TD5 (고려솔더 제조AI 시스템)</span>
  <span>{esc(m['status'])} · 목업 수치는 모두 예시값</span>
</footer>
</div></body></html>"""

    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(doc, encoding="utf-8")
    print(f"{OUT.name} ({len(doc.encode()) / 1024:.0f} KB)")
    for i, s in enumerate(screens, 1):
        n = len(s["tables"])
        new = sum(1 for t in s["tables"] if t["name"] in NEW_TABLES)
        cols = sum(len(t["columns"]) for t in s["tables"])
        print(f"  {i}. {s['name']:<14} {s['requirement']['id']} / {s['id']} / "
              f"{s['program']['id']} — 테이블 {n}종(신규 {new}) 컬럼 {cols}개")
    return 0


if __name__ == "__main__":
    sys.exit(main())
