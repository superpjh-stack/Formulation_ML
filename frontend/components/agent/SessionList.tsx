"use client";

/**
 * 대화 목록 — `agent-architecture.md` §7.3 · 사업계획서 p.42 "사용자 질문이력".
 *
 * ── 왜 왼쪽 레일이 아니라 우측 패널인가 ──────────────────────────────────────
 * 채팅 제품의 관례는 왼쪽 세션 레일이다(ChatGPT·Claude). 그런데 이 앱은 이미
 * **왼쪽에 266px 앱 내비**가 있다. 거기에 레일을 하나 더 붙이면 화면 왼쪽에
 * 목록이 둘로 겹쳐, 사용자가 "지금 보는 목록이 메뉴인가 대화인가" 를 매번
 * 판단해야 한다. 그래서 우측 패널 최상단에 둔다.
 *
 * 우측에 두는 것이 사용 흐름에도 맞는다. 첫 방문자는 **예시 질문**이,
 * 재방문자는 **이전 대화**가 필요한데 둘은 같은 자리에서 고르는 선택지다.
 *
 * ── 스코프 격리 ────────────────────────────────────────────────────────────
 * 🔴 `scope` 를 반드시 넘긴다. 서버 `_session_for()` 가 화면과 다른 스코프의
 *    세션을 **403** 으로 막으므로(§3.3.1 도구 범위), 입고 화면에 출하 대화를
 *    띄우면 클릭하는 순간 권한 오류가 난다. 목록 단계에서 걸러야 한다.
 */

import { useCallback, useEffect, useState } from "react";

import { T } from "@/components/ui/tokens";
import { resolveError } from "@/lib/error-contract";
import {
  deleteAgentSession,
  getAgentSessions,
  type AgentSession,
} from "@/lib/koryo-api";

export interface SessionListHandle {
  reload: () => void;
}

interface Props {
  scope: string;
  /** 지금 열려 있는 세션. `null` 이면 새 대화 상태다 */
  activeId: number | null;
  onOpen: (id: number) => void;
  /** 열려 있던 세션이 삭제됐을 때 — 화면을 새 대화로 되돌려야 한다 */
  onDeletedActive: () => void;
  /** 부모가 전송 후 목록을 갱신할 수 있게 하는 훅 */
  registerReload?: (fn: () => void) => void;
}

const MAX_ITEMS = 20;

/**
 * `2026-08-30T14:03:00` → `오후 2:03` · `어제` · `8/27`
 *
 * 목록에서 필요한 건 "얼마나 최근인가" 지 정확한 타임스탬프가 아니다.
 * 정확한 시각은 대화를 열면 각 메시지에 붙어 있다.
 */
function when(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.floor((startOfToday.getTime() - d.getTime()) / 86_400_000);
  if (diffDays < 0) return d.toLocaleTimeString("ko-KR", { hour: "numeric", minute: "2-digit" });
  if (diffDays === 0) return d.toLocaleTimeString("ko-KR", { hour: "numeric", minute: "2-digit" });
  if (diffDays === 1) return "어제";
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/**
 * `message_count` 는 user + assistant 합계라 사용자에겐 의미가 없다.
 * 주고받은 횟수로 바꾼다. 답변이 없어도 assistant 행은 남으므로 항상 짝수다.
 */
function turns(messageCount: number): number {
  return Math.floor(messageCount / 2);
}

export function SessionList({
  scope,
  activeId,
  onOpen,
  onDeletedActive,
  registerReload,
}: Props) {
  const [items, setItems] = useState<AgentSession[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<number | null>(null);

  const load = useCallback(() => {
    // 🔴 scope 를 넘기지 않으면 다른 화면 세션이 섞이고, 클릭 시 403 이 난다
    getAgentSessions(scope, { page_size: MAX_ITEMS })
      .then((page) => {
        setItems(page.items);
        setError(null);
      })
      .catch((e) => setError(resolveError(e).detail));
  }, [scope]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    registerReload?.(load);
  }, [registerReload, load]);

  async function remove(id: number) {
    try {
      await deleteAgentSession(id);
      setConfirmId(null);
      // 지운 것이 지금 열려 있는 대화면 화면도 새 대화로 되돌린다.
      // 안 그러면 이미 없는 세션에 이어서 질문하다가 404 를 만난다.
      if (id === activeId) onDeletedActive();
      load();
    } catch (e) {
      setError(resolveError(e).detail);
    }
  }

  return (
    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
      <div
        style={{
          padding: "11px 14px",
          borderBottom: `1px solid ${T.border}`,
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
        }}
      >
        <h3 style={{ fontSize: 12.5, fontWeight: 700, margin: 0, color: T.text }}>
          이전 대화
        </h3>
        {items !== null && items.length > 0 && (
          <span style={{ fontSize: 11, color: T.textMuted }}>{items.length}건</span>
        )}
      </div>

      <div style={{ maxHeight: 260, overflowY: "auto" }}>
        {error && (
          <p style={{ margin: 0, padding: "12px 14px", fontSize: 11.5, color: T.error }}>
            {error}
          </p>
        )}

        {/* 로딩과 "없음" 을 구분한다 — 둘 다 빈 목록으로 보이면 안 된다 */}
        {!error && items === null && (
          <p style={{ margin: 0, padding: "12px 14px", fontSize: 11.5, color: T.textMuted }}>
            불러오는 중…
          </p>
        )}

        {!error && items !== null && items.length === 0 && (
          <p
            style={{
              margin: 0,
              padding: "14px",
              fontSize: 11.5,
              color: T.textMuted,
              lineHeight: 1.6,
            }}
          >
            아직 대화가 없습니다.
            <br />
            질문하면 여기에 쌓입니다.
          </p>
        )}

        {items?.map((s) => {
          const active = s.id === activeId;
          const confirming = confirmId === s.id;
          return (
            <div
              key={s.id}
              style={{
                borderBottom: `1px solid ${T.border}`,
                background: active ? T.primaryLight : "transparent",
                borderLeft: `3px solid ${active ? T.primary : "transparent"}`,
              }}
            >
              <div style={{ display: "flex", alignItems: "flex-start" }}>
                <button
                  type="button"
                  onClick={() => onOpen(s.id)}
                  aria-current={active ? "true" : undefined}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    textAlign: "left",
                    border: "none",
                    background: "transparent",
                    padding: "9px 4px 9px 11px",
                    cursor: "pointer",
                    display: "flex",
                    flexDirection: "column",
                    gap: 3,
                  }}
                >
                  <span
                    style={{
                      fontSize: 12,
                      color: active ? T.primary : T.text,
                      fontWeight: active ? 600 : 400,
                      lineHeight: 1.45,
                      display: "-webkit-box",
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: "vertical",
                      overflow: "hidden",
                    }}
                  >
                    {s.title ?? "제목 없는 대화"}
                  </span>
                  <span style={{ fontSize: 10.5, color: T.textMuted }}>
                    {when(s.last_active_at)}
                    {turns(s.message_count) > 0 && ` · ${turns(s.message_count)}문답`}
                  </span>
                </button>

                {/* 삭제는 2단계다. CASCADE 로 메시지·인용까지 사라지므로
                    한 번의 오클릭으로 지워지면 안 된다 */}
                <button
                  type="button"
                  onClick={() => setConfirmId(confirming ? null : s.id)}
                  // 접근성 이름이 서로의 부분 문자열이면 안 된다. "대화 삭제"·
                  // "삭제 취소"·"삭제" 를 함께 두었더니 스크린리더 사용자도,
                  // 자동화도 어느 버튼인지 가릴 수 없었다 (실측 2026-08-30 —
                  // 테스트가 확인 버튼 대신 취소를 눌러 삭제가 조용히 무시됐다).
                  aria-label={confirming ? "메뉴 닫기" : "대화 메뉴 열기"}
                  aria-expanded={confirming}
                  title={confirming ? "닫기" : "더보기"}
                  style={{
                    border: "none",
                    background: "transparent",
                    color: confirming ? T.textMuted : T.textMuted,
                    cursor: "pointer",
                    fontSize: 13,
                    lineHeight: 1,
                    padding: "10px 10px 0 6px",
                  }}
                >
                  {confirming ? "✕" : "⋯"}
                </button>
              </div>

              {confirming && (
                <div
                  style={{
                    padding: "0 11px 10px",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <span style={{ fontSize: 11, color: T.textSub }}>
                    이 대화를 지울까요?
                  </span>
                  <button
                    type="button"
                    onClick={() => void remove(s.id)}
                    aria-label={`${s.title ?? "제목 없는 대화"} 삭제 확인`}
                    style={{
                      border: `1px solid ${T.error}`,
                      background: T.surface,
                      color: T.error,
                      borderRadius: 5,
                      fontSize: 11,
                      padding: "3px 9px",
                      cursor: "pointer",
                    }}
                  >
                    삭제
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
