"use client";

import { useEffect, useState } from "react";
import { currentRole } from "@/lib/auth";
import type { UserRole } from "@/types/auth";

/**
 * 로그인 사용자의 역할.
 *
 * ⚠️ **`currentRole()` 을 렌더 본문에서 직접 부르지 마라.**
 * 그 함수는 `sessionStorage` 의 토큰을 읽는데, 서버 렌더 시점에는 브라우저 저장소가
 * 없어 항상 `null` 이 나온다. 그 `null` 로 굳은 마크업이 클라이언트에서 다시 계산되지
 * 않으면 **쓰기 버튼이 영구 비활성 + "권한이 없습니다" 라는 틀린 사유**로 남는다.
 * 사이드바를 눌러 들어가면(클라이언트 내비게이션) 멀쩡한데 URL 로 직접 들어가면
 * 깨지는 증상이 이것이다 (QA-B DEF-B-01 — `/shipping/{inspect,lot,claim}`·`/process/condition` 4화면).
 *
 * 이 훅은 마운트 뒤 `useEffect` 에서 읽으므로 SSR·CSR 진입 경로가 같은 결과를 낸다.
 * 첫 렌더에서는 `null` 이므로 **`null` 은 "권한 없음" 이 아니라 "아직 모름"** 으로 다뤄라.
 */
export function useRole(): UserRole | null {
  const [role, setRole] = useState<UserRole | null>(null);
  useEffect(() => {
    setRole(currentRole());
  }, []);
  return role;
}
