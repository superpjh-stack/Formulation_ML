import type {
  RecommendRequest,
  RecommendResponse,
  PredictRequest,
  PredictResponse,
  ModelInfo,
  EdaStats,
} from "@/types";
import { authHeaders, redirectToLogin } from "./auth";

/**
 * **빈 문자열 = 동일 출처 상대 요청** → `next.config.js` 의 rewrite 를 경유한다.
 * `api-contract.md` §1.2 ② · `ts-types.md` §8 #9. 값을 채우면 직접 호출한다.
 */
const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "";

/** 정본 접두사 — SF-TD4 §2. 무접두사(`/predict`)는 deprecated 별칭이다 (§2.2) */
const API_PREFIX = "/api/v1";

/** NFR-P-03 이 배합 최적화에 5초를 허용한다. 3초 타임아웃은 정상 응답을 실패로 만든다 */
const REQUEST_TIMEOUT_MS = 10_000;

// ── 공통 fetch 래퍼 ────────────────────────────────────────────────────────

function timeoutSignal(): AbortSignal | undefined {
  if (typeof AbortSignal === "undefined" || typeof AbortSignal.timeout !== "function") {
    return undefined;
  }
  return AbortSignal.timeout(REQUEST_TIMEOUT_MS);
}

async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
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

  // 401 → 토큰 삭제 + 로그인 화면. **그래도 throw 한다** (조용한 실패 금지)
  if (res.status === 401) {
    redirectToLogin();
    const detail = await res.text().catch(() => res.statusText);
    throw new ApiError(401, detail);
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => res.statusText);
    throw new ApiError(res.status, detail);
  }
  return res.json() as Promise<T>;
}

export class ApiError extends Error {
  /**
   * ⚠ 메시지 끝에 **상태 코드를 실어 보낸다** — `(403)` 처럼.
   *
   * 훅(`useAsyncData`)이 `err.message` 만 문자열로 저장하는 순간 `.status` 가 사라진다.
   * 서버 문구에도 코드가 없어(`{"detail":"접근 권한이 없습니다"}`) 화면의
   * `resolveError()` 가 계약을 못 찾고 **"예상하지 못한 오류 … 계약 외"** 로 떨어졌다.
   * 권한 없음이라는 정상 응답이 시스템 장애처럼 보이고 `[다시 시도]` 까지 떴다
   * (QA-B DEF-B-03).
   *
   * 코드가 붙어 있으면 `extractStatus()` 가 문자열에서 복원해 계약 문구를 띄우므로
   * 이 접미사는 **화면에 노출되지 않는다**(계약에 없는 코드일 때만 원문과 함께 보인다).
   */
  constructor(public status: number, message: string) {
    const tagged =
      status > 0 && !new RegExp(`\\b${status}\\b`).test(message)
        ? `${message} (${status})`
        : message;
    super(tagged);
    this.name = "ApiError";
  }
}

// ── 엔드포인트 함수 ────────────────────────────────────────────────────────

/**
 * POST /api/v1/recommend — 배합비율 최적화 추천.
 *
 * ⚠ `optimization_success:false` 는 **HTTP 200** 이다. 오류로 바꾸지 마라 (SF-TD4 §5).
 * ⚠ `sn_bounds`/`ag_bounds`/`cu_bounds` 를 명시적으로 실어 보내라 —
 *   `src/models/optimize.py` 의 `DEFAULT_BOUNDS` 가 계약 경계와 다르다
 *   (`types/api.ts` 의 `COMPONENT_BOUNDS` · TODO-FE-001).
 */
export async function fetchRecommendation(
  params: RecommendRequest & {
    sn_bounds?: readonly [number, number] | number[];
    ag_bounds?: readonly [number, number] | number[];
    cu_bounds?: readonly [number, number] | number[];
  }
): Promise<RecommendResponse> {
  return apiFetch<RecommendResponse>("/recommend", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

/** POST /api/v1/predict — 품질 점수 예측. 성분 합계 ≠ 100% 는 **422** 다 */
export async function fetchPrediction(
  params: PredictRequest
): Promise<PredictResponse> {
  return apiFetch<PredictResponse>("/predict", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

/** GET /api/v1/models — **벌거벗은 배열** (api-contract §4.2 예외). 모델 목록의 단일 출처 */
export async function fetchModels(): Promise<ModelInfo[]> {
  return apiFetch<ModelInfo[]>("/models");
}

/** GET /api/v1/eda-stats — SF-TD4 §2.4 의 하이픈 표기가 정본이다 (`/eda/stats` 아니다) */
export async function fetchEdaStats(): Promise<EdaStats> {
  return apiFetch<EdaStats>("/eda-stats");
}
