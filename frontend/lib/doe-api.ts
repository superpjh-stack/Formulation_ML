import { ApiError } from "@/lib/api";
import type {
  DoeMethodsResponse,
  DesignRequest,
  DesignResponse,
  SimulateRequest,
  SimulateResponse,
  AnalyzeRequest,
  AnalyzeResponse,
  OptimizeRequest,
  OptimizeResponse,
} from "@/types/doe";

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

async function doeFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
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

/** GET /doe/methods — 6가지 DOE 방법 메타데이터 */
export async function fetchDoeMethods(): Promise<DoeMethodsResponse> {
  return doeFetch<DoeMethodsResponse>("/doe/methods");
}

/** POST /doe/design — 설계 행렬 생성 */
export async function createDesign(req: DesignRequest): Promise<DesignResponse> {
  return doeFetch<DesignResponse>("/doe/design", {
    method: "POST",
    body: JSON.stringify(req),
  });
}

/** POST /doe/simulate — ML 배치 예측 */
export async function simulateDoe(req: SimulateRequest): Promise<SimulateResponse> {
  return doeFetch<SimulateResponse>("/doe/simulate", {
    method: "POST",
    body: JSON.stringify(req),
  });
}

/** POST /doe/analyze — 주효과/교호작용/ANOVA 분석 */
export async function analyzeDoe(req: AnalyzeRequest): Promise<AnalyzeResponse> {
  return doeFetch<AnalyzeResponse>("/doe/analyze", {
    method: "POST",
    body: JSON.stringify(req),
  });
}

/** POST /doe/optimize — SLSQP/LHS 최적화 */
export async function optimizeDoe(req: OptimizeRequest): Promise<OptimizeResponse> {
  return doeFetch<OptimizeResponse>("/doe/optimize", {
    method: "POST",
    body: JSON.stringify(req),
  });
}

/** GET /doe/sample — 데모용 사전 생성 샘플 */
export async function fetchDoeSample(
  method: string = "ccd",
  n_points: number = 20
): Promise<SimulateResponse> {
  return doeFetch<SimulateResponse>(
    `/doe/sample?method=${method}&n_points=${n_points}`
  );
}
