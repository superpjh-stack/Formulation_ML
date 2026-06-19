// 성분 목표값 (engineering.py 와 동기화)
export const SN_TARGET = 62.0;
export const AG_TARGET = 3.0;
export const CU_TARGET = 0.5;

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

// 품질 점수 색상 임계값
export const QUALITY_THRESHOLDS = {
  excellent: 90,
  good: 75,
  fair: 60,
} as const;
