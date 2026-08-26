"use client";

import { useEffect } from "react";
import { StatusScreen, type StatusScreenAction } from "@/components/layout/StatusScreen";
import { resolveError, extractStatus } from "@/lib/error-contract";

/**
 * 44화면 공통 오류 경계 (goal.md §2.4 오류 계약).
 *
 * 여기까지 온 오류는 계약 표 6줄 중 하나로 분류돼 한국어 문구로 표시된다.
 * 분류가 안 되면 "요청을 처리하지 못했습니다" + 원문 메시지를 **그대로 보여준다**.
 * 조용히 삼키거나 mock 으로 대체하지 않는다 — goal.md §3 이 금지한 최대 결함이다.
 */
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // 서버 로그에는 이미 남는다. 브라우저 콘솔에도 원문을 남겨 QA 가 재현할 수 있게 한다.
    console.error("[dashboard error boundary]", error);
  }, [error]);

  const entry = resolveError(error);
  const status = extractStatus(error);

  const actions: StatusScreenAction[] = [];
  if (entry.action === "retry") {
    actions.push({ label: "다시 시도", onClick: reset, primary: true });
  } else if (entry.action === "login") {
    // 로그인 화면은 웨이브 C 에서 추가된다. 그때까지는 새로고침이 유일한 복구 경로다.
    actions.push({ label: "다시 시도", onClick: reset, primary: true });
  } else {
    actions.push({ label: "다시 시도", onClick: reset });
  }
  if (entry.action === "home" || entry.action === "login") {
    actions.push({
      label: "생산 현황으로",
      href: "/dashboard/production",
      primary: entry.action === "home",
    });
  }

  const codeLine = [
    status ? `HTTP ${status}` : null,
    error.message || null,
    error.digest ? `digest ${error.digest}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <StatusScreen
      tone="error"
      title={entry.title}
      detail={entry.detail}
      code={codeLine || undefined}
      actions={actions}
      source={entry.source}
    />
  );
}
