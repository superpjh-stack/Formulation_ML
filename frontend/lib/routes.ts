/**
 * 44화면 라우트 → 화면명 매핑 (SF-TD3 §2 메뉴 구조 · SF-CD1 `FE-RT-02~45`).
 *
 * 이 표가 프론트엔드의 **화면 식별 단일 진실**이다.
 *  - `tools/check_routes.py` 의 `SPEC_ROUTES` 와 **같은 44건**이다. 한쪽만 고치지 마라.
 *  - `components/layout/Sidebar.tsx` 의 `NAV_SECTIONS` 와도 순서·라벨이 일치한다.
 *    (Sidebar 는 링크 렌더링, 이 파일은 제목 조회 — 역할이 다르므로 의도적으로 분리돼 있다.
 *     `check_routes.py` 가 Sidebar 원문을 정규식으로 읽기 때문에 NAV_SECTIONS 는 그 자리에 남는다.)
 *  - FE-RT-01 은 `/` → `/dashboard/production` 리다이렉트라 이 표에 없다. 그래서 45가 아니라 44다.
 *
 * 화면명이 겹치는 3쌍이 있다 — `AI Agent` ×3(`/receiving|mixing|shipping/agent`),
 * `출하 현황` ×2(`/dashboard/shipping`, `/shipping/main`). 그래서 헤더는 화면명만이 아니라
 * `섹션 › 화면명` 형태로 표시한다. 화면명 단독으로는 사용자가 어디 있는지 구분할 수 없다.
 */

export interface RouteMeta {
  /** SF-CD1 화면ID */
  id: string;
  /** SF-TD3 §2 화면명 */
  title: string;
  /** SF-TD3 §2 메뉴 그룹 (사이드바 섹션 제목) */
  section: string;
}

export const ROUTE_META: Record<string, RouteMeta> = {
  // ── AI 대시보드 (4) ──────────────────────────────────────────────────────
  "/dashboard/production": { id: "FE-RT-02", title: "생산 현황", section: "AI 대시보드" },
  "/dashboard/quality": { id: "FE-RT-03", title: "품질 현황", section: "AI 대시보드" },
  "/dashboard/equipment": { id: "FE-RT-04", title: "설비 현황", section: "AI 대시보드" },
  "/dashboard/shipping": { id: "FE-RT-05", title: "출하 현황", section: "AI 대시보드" },

  // ── 입고관리 (5) ─────────────────────────────────────────────────────────
  "/receiving": { id: "FE-RT-06", title: "입고 현황", section: "입고관리" },
  "/receiving/history": { id: "FE-RT-07", title: "입고 이력", section: "입고관리" },
  "/receiving/data": { id: "FE-RT-08", title: "성분 데이터", section: "입고관리" },
  "/receiving/supplier": { id: "FE-RT-09", title: "공급사 관리", section: "입고관리" },
  "/receiving/agent": { id: "FE-RT-10", title: "AI Agent", section: "입고관리" },

  // ── 배합비율 최적화AI (5) ────────────────────────────────────────────────
  "/mixing/collect": { id: "FE-RT-11", title: "데이터 수집", section: "배합비율 최적화AI" },
  "/mixing/deviation": { id: "FE-RT-12", title: "성분 편차 분석", section: "배합비율 최적화AI" },
  "/mixing/predict": { id: "FE-RT-13", title: "품질 예측", section: "배합비율 최적화AI" },
  "/mixing/optimize": { id: "FE-RT-14", title: "배합 최적화", section: "배합비율 최적화AI" },
  "/mixing/agent": { id: "FE-RT-15", title: "AI Agent", section: "배합비율 최적화AI" },

  // ── 포장출하관리 (5) ─────────────────────────────────────────────────────
  "/shipping/main": { id: "FE-RT-16", title: "출하 현황", section: "포장출하관리" },
  "/shipping/lot": { id: "FE-RT-17", title: "LOT 관리", section: "포장출하관리" },
  "/shipping/inspect": { id: "FE-RT-18", title: "검사 결과", section: "포장출하관리" },
  "/shipping/claim": { id: "FE-RT-19", title: "클레임 관리", section: "포장출하관리" },
  "/shipping/agent": { id: "FE-RT-20", title: "AI Agent", section: "포장출하관리" },

  // ── 공정관리 (5) ─────────────────────────────────────────────────────────
  "/process/performance": { id: "FE-RT-21", title: "공정 실적", section: "공정관리" },
  "/process/monitor": { id: "FE-RT-22", title: "실시간 모니터", section: "공정관리" },
  "/process/condition": { id: "FE-RT-23", title: "공정 조건", section: "공정관리" },
  "/process/history": { id: "FE-RT-24", title: "이력 조회", section: "공정관리" },
  "/process/analysis": { id: "FE-RT-25", title: "공정 분석", section: "공정관리" },

  // ── 사용자/시스템관리 (4) ────────────────────────────────────────────────
  "/system/users": { id: "FE-RT-26", title: "사용자 관리", section: "사용자/시스템관리" },
  "/system/logs": { id: "FE-RT-27", title: "시스템 로그", section: "사용자/시스템관리" },
  "/system/notifications": { id: "FE-RT-28", title: "알림 설정", section: "사용자/시스템관리" },
  "/system/config": { id: "FE-RT-29", title: "시스템 설정", section: "사용자/시스템관리" },

  // ── 기준정보관리 (3) ─────────────────────────────────────────────────────
  "/master/quality": { id: "FE-RT-30", title: "품질 기준", section: "기준정보관리" },
  "/master/workstd": { id: "FE-RT-31", title: "작업 표준", section: "기준정보관리" },
  "/master/code": { id: "FE-RT-32", title: "코드 관리", section: "기준정보관리" },

  // ── 데이터관리시스템 (5) ─────────────────────────────────────────────────
  "/data/integrate": { id: "FE-RT-33", title: "데이터 연동", section: "데이터관리시스템" },
  "/data/query": { id: "FE-RT-34", title: "데이터 조회", section: "데이터관리시스템" },
  "/data/visualization": { id: "FE-RT-35", title: "시각화", section: "데이터관리시스템" },
  "/data/download": { id: "FE-RT-36", title: "다운로드", section: "데이터관리시스템" },
  "/data/training": { id: "FE-RT-37", title: "학습 데이터", section: "데이터관리시스템" },

  // ── AI Agent 관리 (5) ────────────────────────────────────────────────────
  "/agent/query": { id: "FE-RT-38", title: "질의 응답", section: "AI Agent 관리" },
  "/agent/analysis": { id: "FE-RT-39", title: "분석 요청", section: "AI Agent 관리" },
  "/agent/decision": { id: "FE-RT-40", title: "의사결정 지원", section: "AI Agent 관리" },
  "/agent/recommendations": { id: "FE-RT-41", title: "추천 이력", section: "AI Agent 관리" },
  "/agent/history": { id: "FE-RT-42", title: "Agent 로그", section: "AI Agent 관리" },

  // ── KPI 관리 (3) ─────────────────────────────────────────────────────────
  "/kpi/production": { id: "FE-RT-43", title: "생산 KPI", section: "KPI 관리" },
  "/kpi/quality": { id: "FE-RT-44", title: "품질 KPI", section: "KPI 관리" },
  "/kpi/manage": { id: "FE-RT-45", title: "KPI 설정", section: "KPI 관리" },
};

/** 스펙에 정의된 44개 라우트. 긴 것부터 정렬해 최장 일치(longest-prefix)에 바로 쓴다. */
const ROUTES_BY_LENGTH: string[] = Object.keys(ROUTE_META).sort(
  (a, b) => b.length - a.length
);

/**
 * pathname 에 대응하는 화면을 찾는다.
 *
 * **최장 접두사 일치**다. `/receiving` 과 `/receiving/history` 가 둘 다 스펙 라우트이므로
 * 단순 `startsWith` 로는 `/receiving/history` 에서 두 화면이 동시에 잡힌다.
 * 더 긴 쪽(=더 구체적인 쪽)만 남긴다. 이 규칙 하나로 44개 라우트 전부에서 정확히 하나가 잡힌다.
 *
 * 상세 라우트(`/shipping/lot/LOT-2026-0312` 같은 미래의 동적 세그먼트)는
 * 부모 화면(`/shipping/lot`)으로 귀속된다 — 의도된 동작이다.
 */
export function matchRoute(pathname: string | null | undefined): string | null {
  if (!pathname) return null;
  // 트레일링 슬래시 제거 (루트 "/" 는 유지)
  const p = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  for (const route of ROUTES_BY_LENGTH) {
    if (p === route || p.startsWith(route + "/")) return route;
  }
  return null;
}

/** pathname 의 화면 메타. 스펙 외 경로면 null. */
export function getRouteMeta(pathname: string | null | undefined): RouteMeta | null {
  const route = matchRoute(pathname);
  return route ? ROUTE_META[route] : null;
}

/** 헤더 슬롯에 넣을 화면명. 스펙 외 경로면 빈 문자열. */
export function getPageTitle(pathname: string | null | undefined): string {
  return getRouteMeta(pathname)?.title ?? "";
}

/** 헤더 브레드크럼 조각 `["입고관리", "입고 이력"]`. 스펙 외 경로면 빈 배열. */
export function getBreadcrumb(pathname: string | null | undefined): string[] {
  const meta = getRouteMeta(pathname);
  return meta ? [meta.section, meta.title] : [];
}
