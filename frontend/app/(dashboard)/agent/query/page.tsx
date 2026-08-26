"use client";

/**
 * FE-RT-38 — 질의 응답 · `/agent/query` · FR-AG-01 (**선택**)
 *
 * 명세: `specs/plan-g3.md` FE-RT-38 · 공통 전제 §G9-1·§G9-2. 와이어프레임 없음(SF-TD3 §3).
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * 🔴 v1 범위 = **"준비 중" 을 정직하게 그리는 것까지**다.
 *
 * `api-contract.md` §8.10 이 직접 지시한다:
 *   *"LLM 을 실제로 붙일 필요가 없다. 저장 테이블도 없다(CR-DB-001).
 *     → 501 을 반환하고 화면은 '준비 중' 상태를 명시적으로 렌더링한다.
 *     `POST /agents/*` 를 가짜 문자열로 채워 '동작하는 것처럼' 보이게 만들지 마라."*
 *
 * 라운드 2 에서 지운 것:
 *   - 하드코딩 응답 사전 (미리 쓴 답 3건 + "전체 데이터베이스를 분석 중입니다…" 거짓 분석)
 *   - `QUICK_CHIPS` 7개 (누르면 준비된 답이 나오는 구조 = 가짜 동작의 원천)
 *   - `HISTORY_SESSIONS` 5건 (세션 저장 API 가 계약에 없다)
 *   - 가짜 1.1초 지연 타이머 + 타이핑 점 애니메이션
 *   - **"연결된 데이터: 배합이력·품질검사·출하관리·공정조건·설비이력" 녹색 점**
 *     — 연결돼 있지 않다. 연결 상태를 알려주는 응답 필드조차 없다
 *   - 초기 인사말 — 동작하지 않는 기능이 인사부터 하면 안 된다
 *   - 답변 속 수치(불량률 2.3%, 품질점수 87.3점, SLSQP 1,000회) — 전부 근거 없는 값
 *
 * 남긴 것: 입력 폼은 **실제로 동작한다.** 전송하면 진짜 `POST /api/v1/agents/query`
 * 요청이 나가고, 서버가 준 501 을 그대로 화면에 표시한다 (§G9-1 게이트 5개).
 * ══════════════════════════════════════════════════════════════════════════════
 */

import { useCallback, useRef, useState } from "react";
import { askAgentQuery, type AgentAnswer } from "@/lib/koryo-api";
import { T } from "@/components/ui/tokens";
import { PageHeader, PageShell, Section } from "../../_g1/ui";
import {
  PendingBanner,
  PendingResult,
  errStatus,
  errText,
  isNotImplemented,
} from "../../_g3/ui";

/** 질문 길이 상한 — **계약 미정의. 판단값이다** (§G9-2) */
const MAX_QUESTION = 1000;

interface Turn {
  id: number;
  question: string;
  /** 서버가 실제로 무엇을 돌려줬는지. 답을 지어내지 않는다 */
  outcome:
    | { kind: "pending"; message: string }
    | { kind: "error"; message: string; status: number | null }
    | { kind: "answer"; data: AgentAnswer };
}

export default function AgentQueryPage() {
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [sending, setSending] = useState(false);
  const seq = useRef(0);

  const tooLong = question.length > MAX_QUESTION;
  const canSend = question.trim().length > 0 && !tooLong && !sending;

  const send = useCallback(async () => {
    const q = question.trim();
    if (!q || q.length > MAX_QUESTION || sending) return;

    setSending(true);
    setQuestion("");
    seq.current += 1;
    const id = seq.current;

    try {
      // 🔴 실제 요청이다. `context` 는 계약이 의미를 정의하지 않아 **보내지 않는다** (§4)
      const data = await askAgentQuery(q);
      setTurns((prev) => [...prev, { id, question: q, outcome: { kind: "answer", data } }]);
    } catch (err) {
      const status = errStatus(err);
      const message = errText(err);
      setTurns((prev) => [
        ...prev,
        {
          id,
          question: q,
          outcome: isNotImplemented(status, message)
            ? { kind: "pending", message }
            : { kind: "error", message, status },
        },
      ]);
    } finally {
      setSending(false);
    }
  }, [question, sending]);

  return (
    <PageShell>
      <PageHeader title="질의 응답" subtitle="자연어 질문 기반 데이터 조회" />

      <PendingBanner note="질문은 실제로 서버에 전송되지만, v1 에서는 답변 생성 기능이 제공되지 않습니다." />

      <Section title="대화">
        {turns.length === 0 ? (
          <div
            style={{
              minHeight: 220,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 13,
              color: T.textMuted,
            }}
          >
            아직 전송한 질문이 없습니다.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 14, minHeight: 220 }}>
            {turns.map((t) => (
              <div key={t.id} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {/* 질문은 화면에 남긴다 (§5) */}
                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  <div
                    style={{
                      maxWidth: "72%",
                      padding: "10px 14px",
                      borderRadius: "10px 10px 2px 10px",
                      background: T.primary,
                      color: "#fff",
                      fontSize: 12.5,
                      lineHeight: 1.6,
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                    }}
                  >
                    {t.question}
                  </div>
                </div>

                <div style={{ maxWidth: "82%" }}>
                  {t.outcome.kind === "pending" && (
                    <PendingResult
                      detail="질의 응답 기능은 v1 범위 밖입니다. 서버가 이 요청을 처리하지 않았습니다 (HTTP 501)."
                      serverMessage={t.outcome.message}
                    />
                  )}
                  {t.outcome.kind === "error" && (
                    <div
                      style={{
                        padding: "12px 14px",
                        borderRadius: 10,
                        border: `1px solid ${T.error}`,
                        background: "#FEF3F2",
                        color: "#B42318",
                        fontSize: 12.5,
                        lineHeight: 1.6,
                      }}
                    >
                      <strong style={{ fontWeight: 600 }}>요청이 실패했습니다</strong>
                      <div style={{ marginTop: 4, wordBreak: "break-all" }}>
                        {t.outcome.status !== null ? `HTTP ${t.outcome.status} — ` : ""}
                        {t.outcome.message}
                      </div>
                    </div>
                  )}
                  {/* v1 에서는 도달하지 않는다. 서버가 응답을 주기 시작하면 그때 그린다 */}
                  {t.outcome.kind === "answer" && (
                    <div
                      style={{
                        padding: "12px 14px",
                        borderRadius: 10,
                        border: `1px solid ${T.border}`,
                        background: T.surface,
                        fontSize: 12.5,
                        lineHeight: 1.7,
                        color: T.text,
                        whiteSpace: "pre-wrap",
                      }}
                    >
                      {t.outcome.data.answer}
                      {t.outcome.data.sources?.length > 0 && (
                        <div style={{ marginTop: 8, fontSize: 11.5, color: T.textMuted }}>
                          출처: {t.outcome.data.sources.join(" · ")}
                        </div>
                      )}
                      {typeof t.outcome.data.latency_ms === "number" && (
                        <div style={{ marginTop: 2, fontSize: 11.5, color: T.textMuted }}>
                          응답 시간 {Math.round(t.outcome.data.latency_ms)} ms
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
            <label htmlFor="agent-q" className="sr-only" style={{ display: "none" }}>
              질문
            </label>
            <textarea
              id="agent-q"
              value={question}
              rows={2}
              placeholder="질문을 입력하세요…"
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: 8,
                border: `1px solid ${tooLong ? T.error : T.border}`,
                fontSize: 12.5,
                fontFamily: "inherit",
                lineHeight: 1.6,
                resize: "vertical",
                color: T.text,
              }}
            />
            <span
              style={{ fontSize: 11.5, color: tooLong ? T.error : T.textMuted }}
            >
              {tooLong
                ? `질문은 ${MAX_QUESTION.toLocaleString()}자를 넘을 수 없습니다 (현재 ${question.length.toLocaleString()}자)`
                : `${question.length.toLocaleString()} / ${MAX_QUESTION.toLocaleString()}자 · Enter 전송 · Shift+Enter 줄바꿈`}
            </span>
          </div>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!canSend}
            onClick={() => void send()}
            style={{ height: 42, minWidth: 84 }}
          >
            {sending ? "전송 중…" : "전송"}
          </button>
        </div>
      </Section>
    </PageShell>
  );
}
