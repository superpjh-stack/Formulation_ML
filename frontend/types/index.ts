// ── 요청 타입 ──────────────────────────────────────────────────────────────
//
// ⚠ 이 파일은 **수정 금지**가 원칙이다 (contracts/ts-types.md §2).
//   유일한 예외가 §5.3 `ModelInfo` · §5.4 `PredictResponse`/`RecommendResponse` 의
//   **필드 추가**다. 기존 필드를 지우거나 이름을 바꾸면 기존 화면이 깨진다.
//   새 타입은 전부 `types/api.ts`(DTO) · `types/auth.ts`(인증) 에 쓴다.

import type { ModelTier } from "./api";

export type ModelName = "gradient_boosting" | "random_forest" | "xgboost" | "ridge";
export type SupplierName = "SUP_A" | "SUP_B" | "SUP_C";

export interface RecommendRequest {
  model: ModelName;
  temperature: number;
  process_time: number;
  supplier: SupplierName;
}

export interface PredictRequest {
  model: ModelName;
  sn_ratio: number;
  ag_ratio: number;
  cu_ratio: number;
  pb_ratio: number;
  temperature: number;
  process_time: number;
  supplier: SupplierName;
}

// ── 응답 타입 ──────────────────────────────────────────────────────────────

export interface ComponentRatios {
  sn: number;
  ag: number;
  cu: number;
  pb: number;
}

export interface RecommendResponse {
  recommended_ratios: ComponentRatios;
  predicted_quality: number;
  /**
   * **수렴 실패는 HTTP 200 이다.** 4xx/5xx 로 바꾸지 마라 (SF-TD4 §5).
   * 결과 카드가 "수렴 실패" 로 직접 표시한다.
   */
  optimization_success: boolean;
  /** 신규 (ts-types §5.4) — SF-TD3 §3.3 "반복: 24회" */
  iterations: number;
  message?: string;
}

export interface PredictResponse {
  predicted_quality: number;
  model_used: string;
  /**
   * 신규 (ts-types §5.4) — **합격 판정의 정본은 이 서버 값이다.**
   * `lib/utils.ts` 의 `getQualityBadgeVariant()` 로 합격을 판정하지 마라 (lib/quality.ts 참조).
   */
  passed: boolean;
  /** 신규 — 목표값 대비 편차. 서버 계산 */
  deviations: { sn: number; ag: number; cu: number };
  /** 신규 — `{name}_meta.json` 실측. **화면에 숫자를 하드코딩하지 마라** */
  model_metrics: ModelMetrics;
}

// ── 모델 메타데이터 ────────────────────────────────────────────────────────

export interface ModelMetrics {
  mae: number;
  rmse: number;
  r2: number;
  mape: number;
}

export interface FeatureImportance {
  feature: string;
  importance: number;
}

export interface ModelInfo {
  name: string;
  metrics: ModelMetrics;
  feature_importances: FeatureImportance[];
  trained_at?: string; // ISO 8601
  /** 신규 (ts-types §5.3) — 'serving' | 'candidate' | 'baseline' */
  tier: ModelTier;
  /** 신규 — 서빙 중 여부 (gradient_boosting 만 true) */
  active: boolean;
  /** 신규 — "GradientBoosting (권장)" / "Ridge (선형 베이스라인)" */
  display_name: string;
}

// ── EDA 통계 ──────────────────────────────────────────────────────────────

export interface DistributionBin {
  range: string;
  count: number;
}

export interface ScatterPoint {
  sn: number;
  quality: number;
}

export interface EdaStats {
  sn_distribution: DistributionBin[];
  ag_distribution: DistributionBin[];
  cu_distribution: DistributionBin[];
  sn_vs_quality: ScatterPoint[];
  stats: {
    total_lots: number;
    mean_quality: number;
    std_quality: number;
  };
}

// ── UI 공통 상태 ───────────────────────────────────────────────────────────

export type LoadingState = "idle" | "loading" | "success" | "error";
