/**
 * 배지 체계 통합용 매핑 테이블.
 *
 * 결론: **`StatusBadge` 로 통합한다.** 근거는 specs/design-components.md §4 참조.
 *
 * 이 파일은 레거시 `Badge`(success/info/warning/danger/neutral) 를 쓰던 호출부가
 * `StatusBadge`(green/amber/red/blue/violet/gray) 로 넘어갈 때 필요한 변환만 담는다.
 * 기존 `Badge.tsx` · `StatusBadge.tsx` 는 **건드리지 않았다** — 어느 쪽 시그니처도 바뀌지 않는다.
 *
 * 사용 예 (웨이브 C 개발자용, 한 줄 치환):
 *   - Before: <Badge variant="neutral">{text}</Badge>
 *   - After:  <StatusBadge variant={LEGACY_BADGE_VARIANT["neutral"]} label={text} />
 */

import type { ComponentProps } from "react";
import type { StatusBadge } from "./StatusBadge";

/** `StatusBadge` 의 variant 유니온. StatusBadge.tsx 를 수정하지 않고 그대로 끌어온다 */
export type StatusBadgeVariant = ComponentProps<typeof StatusBadge>["variant"];

/** 레거시 `Badge` 의 variant 유니온 */
export type LegacyBadgeVariant =
  | "success"
  | "info"
  | "warning"
  | "danger"
  | "neutral";

/**
 * 레거시 5종 → StatusBadge 6종.
 * `violet` 은 레거시에 대응이 없다 (StatusBadge 전용 — AI/모델 계열 배지에 쓰인다).
 */
export const LEGACY_BADGE_VARIANT: Record<LegacyBadgeVariant, StatusBadgeVariant> = {
  success: "green",
  info: "blue",
  warning: "amber",
  danger: "red",
  neutral: "gray",
};

/**
 * 품질점수 → StatusBadge variant.
 * `lib/utils.ts` 의 `getQualityBadgeVariant()` 가 레거시 variant 를 돌려주므로,
 * 그 결과를 이 매핑에 통과시키면 된다. `lib/utils.ts` 는 수정하지 않는다.
 *
 *   const variant = LEGACY_BADGE_VARIANT[getQualityBadgeVariant(score)];
 *
 * goal.md §2.3 의 품질 합격선 70점은 `getQualityBadgeVariant` 가 아니라
 * 호출부에서 별도로 판정해야 한다 (QUALITY_THRESHOLDS 와 합격선은 다른 값이다).
 */
export function statusVariantFromLegacy(v: LegacyBadgeVariant): StatusBadgeVariant {
  return LEGACY_BADGE_VARIANT[v];
}
