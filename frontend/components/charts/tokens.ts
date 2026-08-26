// ── 차트 디자인 토큰 ──────────────────────────────────────────────────────────
// SF-TD3 §1.1 컬러 팔레트를 **실제 hex 문자열**로 해석해서 준다.
//
// ⚠ 정의는 여기 있지 않다. hex·CSS 변수명의 단일 소스는 `@/lib/tokens` 다.
//    이 파일은 canvas 전용 파생물이다 — `ctx.strokeStyle = "var(--x)"` 는 동작하지 않고,
//    `toRgba`·`mixColors` 도 `var(...)` 문자열은 파싱할 수 없어서 실제 색이 필요하다.
//    (DOM 인라인 스타일용 `var(--x, #hex)` 형태는 `components/ui/tokens.ts` 가 준다.
//     두 벌이 필요한 이유는 `lib/tokens.ts` 상단 "소비 방식" 표 참고.)
//
// 가능한 값은 globals.css 의 CSS 변수에서 읽고, 변수가 없으면 SF-TD3 HEX 로 떨어진다.
// 차트 코드에 임의 색상을 적지 않는다.

import { readTokens, TOKEN_HEX, type TokenName } from "@/lib/tokens";

export interface ChartTokens {
  /** Primary #3A5BD9 — 1번 시리즈, 강조 */
  primary: string;
  /** Primary Light #6B8AFF — 그라디언트/보조 시리즈 */
  primaryLight: string;
  /** Success #22C55E — 합격/정상 시리즈 */
  success: string;
  /** Warning #F59E0B — 경고 시리즈, 목표 미달 */
  warning: string;
  /** Error #EF4444 — 불합격/임계 초과 */
  error: string;
  /** Border #E2E6EF — 목표선·트랙 */
  border: string;
  /** 그리드 라인 (globals.css --badge-gray-bg) */
  grid: string;
  /** Text Secondary #687182 — 축 제목·범례 */
  textSub: string;
  /** 보조 텍스트 #9AA4B2 — 눈금 라벨 */
  textMuted: string;
  /** Surface #FFFFFF — 점 테두리 */
  surface: string;
}

/** ChartTokens 키 → `lib/tokens` 의 토큰 이름. 여기 없는 색은 차트가 쓰지 않는다. */
const SOURCE: Record<keyof ChartTokens, TokenName> = {
  primary: "primary",
  primaryLight: "primaryLight",
  success: "success",
  warning: "warning",
  error: "error",
  border: "border",
  grid: "grid",
  textSub: "textSub",
  textMuted: "textMuted",
  surface: "surface",
};

const KEYS = Object.keys(SOURCE) as (keyof ChartTokens)[];

function project(source: Record<TokenName, string>): ChartTokens {
  const out = {} as ChartTokens;
  KEYS.forEach((key) => {
    out[key] = source[SOURCE[key]];
  });
  return out;
}

/** SF-TD3 §1.1 hex. CSS 변수를 읽을 수 없을 때(SSR 포함) 쓰인다. */
export const CHART_TOKEN_FALLBACK: ChartTokens = project(TOKEN_HEX);

let cached: ChartTokens | null = null;

/**
 * 실행 시점의 디자인 토큰을 반환한다.
 * 브라우저에서는 globals.css 의 :root 변수를 읽고, 없으면 SF-TD3 hex 로 떨어진다.
 * 결과는 실제 색상 문자열이라 canvas 와 색 연산에 바로 쓸 수 있다.
 */
export function readChartTokens(): ChartTokens {
  if (cached) return cached;
  if (typeof window === "undefined" || typeof document === "undefined") {
    return CHART_TOKEN_FALLBACK;
  }
  cached = project(readTokens());
  return cached;
}

/**
 * 차트 color prop 의 타입.
 * 토큰 이름(`"error"`, `"success"` …)을 주면 실제 색으로 해석된다 — **이쪽을 쓴다.**
 * 임의 문자열도 받지만(레거시 hex), canvas 는 `var(--x)` 를 해석하지 못하므로
 * CSS 변수 문자열은 넘기지 마라.
 */
export type ChartColor = keyof ChartTokens | (string & {});

/** 토큰 이름이면 실제 색으로 바꾸고, 아니면 그대로 돌려준다. */
export function resolveColor(
  t: ChartTokens,
  value: ChartColor | undefined,
): string | undefined {
  if (value === undefined) return undefined;
  const table: Record<string, string> = { ...t };
  return table[value] ?? value;
}

/** 기본 시리즈 색상 순환 — SF-TD3 토큰만 사용한다. */
export function seriesPalette(t: ChartTokens): string[] {
  return [t.primary, t.success, t.warning, t.error, t.primaryLight];
}

/** `#rgb` / `#rrggbb` / `#rrggbbaa` / `rgb()` / `rgba()` → [r,g,b]. 해석 불가 시 null. */
function parseRgb(color: string): [number, number, number] | null {
  const c = color.trim();

  if (c.startsWith("#")) {
    const hex = c.slice(1);
    let r: number;
    let g: number;
    let b: number;
    if (hex.length === 3) {
      r = parseInt(hex[0] + hex[0], 16);
      g = parseInt(hex[1] + hex[1], 16);
      b = parseInt(hex[2] + hex[2], 16);
    } else if (hex.length === 6 || hex.length === 8) {
      r = parseInt(hex.slice(0, 2), 16);
      g = parseInt(hex.slice(2, 4), 16);
      b = parseInt(hex.slice(4, 6), 16);
    } else {
      return null;
    }
    if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null;
    return [r, g, b];
  }

  const match = c.match(/^rgba?\(([^)]+)\)$/i);
  if (match) {
    const parts = match[1].split(/[,/\s]+/).filter(Boolean).map(Number);
    if (parts.length >= 3 && parts.slice(0, 3).every((v) => !Number.isNaN(v))) {
      return [parts[0], parts[1], parts[2]];
    }
  }

  return null;
}

/**
 * 색상에 알파를 입힌다.
 * 해석하지 못하면 원본을 그대로 돌려준다(그라디언트가 깨지지 않도록).
 */
export function toRgba(color: string, alpha: number): string {
  const a = Math.max(0, Math.min(1, alpha));
  const rgb = parseRgb(color);
  if (!rgb) return color;
  return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`;
}

/** 두 토큰 색상을 t(0~1) 비율로 섞는다. 값 크기별 점 색상 등에 쓴다. */
export function mixColors(from: string, to: string, t: number, alpha = 1): string {
  const a = parseRgb(from);
  const b = parseRgb(to);
  const ratio = Math.max(0, Math.min(1, t));
  if (!a || !b) return toRgba(from, alpha);
  const ch = (i: number) => Math.round(a[i] + (b[i] - a[i]) * ratio);
  return `rgba(${ch(0)},${ch(1)},${ch(2)},${Math.max(0, Math.min(1, alpha))})`;
}
