"use client";

/**
 * FE-RT-10 — 입고 AI Agent · `/receiving/agent` · FR-R-05 (선택)
 *
 * 명세: `specs/plan-g1.md` FE-RT-10 · `contracts/api-contract.md` §8.3 · §8.10 · §5.1
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * 이 화면의 게이트는 "가짜 답변"이 아니라 "정직한 준비 중"이다.
 *
 * goal.md §2.1  선택 항목은 **UI 동작까지만**이 게이트다. LLM 을 붙일 필요가 없다.
 * api-contract §8.10  **`POST /agents/*` 를 가짜 문자열로 채워 "동작하는 것처럼"
 *                     보이게 만들지 마라.**
 *
 * → "UI 동작" = `요청 → 501 → 명시적 준비중 표시`. **"답변 생성"이 아니다.**
 *
 * 라운드 2 에서 삭제한 것:
 *   - `MOCK_RESPONSES` 5문답 사전 (약 12줄) + `getResponse()` 부분문자열 매칭 (약 10줄)
 *   - `setTimeout(..., 900)` 지연 연출 — 사용자가 실제 AI 응답과 구분할 수 없었다
 *   - 데이터 범위 패널 (`"공급사 4개사 · 마지막 갱신 14:22"` 하드코딩)
 *   - 초록 `● 온라인` 배지 — 서버가 501 인데 "온라인"은 **거짓 표시**다
 *   - `SUP_D`·`글로벌메탈`·`클레임` 등 **존재하지 않는 데이터**를 전제한 답변 전체
 *     (`SUP_D` 는 `SupplierCode` 3값에 없고 `suppliers` 시드도 3건이다)
 *
 * 유지한 것: 채팅 UI 골격(버블 좌우 정렬·타임스탬프·타이핑 인디케이터·예시 질문 패널).
 * **껍데기는 좋고 내용물이 문제였다.** 승인 후 그대로 재사용한다.
 * ══════════════════════════════════════════════════════════════════════════════
 */

import { useEffect, useRef, useState } from "react";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { T } from "@/components/ui/tokens";
import { askReceivingAgent } from "@/lib/koryo-api";
import { resolveError } from "@/lib/error-contract";
import { NotImplementedBanner, PageHeader, PageShell } from "../../_g1/ui";

/**
 * CR-DB-001 승인 범위(8테이블)에 Agent 대화 이력 테이블이 **없다** (db-schema.md §6).
 * 저장소가 없으므로 `POST /agents/receiving` 는 501 이다 (실측 2026-08-25).
 *
 * 승인되면 이 상수만 `true` 로 바꾼다 — 전송 경로는 이미 실 API 로 배선돼 있다.
 * (`boolean` 으로 명시해 리터럴 narrowing 을 막는다)
 */
const AGENT_ENABLED: boolean = false;

/** SF-AD2 §1.2 `FR-R-05` 본문("공급사별 성분 편차 패턴 분석 및 입고 품질 예측")에서 도출 */
const EXAMPLE_QUESTIONS = [
  "공급사별 Sn 편차 패턴을 분석해줘",
  "SUP_A 의 최근 90일 성분 안정성은?",
  "다음 입고 LOT 의 품질을 예측해줘",
] as const;

type ChatRole = "user" | "agent" | "system";

interface ChatMessage {
  id: string;
  role: ChatRole;
  text: string;
  /** `HH:mm` — 클라이언트 생성. 안내 메시지는 비워 둔다 (SSR 하이드레이션 불일치 방지) */
  time: string;
  /** 응답 `sources[]`. 비어 있으면 출처 영역을 숨긴다 (환각 방지) */
  sources?: string[];
}

const GUIDE_MESSAGE: ChatMessage = {
  id: "guide",
  role: "agent",
  text: "입고 데이터에 대해 질문해 주세요.\n공급사별 성분 편차 패턴과 입고 품질 예측을 다룹니다.",
  time: "",
};

function clockHHmm(): string {
  return new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
}

export default function ReceivingAgentPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([GUIDE_MESSAGE]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const seqRef = useRef(0);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, pending]);

  /** `Math.random()` 을 쓰지 않는다 — 단조 증가 카운터로 충분하다 */
  const nextId = (prefix: string) => `${prefix}-${(seqRef.current += 1)}`;

  /**
   * 실 API 경로다. v1 에서는 컨트롤이 `disabled` 라 도달하지 않지만
   * **승인 즉시 그대로 동작**해야 하므로 배선해 둔다.
   *
   * 실패하면 회색 **시스템 메시지**로 계약 문구를 그대로 보여준다.
   * 지어낸 답변으로 대체하지 않는다 (goal.md §3 조용한 실패 금지).
   */
  async function send(rawQuestion: string) {
    const question = rawQuestion.trim();
    if (!AGENT_ENABLED || question.length === 0 || pending) return;

    setMessages((prev) => [
      ...prev,
      { id: nextId("u"), role: "user", text: question, time: clockHHmm() },
    ]);
    setInput("");
    setPending(true);

    try {
      const res = await askReceivingAgent(question);
      setMessages((prev) => [
        ...prev,
        {
          id: nextId("a"),
          role: "agent",
          text: res.answer,
          time: clockHHmm(),
          sources: res.sources,
        },
      ]);
    } catch (err) {
      const entry = resolveError(err);
      const raw = err instanceof Error ? err.message : String(err);
      setMessages((prev) => [
        ...prev,
        {
          id: nextId("s"),
          role: "system",
          text: `${entry.title} — ${entry.detail}\n(${raw})`,
          time: clockHHmm(),
        },
      ]);
    } finally {
      setPending(false);
    }
  }

  const canSend = AGENT_ENABLED && input.trim().length > 0 && !pending;
  const controlsDisabled = !AGENT_ENABLED || pending;

  return (
    <PageShell>
      <PageHeader
        title="입고 AI Agent"
        subtitle="공급사별 성분 편차 패턴 분석 및 입고 품질 예측 (FR-R-05 · 선택 항목)"
        actions={<StatusBadge variant="gray" label="준비 중" dot />}
      />

      {/* 501 — 계약 문구는 `lib/error-contract.ts` 가 정본이다 */}
      <NotImplementedBanner reason="Agent 대화 이력 테이블이 CR-DB-001 승인 8개 테이블에 포함되지 않아 저장소가 없습니다. POST /api/v1/agents/receiving 는 현재 501 을 반환합니다." />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 260px", gap: 20, alignItems: "start" }}>
        {/* ── 대화 패널 ──────────────────────────────────────────────────── */}
        <div
          className="card"
          style={{ display: "flex", flexDirection: "column", padding: 0, overflow: "hidden", minHeight: 520 }}
        >
          <div
            style={{
              padding: "12px 16px",
              borderBottom: `1px solid ${T.border}`,
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}
          >
            <AgentAvatar size={34} muted />
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: T.text }}>입고관리 AI Agent</span>
              {/* 초록 "온라인" 을 쓰지 않는다 — 서버는 501 이다 */}
              <span style={{ fontSize: 11, color: T.textMuted }}>준비 중 · 응답 불가</span>
            </div>
          </div>

          <div
            style={{
              flex: 1,
              overflowY: "auto",
              padding: 16,
              display: "flex",
              flexDirection: "column",
              gap: 12,
              minHeight: 320,
            }}
          >
            {messages.map((m) => (
              <MessageBubble key={m.id} message={m} />
            ))}
            {pending && <TypingIndicator />}
            <div ref={bottomRef} />
          </div>

          <div
            style={{
              padding: "12px 16px",
              borderTop: `1px solid ${T.border}`,
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
              <textarea
                value={input}
                disabled={controlsDisabled}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send(input);
                  }
                }}
                rows={2}
                placeholder={
                  AGENT_ENABLED
                    ? "질문을 입력하세요 (Enter 전송 · Shift+Enter 줄바꿈)"
                    : "준비 중입니다 — 승인 후 질문할 수 있습니다"
                }
                style={{
                  flex: 1,
                  resize: "none",
                  padding: "9px 12px",
                  fontSize: 13,
                  fontFamily: "inherit",
                  lineHeight: 1.5,
                  border: `1px solid ${T.border}`,
                  borderRadius: 8,
                  outline: "none",
                  color: T.text,
                  background: controlsDisabled ? T.surfaceSubtle : T.surface,
                  opacity: controlsDisabled ? 0.6 : 1,
                  cursor: controlsDisabled ? "not-allowed" : "text",
                }}
              />
              <button
                type="button"
                className="btn pri"
                onClick={() => void send(input)}
                disabled={!canSend}
                style={{
                  padding: "9px 18px",
                  opacity: canSend ? 1 : 0.5,
                  cursor: canSend ? "pointer" : "not-allowed",
                }}
              >
                전송
              </button>
            </div>
            <span style={{ fontSize: 11, color: T.textMuted, lineHeight: 1.6 }}>
              대화 이력 저장 테이블이 없어 <strong>세션 메모리로만</strong> 유지됩니다 — 새로고침하면
              초기화됩니다.
            </span>
          </div>
        </div>

        {/* ── 예시 질문 ──────────────────────────────────────────────────── */}
        <div className="card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: T.text }}>예시 질문</span>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {EXAMPLE_QUESTIONS.map((q) => (
              <button
                key={q}
                type="button"
                disabled={controlsDisabled}
                onClick={() => setInput(q)}
                style={{
                  textAlign: "left",
                  padding: "8px 10px",
                  fontSize: 12,
                  lineHeight: 1.5,
                  color: "#1D4ED8",
                  background: "#EEF1FD",
                  border: "1px solid #C7D2F8",
                  borderRadius: 7,
                  fontFamily: "inherit",
                  opacity: controlsDisabled ? 0.5 : 1,
                  cursor: controlsDisabled ? "not-allowed" : "pointer",
                }}
              >
                {q}
              </button>
            ))}
          </div>
          <span style={{ fontSize: 11, color: T.textMuted, lineHeight: 1.6 }}>
            SF-AD2 §1.2 FR-R-05 본문에서 도출한 질의 유형입니다.
          </span>
        </div>
      </div>
    </PageShell>
  );
}

// ── 조각 ─────────────────────────────────────────────────────────────────────
// FE-RT-15 와 채팅 UI 가 거의 같다. 공용 `components/agent/ChatPanel.tsx` 로의 추출은
// 디자이너(웨이브 B) 소관이라 라운드 2 에서는 화면별 지역 구현으로 둔다
// (`components/` 는 개발2 R2 담당 — 건드리지 않는다).

function AgentAvatar({ size = 28, muted = false }: { size?: number; muted?: boolean }) {
  return (
    <div
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        // 준비 중 상태에서는 채도를 낮춘다 — "작동 중"으로 읽히지 않게
        background: muted ? T.border : "linear-gradient(135deg, #3A5BD9, #6B8AFF)",
      }}
    >
      <svg width={size * 0.47} height={size * 0.47} viewBox="0 0 16 16" fill="none">
        <path
          d="M8 2a3 3 0 100 6 3 3 0 000-6zM3 13c0-2.21 2.239-4 5-4s5 1.79 5 4"
          stroke={muted ? "#687182" : "#fff"}
          strokeWidth="1.4"
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  const isSystem = message.role === "system";

  if (isSystem) {
    // 오류·미구현 안내 — 답변 버블과 시각적으로 구분한다
    return (
      <div style={{ display: "flex", justifyContent: "center" }}>
        <div
          role="status"
          style={{
            maxWidth: "88%",
            padding: "9px 14px",
            borderRadius: 8,
            background: T.surfaceSubtle,
            border: `1px solid ${T.border}`,
            color: T.textSub,
            fontSize: 12,
            lineHeight: 1.6,
            whiteSpace: "pre-wrap",
            textAlign: "center",
          }}
        >
          {message.text}
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: isUser ? "row-reverse" : "row",
        gap: 8,
        alignItems: "flex-end",
      }}
    >
      {!isUser && <AgentAvatar muted />}
      <div style={{ maxWidth: "72%", minWidth: 0 }}>
        <div
          style={{
            padding: "10px 14px",
            borderRadius: isUser ? "12px 12px 2px 12px" : "12px 12px 12px 2px",
            background: isUser ? T.primary : T.surfaceSubtle,
            color: isUser ? "#fff" : T.text,
            border: isUser ? "none" : `1px solid ${T.border}`,
            fontSize: 13,
            lineHeight: 1.6,
            whiteSpace: "pre-wrap",
          }}
        >
          {message.text}
        </div>

        {/* 근거 출처 — 서버 `sources[]`. 비어 있으면 영역 자체를 그리지 않는다 */}
        {!isUser && message.sources && message.sources.length > 0 && (
          <div
            style={{
              marginTop: 6,
              padding: "7px 10px",
              borderRadius: 7,
              border: `1px solid ${T.border}`,
              background: T.surface,
              display: "flex",
              flexDirection: "column",
              gap: 3,
            }}
          >
            <span style={{ fontSize: 10.5, fontWeight: 700, color: T.textMuted }}>근거 출처</span>
            {message.sources.map((s, i) => (
              <span key={`${s}-${i}`} style={{ fontSize: 11.5, color: T.textSub, lineHeight: 1.5 }}>
                • {s}
              </span>
            ))}
          </div>
        )}

        {message.time && (
          <div
            style={{
              fontSize: 10.5,
              color: T.textMuted,
              marginTop: 3,
              textAlign: isUser ? "right" : "left",
            }}
          >
            {message.time}
          </div>
        )}
      </div>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
      <AgentAvatar muted />
      <div
        aria-label="응답 대기 중"
        style={{
          padding: "10px 14px",
          borderRadius: "12px 12px 12px 2px",
          background: T.surfaceSubtle,
          border: `1px solid ${T.border}`,
          display: "flex",
          gap: 4,
          alignItems: "center",
        }}
      >
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: T.textMuted,
              display: "inline-block",
              animation: `agentDot 1s ease-in-out ${i * 0.15}s infinite`,
            }}
          />
        ))}
      </div>
      <style>{`
        @keyframes agentDot {
          0%, 80%, 100% { transform: translateY(0); }
          40% { transform: translateY(-5px); }
        }
      `}</style>
    </div>
  );
}
