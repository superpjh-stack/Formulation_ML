// ── DOE 메서드 메타데이터 ─────────────────────────────────────────────────

export type DoeMethodKey =
  | "full_factorial"
  | "fractional_factorial"
  | "ccd"
  | "box_behnken"
  | "taguchi"
  | "lhs";

export interface DoeMethodMeta {
  name: string;
  description: string;
  recommended_factors: string;
  typical_experiments: string;
  pros: string;
  cons: string;
}

export interface DoeMethodsResponse {
  supported_methods: DoeMethodKey[];
  metadata: Record<DoeMethodKey, DoeMethodMeta>;
}

// ── 인자 스펙 ─────────────────────────────────────────────────────────────

export interface FactorSpec {
  min: number;
  max: number;
  levels: number;
}

// ── 설계 행렬 생성 ────────────────────────────────────────────────────────

export interface DesignRequest {
  method: DoeMethodKey;
  factors: Record<string, FactorSpec>;
  n_samples?: number;
}

export interface DesignResponse {
  method: DoeMethodKey;
  method_name: string;
  n_experiments: number;
  design_matrix: Record<string, number>[];
  factor_info: Record<string, FactorSpec>;
}

// ── 시뮬레이션 ────────────────────────────────────────────────────────────

export interface SimulateRequest {
  design_matrix: Record<string, number>[];
  model: string;
  supplier: "SUP_A" | "SUP_B" | "SUP_C";
  melt_temp_c: number;
  melt_time_min: number;
  add_noise?: boolean;
  noise_std?: number;
}

export interface SimulatedRow extends Record<string, number | string> {
  predicted_quality: number;
  supplier: string;
  melt_temp_c: number;
  melt_time_min: number;
}

export interface SimulateSummary {
  mean: number;
  std: number;
  min: number;
  max: number;
  n_experiments: number;
  model: string;
  noise_applied: boolean;
}

export interface SimulateResponse {
  simulated_data: SimulatedRow[];
  summary: SimulateSummary;
  optimal_point: SimulatedRow;
}

// ── 분석 ─────────────────────────────────────────────────────────────────

export interface AnalyzeRequest {
  simulated_data: SimulatedRow[];
  response_col?: string;
  factor_cols?: string[];
}

export interface AnovaRow {
  source: string;
  ss: number;
  df: number;
  ms: number;
  f_value: number | null;
  p_value: number | null;
}

export interface AnalyzeResponse {
  main_effects: Record<string, number>;
  interactions: Record<string, number>;
  anova_table: AnovaRow[];
  r_squared: number;
  optimal_conditions: Record<string, number> | null;
  rsm_coefficients?: Record<string, number>;
  factor_cols?: string[];
}

// ── 최적화 ────────────────────────────────────────────────────────────────

export interface OptimizeRequest {
  model: string;
  supplier: "SUP_A" | "SUP_B" | "SUP_C";
  melt_temp_c: number;
  melt_time_min: number;
  method?: "slsqp" | "lhs";
  n_candidates?: number;
}

export interface OptimizeResponse {
  optimal_conditions: Record<string, number>;
  predicted_quality: number;
  top5_candidates: Array<Record<string, number> & { predicted_quality: number }>;
  method: string;
  model: string;
}
