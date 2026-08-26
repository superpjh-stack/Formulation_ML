/**
 * 오류 계약 (goal.md §2.4 · SF-TD4 §5 · contracts/api-contract.md §5).
 *
 * **여기 없는 오류 코드를 발명하지 마라.** 계약 표가 정한 6가지 + §5.1 의 409 가 전부다.
 * QA 가 이 문구를 그대로 테스트 케이스로 쓰므로 `title` 은 계약 문장 그대로여야 한다.
 *
 * 계약 표에 있으나 여기 없는 한 줄:
 *   "최적화 수렴 실패" 는 **HTTP 200 + `optimization_success: false`** 다. 오류가 아니다.
 *   error boundary 로 오지 않고 `/mixing/optimize` 결과 카드가 "수렴 실패" 로 직접 표시한다.
 *   절대 4xx/5xx 로 바꾸지 마라 (api-contract.md §5).
 */

export type ErrorAction = "retry" | "login" | "home" | "none";

export interface ErrorContractEntry {
  /** HTTP 상태 코드 */
  status: number;
  /** 계약이 정한 UI 문구 — 문자 그대로 유지 */
  title: string;
  /** 사용자가 다음에 할 일 */
  detail: string;
  /** 주 버튼 성격 */
  action: ErrorAction;
  /** 계약 출처 */
  source: string;
}

export const ERROR_CONTRACT: Record<number, ErrorContractEntry> = {
  401: {
    status: 401,
    title: "로그인이 필요합니다",
    detail: "세션이 만료되었거나 로그인하지 않았습니다. 다시 로그인해 주세요. (세션 유효시간 30분)",
    action: "login",
    source: "SF-TD4 §5 / api-contract §5",
  },
  403: {
    status: 403,
    title: "접근 권한이 없습니다",
    detail: "이 화면을 볼 수 있는 권한이 계정에 없습니다. 시스템 관리자에게 권한을 요청하세요.",
    action: "home",
    source: "SF-TD4 §5 / api-contract §5",
  },
  404: {
    status: 404,
    title: "모델을 찾을 수 없습니다",
    detail: "요청한 자원이 없습니다. 학습된 모델이 없거나 LOT·사용자 등 대상이 삭제되었을 수 있습니다.",
    action: "home",
    source: "SF-TD4 §5 / api-contract §5·§5.1",
  },
  409: {
    status: 409,
    title: "이미 등록된 값입니다",
    detail: "중복될 수 없는 값입니다. LOT 번호·코드·설비 ID·사용자 ID·이메일을 확인하세요.",
    action: "none",
    source: "api-contract §5.1 (UK 중복)",
  },
  422: {
    status: 422,
    title: "입력값을 확인해 주세요",
    detail: "성분 합계는 100%여야 합니다. Sn·Ag·Cu·Pb 값을 다시 확인하세요.",
    action: "none",
    source: "SF-TD4 §5 / api-contract §5",
  },
  501: {
    status: 501,
    title: "아직 제공되지 않는 기능입니다",
    detail: "CR-DB-001 승인 대기 중인 화면입니다. 데이터가 준비되면 자동으로 표시됩니다.",
    action: "home",
    source: "api-contract §5.1",
  },
  503: {
    status: 503,
    title: "서비스 일시 중단",
    detail: "데이터베이스에 연결할 수 없습니다. 잠시 후 다시 시도하고, 계속되면 시스템 관리자에게 알려주세요.",
    action: "retry",
    source: "SF-TD4 §5 / api-contract §5",
  },
};

/** 계약 표에 없는 오류. 새 코드를 만드는 게 아니라 "분류 불가" 를 있는 그대로 보여준다. */
export const UNKNOWN_ERROR: ErrorContractEntry = {
  status: 0,
  title: "요청을 처리하지 못했습니다",
  detail: "예상하지 못한 오류입니다. 다시 시도해 보고, 계속되면 아래 오류 코드와 함께 시스템 관리자에게 알려주세요.",
  action: "retry",
  source: "계약 외",
};

const CONTRACT_CODES = Object.keys(ERROR_CONTRACT).map(Number);

/**
 * 오류 객체에서 HTTP 상태를 뽑는다.
 *
 * 1순위 `ApiError.status` (`lib/api.ts`). 프로덕션 빌드에서 서버 컴포넌트 오류는
 * 프로퍼티가 벗겨진 채 넘어오므로, 2순위로 메시지 안의 계약 코드를 찾는다.
 */
export function extractStatus(error: unknown): number | null {
  if (typeof error === "object" && error !== null) {
    const s = (error as { status?: unknown }).status;
    if (typeof s === "number" && Number.isFinite(s)) return s;
  }
  // ⚠ `Error` 인스턴스가 아닌 **일반 객체의 `.message` 도 읽어야 한다.**
  //
  // 화면들은 훅이 문자열로 저장한 오류를 `{ status: null, message }` 로 감싸 넘긴다.
  // 초판은 `Error` 가 아니면 `String(error)` 를 썼는데, 그러면 객체가
  // `"[object Object]"` 가 되어 **메시지가 통째로 사라졌다.** 상태 코드도 `null` 이라
  // 계약 조회가 실패하고 403 같은 정상 응답이 "예상하지 못한 오류 … 계약 외" 로
  // 떨어졌다 (QA-B DEF-B-03).
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "object" && error !== null && typeof (error as { message?: unknown }).message === "string"
        ? ((error as { message: string }).message)
        : String(error ?? "");
  for (const code of CONTRACT_CODES) {
    if (new RegExp(`\\b${code}\\b`).test(message)) return code;
  }
  return null;
}

/** 오류 → 계약 엔트리. 계약에 없으면 UNKNOWN_ERROR. */
export function resolveError(error: unknown): ErrorContractEntry {
  const status = extractStatus(error);
  if (status !== null && ERROR_CONTRACT[status]) return ERROR_CONTRACT[status];
  return UNKNOWN_ERROR;
}
