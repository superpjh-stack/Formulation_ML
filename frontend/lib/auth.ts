/**
 * 토큰 보관 · JWT 디코드 — `contracts/ts-types.md` §6.1·§6.2.
 *
 * **`sessionStorage` 에 보관한다.** `localStorage` 를 쓰지 마라 (§6.1):
 * 세션 30분(NFR-S-01)의 의미에 맞고, 사내 공용 PC 에 토큰이 영구히 남지 않는다.
 *
 * 이 파일은 **저장소와 토큰 해석만** 담당한다. 로그인/로그아웃 요청은
 * `lib/koryo-api.ts` 의 `login()`·`logout()` 이고, 사용자 상태 훅은 라운드 2 의 `hooks/useAuth.ts` 다.
 */

import type { JwtPayload, UserRole } from '@/types/auth';

const TOKEN_KEY = 'koryo.access_token';

/** SSR·프리렌더에서는 `sessionStorage` 가 없다. 항상 이 가드를 통과시킨다 */
function storage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage;
  } catch {
    // 브라우저가 스토리지를 차단한 경우 (시크릿 모드 등)
    return null;
  }
}

export function getToken(): string | null {
  return storage()?.getItem(TOKEN_KEY) ?? null;
}

export function setToken(token: string): void {
  storage()?.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  storage()?.removeItem(TOKEN_KEY);
}

/** `Authorization: Bearer` 헤더. 토큰이 없으면 빈 객체 — 서버가 401 로 답한다 */
export function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * JWT 페이로드 디코드. **서명 검증이 아니다** — 표시·만료 확인 전용이다.
 * 권한 판정의 정본은 서버의 401/403 이다 (ts-types §6.3 "이중 방어").
 */
export function decodeJwt(token: string): JwtPayload | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const json =
      typeof atob === 'function'
        ? decodeURIComponent(
            atob(padded)
              .split('')
              .map((c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0'))
              .join('')
          )
        : Buffer.from(padded, 'base64').toString('utf-8');
    const payload = JSON.parse(json) as Partial<JwtPayload>;
    if (typeof payload.sub !== 'string' || typeof payload.exp !== 'number') return null;
    return payload as JwtPayload;
  } catch {
    return null;
  }
}

/** 만료 여부. 토큰이 없거나 해석 불가면 만료로 본다 */
export function isExpired(token: string | null = getToken()): boolean {
  if (!token) return true;
  const payload = decodeJwt(token);
  if (!payload) return true;
  return payload.exp * 1000 <= Date.now();
}

export function currentRole(): UserRole | null {
  const token = getToken();
  if (!token) return null;
  return decodeJwt(token)?.role ?? null;
}

/**
 * 401 을 받았을 때의 처리. 토큰을 지우고 로그인 화면으로 보낸다.
 *
 * ⚠ **폴백이 아니다.** 호출부는 이 함수를 부른 뒤에도 `ApiError(401)` 을 계속 throw 해서
 * `useKoryoData` 의 `error` 가 화면에 뜨게 한다 (goal.md 3절 "조용한 실패 금지").
 */
export function redirectToLogin(): void {
  clearToken();
  if (typeof window === 'undefined') return;
  const here = window.location.pathname + window.location.search;
  if (here.startsWith(LOGIN_PATH)) return; // 리다이렉트 루프 방지
  window.location.href = `${LOGIN_PATH}?next=${encodeURIComponent(here)}`;
}

/** 로그인 화면 경로. 라운드 2 가 `app/login/page.tsx` 를 만든다 */
export const LOGIN_PATH = '/login';
