import type {
  RecommendRequest,
  RecommendResponse,
  PredictRequest,
  PredictResponse,
  ModelInfo,
  EdaStats,
} from "@/types";

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

// ── 공통 fetch 래퍼 ────────────────────────────────────────────────────────

async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { "Content-Type": "application/json", ...options.headers },
    ...options,
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => res.statusText);
    throw new ApiError(res.status, detail);
  }
  return res.json() as Promise<T>;
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

// ── 엔드포인트 함수 ────────────────────────────────────────────────────────

/** POST /recommend — 배합비율 최적화 추천 */
export async function fetchRecommendation(
  params: RecommendRequest
): Promise<RecommendResponse> {
  return apiFetch<RecommendResponse>("/recommend", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

/** POST /predict — 품질 점수 예측 */
export async function fetchPrediction(
  params: PredictRequest
): Promise<PredictResponse> {
  return apiFetch<PredictResponse>("/predict", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

/** GET /models — 사용 가능한 모델 목록 및 성능 지표 */
export async function fetchModels(): Promise<ModelInfo[]> {
  return apiFetch<ModelInfo[]>("/models");
}

/** GET /eda/stats — 성분 분포 및 품질 상관관계 통계 */
export async function fetchEdaStats(): Promise<EdaStats> {
  return apiFetch<EdaStats>("/eda/stats");
}
