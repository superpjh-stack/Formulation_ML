#!/usr/bin/env python3
"""킥오프 신규 요구사항만 담은 별도 화면정의서용 spec을 만든다.

기존 납품본(계약 범위 42건)은 건드리지 않고, 추가 요청분만 따로 묶어 협의 자리에
올리기 위한 것이다. `build_data.py`가 만든 45건짜리 `ui-spec.json`에서 신규 화면만
남기고, 업무영역을 **하나의 새 대분류로 합쳐 맨 아래에** 둔다.

  기존 45건 spec ──(이 스크립트)──> 신규 3건 spec ──> build_pptx.py ──> 별도 PPT

메뉴구조도·화면목록·프로그램 표기까지 그 대분류로 통일한다. 다만 **DB 테이블은
원래 업무영역에 그대로 둔다** — 테이블 이름이 RCV_/PRC_/SHP_ 접두사로 업무영역을
가리키므로, 여기서만 다른 영역으로 옮기면 명명규칙과 어긋난다.

**설계 실행본은 계약 범위 42건으로 되돌아가 있다.** 그래서 신규 3건은 `design.json`
에도, `assets/`의 목업 PNG에도 남아 있지 않다. 한 번 만든 결과를 `content/addendum-고려솔더/`
에 spec과 PNG까지 통째로 보존해 두었고, `--restore` 가 그것을 되살린다. 별도 화면정의서를
다시 뽑을 일이 있으면 이 경로를 쓴다.

사용법
  .venv/bin/python tools/build_addendum.py --combine   # 앱에서 42건과 신규 3건을 나란히 본다
  .venv/bin/python tools/build_addendum.py --restore   # 보존본 → ui-spec.json (평소 이것)
  .venv/bin/python tools/build_addendum.py --check     # 보존본에 무엇이 담겼는지만 본다
  .venv/bin/python tools/build_addendum.py --from-spec # 45건 ui-spec.json 에서 새로 뽑아 보존본까지 갱신
  이어서  .venv/bin/python tools/build_pptx.py
"""
import json
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SPEC = ROOT / "src" / "data" / "ui-spec.json"
ALL = ROOT / "src" / "data" / "all-specs.json"
KEEP = ROOT / "content" / "addendum-고려솔더"
KEEP_SPEC = KEEP / "ui-spec.json"

AREA = "신규 요구사항(킥오프 추가)"
SLUG = "고려솔더_신규요구사항3건"
NEW_IDS = ["MES-TD3-043", "MES-TD3-044", "MES-TD3-045"]

TITLE = "고려솔더 제조AI 시스템 신규 요구사항 3건 메뉴구조도"
FOOTER = ("2026-08 킥오프 회의에서 추가 요청된 3건. 기존 납품 범위(화면 42건)와 별도로 관리하며, "
          "FP 산정·계약 범위는 협의 후 확정한다")


def summarize_spec(spec: dict) -> dict:
    """메인화면 카드가 읽는 요약. `build_all.py` 와 같은 식으로 센다 —
    회사가 둘 이상이면 App 이 Home 을 띄우고, Home 은 이 값이 없으면 죽는다."""
    biz = [x for g in spec["areas"] for x in g["screens"]]
    counts = {"추가": 0, "변경": 0, "기존": 0}
    for x in biz:
        counts[x["changeType"]] = counts.get(x["changeType"], 0) + 1
    return {"areas": len(spec["areas"]), "screens": len(biz),
            "commons": len(spec["commonScreens"]),
            "tables": len({t["name"] for x in biz for t in x["tables"]}),
            "counts": counts}


def tag(spec: dict, slug: str) -> dict:
    kind = "제조AI" if "제조AI" in spec["meta"]["program_title"] else "스마트공장"
    return {**spec, "slug": slug, "kind": kind, "summary": summarize_spec(spec)}


def combine() -> int:
    """앱(all-specs.json)에 계약 범위 42건과 킥오프 추가 3건을 **나란히** 싣는다.

    3건을 42건 안에 섞으면 계약 범위가 조용히 늘어난다. 앱은 회사가 둘 이상이면
    선택 화면과 전환 셀렉트를 띄우므로, 그 구조를 그대로 빌려 두 벌로 나눠 담는다.

    `ui-spec.json` 은 42건 쪽으로 남겨 둔다 — `build_pptx.py` 가 그 파일을 읽으므로
    여기서 바꿔 두면 다음에 본 화면정의서를 만들 때 3장짜리가 나온다.

    주의: 이 상태로 `npm run build && bundle_singlefile.py` 를 돌리면 배포본이
    '회사별 화면설명서' 통합본 이름으로 나온다. 납품본을 다시 만들 때는
    `build_data.py 고려솔더 && build_all.py 고려솔더` 로 되돌린다."""
    if not KEEP_SPEC.exists():
        sys.exit(f"보존본이 없습니다: {KEEP_SPEC}")
    r = subprocess.run([sys.executable, str(ROOT / "tools" / "build_data.py"), "고려솔더"],
                       capture_output=True, text=True, cwd=ROOT)
    if r.returncode != 0:
        sys.exit(f"본 산출물 spec 생성 실패:\n{r.stdout}\n{r.stderr}")
    main_spec = json.loads(SPEC.read_text(encoding="utf-8"))
    add_spec = json.loads(KEEP_SPEC.read_text(encoding="utf-8"))

    companies = [tag(main_spec, "고려솔더"), tag(add_spec, SLUG)]
    ALL.write_text(json.dumps({"companies": companies}, ensure_ascii=False,
                              separators=(",", ":")), encoding="utf-8")
    for c in companies:
        s = c["summary"]
        print(f"  {c['slug']:<22} 업무화면 {s['screens']:>2}건 · 영역 {s['areas']}개 · "
              f"테이블 {s['tables']}종  (추가 {s['counts']['추가']} · "
              f"변경 {s['counts']['변경']} · 기존 {s['counts']['기존']})")
    print(f"\nall-specs.json → 2벌 (앱에서 선택·전환 가능)")
    print("ui-spec.json 은 42건 그대로 — build_pptx.py 가 본 화면정의서를 만들 때 쓴다.")
    return 0


def write_spec(spec: dict) -> None:
    kind = "제조AI" if "제조AI" in spec["meta"]["program_title"] else "스마트공장"
    SPEC.write_text(json.dumps(spec, ensure_ascii=False, indent=1), encoding="utf-8")
    ALL.write_text(json.dumps({"companies": [{**spec, "slug": SLUG, "kind": kind}]},
                              ensure_ascii=False, indent=1), encoding="utf-8")


def summarize(spec: dict) -> None:
    picked = spec["areas"][0]["screens"]
    print(f"{spec['areas'][0]['area']} — 화면 {len(picked)}건")
    for s in picked:
        req = (s.get("requirement") or {}).get("id", "—")
        prog = (s.get("program") or {}).get("id", "—")
        tbls = ", ".join(t["name"] for t in s["tables"])
        print(f"  {s['no']:>2} {s['id']} {s['name']:<14} {req} / {prog} / {s['changeType']}")
        print(f"     테이블 {len(s['tables'])}종 — {tbls}")


def restore() -> int:
    """보존본을 되살린다 — 설계 실행본이 42건으로 돌아가 있어도 PPT를 다시 뽑을 수 있다."""
    if not KEEP_SPEC.exists():
        sys.exit(f"보존본이 없습니다: {KEEP_SPEC}")
    spec = json.loads(KEEP_SPEC.read_text(encoding="utf-8"))
    assets = Path(spec["sources"]["assetsDir"])
    missing = [i for i in NEW_IDS if not (assets / f"td3-{i}.png").exists()]
    if missing:
        sys.exit(f"보존된 목업 이미지가 없습니다: {', '.join(missing)} (경로 {assets})")
    write_spec(spec)
    summarize(spec)
    print(f"\n보존본 → ui-spec.json / all-specs.json (목업 {assets})")
    print("이어서 tools/build_pptx.py 를 돌리면 별도 화면정의서가 나옵니다.")
    return 0


def main() -> int:
    if "--combine" in sys.argv:
        return combine()
    if "--restore" in sys.argv:
        return restore()
    check_only = "--check" in sys.argv
    if check_only and KEEP_SPEC.exists() and "--from-spec" not in sys.argv:
        summarize(json.loads(KEEP_SPEC.read_text(encoding="utf-8")))
        print(f"\n--check — 보존본({KEEP_SPEC.name})을 읽기만 했습니다.")
        return 0

    if not SPEC.exists():
        sys.exit("src/data/ui-spec.json 이 없습니다. build_data.py 를 먼저 돌리세요.")
    spec = json.loads(SPEC.read_text(encoding="utf-8"))

    picked = [s for g in spec["areas"] for s in g["screens"] if s["id"] in NEW_IDS]
    missing = sorted(set(NEW_IDS) - {s["id"] for s in picked})
    if missing:
        sys.exit(f"신규 화면을 찾지 못했습니다: {', '.join(missing)}\n"
                 f"신규 요구사항이 반영된 design.json 으로 build_data.py 를 돌린 뒤 실행하세요.")
    picked.sort(key=lambda s: s["id"])

    # 화면 순번은 이 문서 안에서 1부터 다시 매긴다 — 원본 순번(05·20·26)을 그대로
    # 두면 3장짜리 문서에 26번이 나와 읽는 사람이 빠진 화면을 찾게 된다.
    for i, s in enumerate(picked, start=1):
        s["no"] = i
        s["area"] = AREA

    rows = {r[1]: r for r in spec["screenList"]}
    screen_list = []
    for i, s in enumerate(picked, start=1):
        no, sid, _area, name, pid, kind = rows[s["id"]]
        screen_list.append([str(i), sid, AREA, name, pid, kind])

    spec["areas"] = [{"area": AREA, "screens": picked}]
    spec["screenList"] = screen_list
    spec["menuDiagram"] = {
        "kind": "tree",
        "title": TITLE,
        "branches": [{"name": AREA, "tone": "amber", "items": [s["name"] for s in picked]}],
        "footer": FOOTER,
    }
    # 공통화면(메인·로그인·팝업·대시보드)은 기존 납품본에 이미 실렸다. 추가분 문서에
    # 다시 넣으면 신규 3건이 4건에 묻힌다.
    spec["commonScreens"] = []
    spec["meta"] = {**spec["meta"], "slug": SLUG,
                    "design_scope": "킥오프 신규 요구사항 3건 — 화면 3종 · 프로그램 3종 · 신규 테이블 5종"}

    summarize(spec)

    if check_only:
        print("\n--check — 파일을 바꾸지 않았습니다.")
        return 0

    # 목업 PNG까지 함께 보존한다. 설계 실행본이 42건으로 되돌아가면 이 그림들이
    # 지워지고, 그러면 별도 화면정의서를 두 번 다시 만들 수 없다.
    src_assets = Path(spec["sources"]["assetsDir"])
    KEEP.mkdir(parents=True, exist_ok=True)
    (KEEP / "assets").mkdir(exist_ok=True)
    for sid in NEW_IDS:
        png = src_assets / f"td3-{sid}.png"
        if png.exists():
            shutil.copy2(png, KEEP / "assets" / png.name)
    spec["sources"]["assetsDir"] = str((KEEP / "assets").resolve())
    spec["sources"]["note"] = (
        "설계 실행본은 계약 범위 42건으로 되돌렸으므로 신규 3건의 목업 PNG가 그 폴더에 "
        "없다. 이 보존본이 별도 화면정의서의 유일한 재생성 근거다.")
    KEEP_SPEC.write_text(json.dumps(spec, ensure_ascii=False, indent=1), encoding="utf-8")

    write_spec(spec)
    print(f"\n보존 {KEEP_SPEC.relative_to(ROOT)} (목업 {len(NEW_IDS)}장 포함)")
    print(f"ui-spec.json / all-specs.json → 신규 3건으로 교체 (slug {SLUG})")
    print("이어서 tools/build_pptx.py 를 돌리면 별도 화면정의서가 나옵니다.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
