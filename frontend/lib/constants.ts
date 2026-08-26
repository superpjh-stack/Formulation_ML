/**
 * 화면 상수.
 *
 * ⚠ **값의 정본은 `types/api.ts` 다** (`ts-types.md` §4 주석 · §8 #8).
 * 여기서는 **re-export** 만 한다 — 두 곳에 다른 숫자가 있으면 안 된다.
 */

export {
  // 성분 목표값 (src/features/engineering.py 와 동기화)
  SN_TARGET,
  AG_TARGET,
  CU_TARGET,
  // 하드 비즈니스 룰 (goal.md 2.3)
  QUALITY_PASS_SCORE,
  QUALITY_WARN_SCORE,
  EQUIPMENT_TEMP_WARN_C,
  DEVIATION_WARN,
  COMPONENT_BOUNDS,
  MELT_TEMP_RANGE,
} from "@/types/api";

export const MODEL_OPTIONS = [
  { value: "gradient_boosting", label: "Gradient Boosting" },
  { value: "random_forest", label: "Random Forest" },
  { value: "xgboost", label: "XGBoost" },
  { value: "ridge", label: "Ridge" },
] as const;

export const SUPPLIER_OPTIONS = [
  { value: "SUP_A", label: "공급사 A" },
  { value: "SUP_B", label: "공급사 B" },
  { value: "SUP_C", label: "공급사 C" },
] as const;

/**
 * 품질 점수 **등급** 색상 임계값 — 우수/양호/보통/미흡.
 *
 * 🚨 **합격선(70)이 아니다.** 이 값으로 합격 판정을 하면 69.9(불합격)와 70.0(합격)이
 * 둘 다 `warning` 으로 **픽셀 단위 동일**하게 그려진다 (`design-standards.md` §3.4).
 * 합격 판정은 `lib/quality.ts` 의 `isQualityPassed()` 를 써라.
 */
export const QUALITY_THRESHOLDS = {
  excellent: 90,
  good: 75,
  fair: 60,
} as const;
