// ── 요청 타입 ──────────────────────────────────────────────────────────────

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
  optimization_success: boolean;
  message?: string;
}

export interface PredictResponse {
  predicted_quality: number;
  model_used: string;
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
