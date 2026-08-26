/**
 * SF-TD3 §1.1 디자인 토큰 — 공용 UI 컴포넌트 전용 상수.
 *
 * 규칙
 *  - 여기 없는 색상은 공용 컴포넌트에서 쓰지 않는다 (임의 색상 금지).
 *  - 값은 `var(--토큰, TD3 HEX)` 형태다. 앱 안에서는 globals.css 의 CSS 변수가
 *    이기고(=기존 44화면과 픽셀 단위로 동일), globals.css 가 없는 환경
 *    (Storybook·단위테스트·SSR 스냅샷)에서는 SF-TD3 §1.1 HEX 로 폴백된다.
 *
 * ⚠ **정의는 여기 있지 않다.** hex·CSS 변수명의 단일 소스는 `@/lib/tokens` 다.
 *    이 파일은 DOM 인라인 스타일이 바로 쓸 수 있는 문자열 형태로 파생시킬 뿐이다.
 *    새 색을 추가하려면 `lib/tokens.ts` 의 `TOKENS` 에 추가해라.
 *    (`components/charts/tokens.ts` 는 canvas 용으로 같은 소스를 **실제 hex** 로 해석한다.
 *     두 벌이 필요한 이유는 `lib/tokens.ts` 상단 "소비 방식" 표 참고.)
 *
 * ⚠ 알려진 불일치 (문서 vs 코드) — 최종 판정은 specs/design-standards.md §4
 *    Border      SF-TD3 `#E2E6EF`  vs  globals.css `--color-border: #E4E7EC`
 *    Text        SF-TD3 `#1A2035`  vs  globals.css `--color-text:   #161B26`
 *    44화면·DataTable 이 전부 globals.css 값을 하드코딩해 쓰고 있으므로 **변수를 우선한다.**
 */

import { cssToken, TYPOGRAPHY } from "@/lib/tokens";

export const T = {
  /** 주요 버튼·강조 요소 */
  primary: cssToken("primary"),
  /** 호버·그라디언트 */
  primaryLight: cssToken("primaryLight"),
  /** 카드/패널 배경 */
  surface: cssToken("surface"),
  /** 입력 필드 등 옅은 면 (globals.css `.btn:hover` 와 동일) */
  surfaceSubtle: cssToken("surfaceSubtle"),
  /** 본문 텍스트 */
  text: cssToken("text"),
  /** 보조 텍스트 */
  textSub: cssToken("textSub"),
  /** 흐린 텍스트·플레이스홀더·아이콘 */
  textMuted: cssToken("textMuted"),
  /** 구분선 */
  border: cssToken("border"),
  /** 사이드바 배경 — 모달 오버레이 바탕색으로도 쓴다 */
  sidebar: cssToken("sidebar"),
  /** 합격/정상 */
  success: cssToken("success"),
  /** 경고 */
  warning: cssToken("warning"),
  /** 불합격/오류 */
  error: cssToken("error"),
} as const;

/** SF-TD3 §1.2 타이포그래피 — 공용 컴포넌트가 쓰는 하위 집합 */
export const TYPE = {
  /** 섹션 제목 16/600 */
  section: TYPOGRAPHY.section,
  /** 시스템 기본 14/400 */
  body: TYPOGRAPHY.body,
  /** 테이블 헤더 12/600 — 필터 라벨에도 사용 */
  label: TYPOGRAPHY.label,
  /** 레이블/캡션 11/400 */
  caption: TYPOGRAPHY.caption,
} as const;

/** 모달 오버레이 — 44화면이 쓰던 rgba(14,19,32,.5~.55) 를 하나로 고정 */
export const OVERLAY_BG = "rgba(14, 19, 32, 0.55)";

/** 모달 패널 그림자 — 44화면이 쓰던 3가지 변형을 하나로 고정 */
export const MODAL_SHADOW = "0 20px 60px rgba(14, 19, 32, 0.2)";
