/**
 * 디자인 토큰 **단일 소스** — SF-TD3 §1.1 컬러 팔레트 / §1.2 타이포그래피.
 *
 * 웨이브 B 에서 토큰 정의가 두 벌로 갈라졌다.
 *   - `components/ui/tokens.ts` (디자이너2) — `var(--x, #hex)` 문자열. DOM 인라인 스타일용
 *   - `components/charts/tokens.ts` (디자이너1) — 런타임에 CSS 변수를 읽어 **실제 hex** 로 해석. canvas 용
 *
 * 두 소비 방식은 **진짜로 다르다** (아래 §소비 방식 참고). 그래서 파일 두 개는 남기되,
 * "어떤 토큰이 어떤 hex 이고 어떤 CSS 변수에 대응하는가" 라는 **정의는 이 파일 하나**로 모은다.
 * 두 파일은 여기서 파생만 한다. 새 색을 추가하려면 `TOKENS` 에만 추가하면 된다.
 *
 * ## 소비 방식
 *
 * | 대상 | 필요한 형태 | 이유 |
 * |---|---|---|
 * | DOM `style={{ color }}` | `"var(--color-text, #1A2035)"` | 브라우저가 변수를 해석한다. 테마 교체가 CSS 만으로 된다 |
 * | `<canvas>` 2D 컨텍스트 | `"#161B26"` (실제 hex) | `ctx.fillStyle = "var(--x)"` 는 **동작하지 않는다**. 무시되고 검정이 된다 |
 * | 색 연산 (`toRgba`·`mixColors`) | 실제 hex | 문자열 `var(...)` 는 파싱할 수 없다 |
 *
 * ## 문서 vs 구현 불일치 (디자이너3 최종 판정 — specs/design-standards.md §4)
 *
 * | 토큰 | SF-TD3 | globals.css | 현재 화면에 실제로 칠해지는 값 |
 * |---|---|---|---|
 * | Text Primary | `#1A2035` | `#161B26` | **`#161B26`** (44화면이 228곳에 하드코딩) |
 * | Border | `#E2E6EF` | `#E4E7EC` | **`#E4E7EC`** (44화면이 170곳에 하드코딩) |
 *
 * 판정: **CSS 변수가 이긴다.** `hex` 필드의 SF-TD3 값은 globals.css 가 없는 환경
 * (SSR·단위테스트·Storybook)의 폴백이자 스펙 원문 기록용이다. 44화면의 하드코딩이
 * 0이 되는 시점에 globals.css 를 TD3 값으로 한 번에 뒤집는다 — 그 전에 뒤집으면
 * 공용 컴포넌트와 페이지가 서로 다른 회색을 칠한다.
 */

export interface TokenDef {
  /** SF-TD3 §1.1 이 정한 HEX. globals.css 가 없을 때의 폴백 */
  hex: string;
  /** globals.css `:root` 변수명. 선언돼 있지 않으면 빈 문자열 */
  cssVar: string;
  /** 용도 */
  use: string;
}

export const TOKENS = {
  /** 주요 버튼, 강조 요소 */
  primary: { hex: "#3A5BD9", cssVar: "--color-primary", use: "주요 버튼·강조" },
  /** 호버, 그라디언트 */
  primaryLight: { hex: "#6B8AFF", cssVar: "--color-primary-light", use: "호버·그라디언트" },
  /** 전체 배경 */
  bg: { hex: "#EEF0F4", cssVar: "--color-bg", use: "전체 배경" },
  /** 사이드바 배경 */
  sidebar: { hex: "#0E1320", cssVar: "--color-sidebar", use: "사이드바 배경" },
  /** 사이드바 텍스트 */
  sidebarText: { hex: "#E7EAF0", cssVar: "--color-sidebar-text", use: "사이드바 텍스트" },
  /** 카드/패널 배경 */
  surface: { hex: "#FFFFFF", cssVar: "--color-white", use: "카드/패널 배경" },
  /** 옅은 면 — 입력 필드 바탕, 버튼 호버 */
  surfaceSubtle: { hex: "#F8F9FB", cssVar: "--color-surface-subtle", use: "입력 필드·호버 바탕" },
  /** 본문 텍스트 — ⚠ TD3 #1A2035 vs 구현 #161B26 */
  text: { hex: "#1A2035", cssVar: "--color-text", use: "본문 텍스트" },
  /** 보조 텍스트 */
  textSub: { hex: "#687182", cssVar: "--color-text-sub", use: "보조 텍스트" },
  /** 흐린 텍스트·플레이스홀더·아이콘 */
  textMuted: { hex: "#9AA4B2", cssVar: "--color-text-muted", use: "캡션·플레이스홀더" },
  /** 구분선 — ⚠ TD3 #E2E6EF vs 구현 #E4E7EC */
  border: { hex: "#E2E6EF", cssVar: "--color-border", use: "구분선·카드 테두리" },
  /** 그리드 라인 — TD3 표에는 없고 globals.css 회색 배지 배경을 쓴다 */
  grid: { hex: "#F2F4F7", cssVar: "--badge-gray-bg", use: "차트 그리드·구분면" },
  /** 합격/정상 */
  success: { hex: "#22C55E", cssVar: "--color-success", use: "합격·정상" },
  /** 경고 */
  warning: { hex: "#F59E0B", cssVar: "--color-warning", use: "경고" },
  /** 불합격/오류 */
  error: { hex: "#EF4444", cssVar: "--color-error", use: "불합격·오류" },
} as const satisfies Record<string, TokenDef>;

export type TokenName = keyof typeof TOKENS;

/** SF-TD3 §1.1 원문 hex 표. 색 연산·SSR 폴백의 기준값. */
export const TOKEN_HEX: Record<TokenName, string> = Object.fromEntries(
  (Object.keys(TOKENS) as TokenName[]).map((k) => [k, TOKENS[k].hex])
) as Record<TokenName, string>;

/** 토큰 → globals.css 변수명. 미선언이면 빈 문자열. */
export const TOKEN_VAR: Record<TokenName, string> = Object.fromEntries(
  (Object.keys(TOKENS) as TokenName[]).map((k) => [k, TOKENS[k].cssVar])
) as Record<TokenName, string>;

/**
 * DOM 인라인 스타일에 넣을 값 — `var(--x, #hex)`.
 * 앱 안에서는 globals.css 변수가 이기고(=44화면과 픽셀 단위로 동일),
 * 변수가 없는 환경에서는 SF-TD3 hex 로 떨어진다.
 */
export function cssToken(name: TokenName): string {
  const { cssVar, hex } = TOKENS[name];
  return cssVar ? `var(${cssVar}, ${hex})` : hex;
}

/**
 * 실행 시점에 해석된 **실제 색상 문자열**을 반환한다.
 * 브라우저에서는 `:root` 변수를 읽고, 서버·변수 미선언 시 SF-TD3 hex 를 쓴다.
 * canvas 와 색 연산처럼 `var()` 를 쓸 수 없는 곳 전용이다.
 */
export function readTokens(): Record<TokenName, string> {
  const resolved = { ...TOKEN_HEX };
  if (typeof window === "undefined" || typeof document === "undefined") return resolved;
  const style = window.getComputedStyle(document.documentElement);
  (Object.keys(TOKENS) as TokenName[]).forEach((key) => {
    const name = TOKENS[key].cssVar;
    if (!name) return;
    const value = style.getPropertyValue(name).trim();
    if (value) resolved[key] = value;
  });
  return resolved;
}

/** SF-TD3 §1.2 타이포그래피 전체. */
export const TYPOGRAPHY = {
  /** 시스템 기본 14/400 */
  body: { fontSize: 14, fontWeight: 400 },
  /** 페이지 제목 22/700 — 각 페이지 <h1> */
  pageTitle: { fontSize: 22, fontWeight: 700 },
  /** 섹션 제목 16/600 */
  section: { fontSize: 16, fontWeight: 600 },
  /** 카드 수치 28/700 */
  metric: { fontSize: 28, fontWeight: 700 },
  /** 테이블 헤더 12/600 */
  label: { fontSize: 12, fontWeight: 600 },
  /** 레이블/캡션 11/400 */
  caption: { fontSize: 11, fontWeight: 400 },
} as const;

/** SF-TD3 §1.3 레이아웃 상수. */
export const LAYOUT = {
  /** 사이드바 266px 고정 */
  sidebarWidth: 266,
  /** 헤더 높이 */
  headerHeight: 60,
  /** 콘텐츠 패딩 = 섹션 간격 */
  contentPadding: 24,
  /** KPI 그리드 간격 */
  kpiGap: 16,
  /** 카드 그리드 간격 */
  cardGap: 20,
  /** 카드 라운드 */
  cardRadius: 12,
  /** 1280×800 지원 하한. 모바일 미지원 (SF-TD3 §5) */
  minSupportedWidth: 1280,
} as const;
