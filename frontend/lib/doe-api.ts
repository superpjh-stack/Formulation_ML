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

import { authHeaders, redirectToLogin } from "./auth";

/** 상대경로 + Next rewrite 경유 — `api-contract.md` §1.2 · `ts-types.md` §8 #11 */
const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "";
/** DOE 7종은 `/api/v1/doe/*` 아래로 이동했다 (api-contract §8.11 G11) */
const API_PREFIX = "/api/v1";
const REQUEST_TIMEOUT_MS = 10_000;

function timeoutSignal(): AbortSignal | undefined {
  if (typeof AbortSignal === "undefined" || typeof AbortSignal.timeout !== "function") {
    return undefined;
  }
  return AbortSignal.timeout(REQUEST_TIMEOUT_MS);
}

async function doeFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${API_PREFIX}${path}`, {
      signal: timeoutSignal(),
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...authHeaders(),
        ...options.headers,
      },
    });
  } catch (err) {
    const aborted =
      err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    throw new ApiError(
      0,
      aborted
        ? `서버 응답이 없습니다 (${path} — ${REQUEST_TIMEOUT_MS / 1000}초 초과)`
        : `서버에 연결할 수 없습니다 (${path})`
    );
  }
  if (res.status === 401) {
    redirectToLogin();
    throw new ApiError(401, await res.text().catch(() => res.statusText));
  }
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
