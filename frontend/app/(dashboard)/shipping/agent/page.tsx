"use client";

/**
 * FE-RT-20 · `/shipping/agent` · 출하 AI Agent (FR-S-05 · **선택**)
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * 🔴 이전 구현이 이 프로젝트에서 **조용한 실패가 가장 노골적인 곳**이었다.
 *   `MOCK_RESPONSES` 3건을 900ms 지연 뒤 뿌려서 **동작하는 것처럼** 보이게 했고,
 *   "연결 데이터소스 · 연결됨" 초록불 4개까지 붙어 있었다. 연결된 것은 하나도 없었다.
 *
 * v1 범위는 **LLM 연동 없음**이다. 이 화면이 하는 일은 정확히 두 가지다.
 *   1. 질문을 실제로 `POST /api/v1/agents/shipping` 로 보낸다 (Network 탭에 요청이 남는다)
 *   2. 서버가 주는 **501 을 그대로 사용자에게 보인다**
 *
 * 금지: `setTimeout` + 미리 쓴 답변 · 가짜 연결 상태 표시 ·
 *       대화를 `localStorage`/`sessionStorage` 에 저장해 "이력이 있는 척" 하기.
 *       대화는 **메모리에만** 있고 새로고침하면 사라진다 (저장 테이블이 없다 — CR-DB-002).
 * ══════════════════════════════════════════════════════════════════════════════
 */

import { useRef, useState } from "react";
import * as api from "@/lib/koryo-api";
import { resolveError } from "@/lib/error-contract";
import { T } from "@/components/ui/tokens";

const MAX_QUESTION_LEN = 1000;

/** FR-S-05 원문 2구절 그대로. 임의로 늘리지 않는다 */
const PLANNED_FEATURES = ["출하 LOT 품질 요약", "고객사 최적 LOT 매칭"];

const EXAMPLE_QUESTIONS = [
  "이번 주 출하 예정 LOT 중 품질 점수가 낮은 것은?",
  "CUST-A 에 보낼 만한 LOT 을 추천해줘",
];

interface Turn {
  id: number;
  role: "user" | "error";
  text: string;
  /** 오류 말풍선에 붙는 계약 출처 */
  source?: string;
  at: string;
}

export default function ShippingAgentPage() {
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [sending, setSending] = useState(false);
  const nextId = useRef(1);

  const trimmed = question.trim();
  const canSend = trimmed.length > 0 && !sending;

  async function send() {
    if (!canSend) return;
    const now = new Date().toLocaleTimeString("ko-KR", { hour12: false });
    setTurns((prev) => [
      ...prev,
      { id: nextId.current++, role: "user", text: trimmed, at: now },
    ]);
    setQuestion("");
    setSending(true);
    try {
      // 실제 요청이다. v1 에서 이 줄은 항상 throw 한다 (서버가 501 을 낸다)
      const res = await api.askShippingAgent(trimmed);
      // 서버가 언젠가 구현되면 여기로 온다. 그 전까지 도달하지 않는다.
      setTurns((prev) => [
        ...prev,
        {
          id: nextId.current++,
          role: "error",
          text: res.answer,
          at: new Date().toLocaleTimeString("ko-KR", { hour12: false }),
        },
      ]);
    } catch (err) {
      const entry = resolveError(err);
      const detail = err instanceof Error ? err.message : entry.detail;
      setTurns((prev) => [
        ...prev,
        {
          id: nextId.current++,
          role: "error",
          text:
            entry.status === 501
              ? `AI Agent 기능은 아직 제공되지 않습니다 (미구현) — ${detail}`
              : `${entry.title} — ${detail}`,
          source: entry.status === 501 ? "api-contract §8.10 · CR-DB-002 대상" : entry.source,
          at: new Date().toLocaleTimeString("ko-KR", { hour12: false }),
        },
      ]);
    } finally {
      setSending(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* [A] 헤더 */}
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: T.text, margin: 0 }}>출하 AI Agent</h1>
        <p style={{ fontSize: 12.5, color: T.textSub, margin: "4px 0 0" }}>
          출하 관련 질의응답 (FR-S-05 · 선택 요구사항)
        </p>
      </div>

      {/* [B] 준비 중 배너 — 상시 노출, 닫기 버튼 없음 */}
      <div
        role="status"
        style={{
          background: "#FFFBEB",
          border: "1px solid #FCD34D",
          borderRadius: 10,
          padding: "12px 16px",
          display: "flex",
          gap: 10,
          alignItems: "flex-start",
        }}
      >
        <span aria-hidden="true" style={{ fontSize: 15, lineHeight: 1.2 }}>
          ⚠
        </span>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#92400E" }}>
            AI Agent 기능은 준비 중입니다 (선택 요구사항 FR-S-05)
          </div>
          <div style={{ fontSize: 12, color: "#92400E", marginTop: 4, lineHeight: 1.6 }}>
            질문을 보내면 서버가 <b>501 미구현</b>을 응답합니다. 이 화면은 그 응답을 그대로 보여줍니다 —
            그럴듯한 답변을 지어내지 않습니다. 대화 저장 테이블이 없어 새로고침하면 대화가 사라집니다.
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 20, alignItems: "start" }}>
        {/* [C] 대화 영역 */}
        <div className="card" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12, minHeight: 260 }}>
            {/* 시스템 안내 1건 — 고정 */}
            <Bubble tone="system" at={null}>
              출하 관련 질문을 입력하면 서버로 전송됩니다. 현재는 미구현 상태라 답변 대신 서버의 501
              응답이 표시됩니다.
            </Bubble>

            {turns.map((t) =>
              t.role === "user" ? (
                <Bubble key={t.id} tone="user" at={t.at}>
                  {t.text}
                </Bubble>
              ) : (
                <Bubble key={t.id} tone="error" at={t.at} source={t.source}>
                  {t.text}
                </Bubble>
              )
            )}

            {sending && (
              <Bubble tone="system" at={null}>
                <span aria-live="polite">전송 중…</span>
              </Bubble>
            )}
          </div>

          {/* 예시 질문 칩 — 입력창을 채울 뿐, 답변을 만들지 않는다 */}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {EXAMPLE_QUESTIONS.map((q) => (
              <button
                key={q}
                type="button"
                className="btn"
                style={{ fontSize: 11.5 }}
                onClick={() => setQuestion(q)}
              >
                {q}
              </button>
            ))}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
            style={{ display: "flex", gap: 8, alignItems: "flex-end" }}
          >
            <textarea
              value={question}
              maxLength={MAX_QUESTION_LEN}
              rows={2}
              placeholder="질문을 입력하세요"
              onChange={(e) => setQuestion(e.target.value)}
              style={{
                flex: 1,
                padding: 8,
                border: `1px solid ${T.border}`,
                borderRadius: 6,
                fontSize: 12.5,
                fontFamily: "inherit",
                resize: "vertical",
                outline: "none",
              }}
            />
            <button type="submit" className="btn pri" disabled={!canSend}>
              {sending ? "전송 중…" : "전송"}
            </button>
          </form>
          <div style={{ fontSize: 11, color: T.textMuted }}>
            {trimmed.length} / {MAX_QUESTION_LEN}자
          </div>
        </div>

        {/* [D] 사이드 정보 — 가짜 연결 상태 표시는 없다 */}
        <div className="card">
          <div style={{ fontSize: 13, fontWeight: 700, color: T.text, marginBottom: 12 }}>예정 기능</div>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: T.textSub, lineHeight: 1.9 }}>
            {PLANNED_FEATURES.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
          <p style={{ fontSize: 11.5, color: T.textMuted, margin: "14px 0 0", lineHeight: 1.6 }}>
            연동된 데이터소스가 아직 없습니다. LLM 연동과 대화 이력 저장은 v1 범위 밖이며
            CR-DB-002 대상입니다.
          </p>
        </div>
      </div>
    </div>
  );
}

function Bubble({
  tone,
  at,
  source,
  children,
}: {
  tone: "system" | "user" | "error";
  at: string | null;
  source?: string;
  children: React.ReactNode;
}) {
  const isUser = tone === "user";
  const border = tone === "error" ? T.warning : T.border;
  const bg = tone === "error" ? "#FFFBEB" : isUser ? "#EEF1FD" : T.surfaceSubtle;
  const color = tone === "error" ? "#92400E" : T.text;

  return (
    <div style={{ display: "flex", justifyContent: isUser ? "flex-end" : "flex-start" }}>
      <div
        role={tone === "error" ? "alert" : undefined}
        style={{
          maxWidth: "78%",
          background: bg,
          border: `1px solid ${border}`,
          borderRadius: 10,
          padding: "10px 14px",
          fontSize: 12.5,
          color,
          lineHeight: 1.6,
          whiteSpace: "pre-wrap",
        }}
      >
        {children}
        {(at || source) && (
          <div style={{ fontSize: 10.5, color: T.textMuted, marginTop: 6 }}>
            {at}
            {at && source ? " · " : ""}
            {source}
          </div>
        )}
      </div>
    </div>
  );
}
