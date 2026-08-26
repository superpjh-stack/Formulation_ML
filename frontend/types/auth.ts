/**
 * 인증 · RBAC · 감사로그 타입 — `contracts/ts-types.md` §6.
 *
 * 토큰 보관 위치는 **`sessionStorage`** 다 (§6.1). `localStorage` 를 쓰지 마라 —
 * 사내 공용 PC 에 토큰이 영구히 남으면 안 되고, 세션 30분(NFR-S-01)의 의미에도 맞지 않는다.
 * 실제 저장/조회/삭제 구현은 `lib/auth.ts` 다.
 */

/** RBAC 5역할 — goal.md 2.3, SF-TD5 §3.8 users.role */
export type UserRole = 'admin' | 'manufacture' | 'quality' | 'sales' | 'viewer';

export const USER_ROLES: readonly UserRole[] = [
  'admin',
  'manufacture',
  'quality',
  'sales',
  'viewer',
] as const;

/** 화면 표기 — 사이드바·사용자관리(FE-RT-26) 공통 */
export const ROLE_LABELS: Record<UserRole, string> = {
  admin: '관리자',
  manufacture: '제조',
  quality: '품질',
  sales: '영업',
  viewer: '조회',
};

// ── 인증 ─────────────────────────────────────────────────────────────────────

/** POST /api/v1/auth/login 요청 */
export interface LoginRequest {
  username: string;
  password: string;
}

/** POST /api/v1/auth/login 응답 */
export interface LoginResponse {
  access_token: string;
  token_type: 'bearer';
  expires_in: number; // 1800 (30분 — NFR-S-01)
  user: AuthUser;
}

/** POST /api/v1/auth/refresh 응답 */
export interface RefreshResponse {
  access_token: string;
  expires_in: number;
}

/** GET /api/v1/auth/me 응답 */
export interface AuthUser {
  id: number;
  username: string;
  email: string;
  role: UserRole;
  active: boolean;
  last_login: string | null;
}

/** JWT 페이로드 (디코드 결과) — api-contract.md §3.1 */
export interface JwtPayload {
  sub: string; // username
  uid: number; // users.id
  role: UserRole;
  exp: number; // epoch seconds
  iat: number;
}

export const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // NFR-S-01

// ── 감사로그 ─────────────────────────────────────────────────────────────────

/** api-contract.md §6.2 — SF-TD5 §3.9 audit_logs.action */
export type AuditAction = 'CREATE' | 'UPDATE' | 'DELETE' | 'LOGIN' | 'PREDICT';

export const AUDIT_ACTION_LABELS: Record<AuditAction, string> = {
  CREATE: '생성',
  UPDATE: '수정',
  DELETE: '삭제',
  LOGIN: '로그인',
  PREDICT: 'ML 예측',
};
