/**
 * 품질 **합격 판정** 헬퍼 — `design-standards.md` §3.4 · `api-contract.md` §8.7.2.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * 🚨 왜 이 파일이 따로 있나
 *
 * `lib/utils.ts` 의 `getQualityBadgeVariant()` 는 `QUALITY_THRESHOLDS`
 * (`{excellent:90, good:75, fair:60}`) 기준이라 **70 이라는 값이 어디에도 없다.**
 *
 *   | 점수 | 실제 판정 | `getQualityBadgeVariant()` |
 *   |------|-----------|----------------------------|
 *   | 69.9 | **불합격** | `"warning"`                |
 *   | 70.0 | **합격**   | `"warning"`                |
 *
 * 합격과 불합격이 **픽셀 단위로 똑같이** 그려진다. 검사원이 불합격 LOT 을 합격으로 읽는다.
 *
 * **두 축을 분리한다.**
 *   - 합격/불합격 (2값) → 이 파일. 서버 `passed` 또는 `score >= pass_score` 직접 비교
 *   - 등급 표시 (4값)   → `lib/utils.ts` 의 `getQualityBadgeVariant()`/`getQualityColor()`
 * 한 배지에 두 축을 섞지 마라. 합격 여부가 필요한 화면에서는 **합격 배지가 우선**이다.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * 판정 기준의 정본 순서:
 *   1. 서버가 내린 `passed` (`QualityDto.passed` · `PredictResponse.passed`)
 *   2. `GET /settings/public` 의 `quality_pass_score`
 *   3. `QUALITY_PASS_SCORE = 70` 상수 — **폴백·폼 기본값 전용** (`ts-types.md` §10 #19)
 */

import { QUALITY_PASS_SCORE, QUALITY_WARN_SCORE } from '@/types/api';
import type { LotStatus, PublicSettingsDto, QualityDto } from '@/types/api';
import type { PredictResponse } from '@/types';

/** `StatusBadge` 의 variant 유니온과 같은 값이다 (컴포넌트는 수정하지 않는다) */
export type BadgeVariant = 'green' | 'amber' | 'red' | 'blue' | 'violet' | 'gray';

export interface PassBadge {
  passed: boolean;
  variant: BadgeVariant;
  label: '합격' | '불합격';
}

const PASS_BADGE: PassBadge = { passed: true, variant: 'green', label: '합격' };
const FAIL_BADGE: PassBadge = { passed: false, variant: 'red', label: '불합격' };

/**
 * 합격선. `/settings/public` 값이 있으면 그것을 쓰고, 없을 때만 상수 70 으로 떨어진다.
 *
 * 호출부는 `usePublicSettings()` 의 `data` 를 그대로 넘기면 된다.
 */
export function passScoreOf(settings?: PublicSettingsDto | null): number {
  return settings?.quality_pass_score ?? QUALITY_PASS_SCORE;
}

export function warnScoreOf(settings?: PublicSettingsDto | null): number {
  return settings?.quality_warn_score ?? QUALITY_WARN_SCORE;
}

/**
 * 점수 → 합격 여부. **서버 `passed` 가 있으면 그것을 쓰고 이 함수를 부르지 마라.**
 * 서버 값이 없는 화면(예: 입력 중인 폼 미리보기)에서만 쓴다.
 */
export function isQualityPassed(
  score: number | null | undefined,
  settings?: PublicSettingsDto | null
): boolean {
  if (score === null || score === undefined) return false;
  return score >= passScoreOf(settings);
}

/** 합격/불합격 배지. `<StatusBadge variant={b.variant} label={b.label} />` 로 쓴다 */
export function qualityPassBadge(
  score: number | null | undefined,
  settings?: PublicSettingsDto | null
): PassBadge {
  return isQualityPassed(score, settings) ? PASS_BADGE : FAIL_BADGE;
}

/** 서버가 이미 판정한 값을 배지로. **이 경로가 1순위다** */
export function passBadgeFromServer(passed: boolean): PassBadge {
  return passed ? PASS_BADGE : FAIL_BADGE;
}

/** `QualityDto.passed` 는 서버 계산이다 — 다시 계산하지 않는다 */
export const qualityBadgeOf = (dto: Pick<QualityDto, 'passed'>): PassBadge =>
  passBadgeFromServer(dto.passed);

/** `PredictResponse.passed` 도 마찬가지다 (api-contract §8.4.1) */
export const predictBadgeOf = (res: Pick<PredictResponse, 'passed'>): PassBadge =>
  passBadgeFromServer(res.passed);

/**
 * LOT 상태 배지 — `lots.status` 4값.
 *
 * ⚠ `warning` 경계(80점)는 `quality_pass_score` 설정과 **연동되지 않는다.**
 * v1 에서 해결하지 않기로 한 항목이라 화면에 각주를 달아라 (api-contract §8.7.2 #3).
 */
export function lotStatusBadge(status: LotStatus): { variant: BadgeVariant; label: string } {
  switch (status) {
    case 'pass':
      return { variant: 'green', label: '합격' };
    case 'fail':
      return { variant: 'red', label: '불합격' };
    case 'warning':
      return { variant: 'amber', label: '경고' };
    case 'pending':
      return { variant: 'gray', label: '미검사' };
  }
}

/**
 * 성분 편차 경고 판정. 임계값은 `/settings/public` 의 `deviation_warn` 이 정본이고,
 * 없으면 goal.md 2.3 의 `2.0`/`0.3`/`0.1` 로 떨어진다.
 *
 * ⚠ **생산 LOT(`ComponentDto`)에만 적용한다.** 입고 원재료(`ReceiptDto.deviations`)에
 * 쓰면 안 된다 — `Sn ingot` 의 99% 는 배합 목표 62.0% 와의 차이가 품질 편차가 아니다
 * (api-contract §8.3.1).
 */
export function isDeviationWarning(
  component: 'sn' | 'ag' | 'cu',
  deviation: number,
  settings?: PublicSettingsDto | null
): boolean {
  const warn = settings?.deviation_warn;
  const threshold =
    warn?.[component] ??
    ({ sn: 2.0, ag: 0.3, cu: 0.1 } as const)[component];
  return Math.abs(deviation) > threshold;
}
