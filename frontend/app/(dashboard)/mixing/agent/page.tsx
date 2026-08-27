"use client";

/**
 * FE-RT-15 — 배합 AI Agent · `/mixing/agent` · FR-M-05 (선택)
 *
 * 명세: `specs/plan-g1.md` FE-RT-15 · `contracts/api-contract.md` §8.4 · §8.10 · §5.1
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * 이 화면은 FE-RT-10 보다 **더 위험했다.** 가짜 답변에 수치 카드까지 붙어 있어서
 * 실제 분석 결과로 오인되기 쉬웠다.
 *
 * 라운드 2 에서 삭제한 것 (612줄 → 대폭 축소):
 *   - `generateResponse()` + 6분기 하드코딩 답변 (약 115줄)
 *     `SN 편차` · `SUP_A 품질` · `최적 배합` · `불량 공정조건` · `AG 경고` · `이상치`
 *   - `AnalysisCard` 의 **지어낸 수치 전부** — `+3.2%`, `87.3점`, `불량률 8.2%`,
 *     `61.85%`, `LOT-2026-0625`, `SUP_C 불량률 8.2%`, `합격률 94.4%` …
 *     전부 DB 에 없는 값이다
 *   - `QUICK_QUESTIONS` 6개 · `INITIAL_MESSAGES` mock 본문
 *   - `setTimeout(..., 800 + Math.random() * 600)` 사고 연출
 *   - `Math.random()` 기반 `uid()` → 단조 증가 카운터
 *   - 초록 `● 온라인` 배지 (서버는 501 이다) · `"AI 응답은 ML 모델 기반 분석 결과입니다"` 문구
 *
 * 유지한 것: 채팅 UI 골격 · `AIIcon` · `AnalysisCardView` **골격**.
 * 카드는 **서버 `recommended_ratios` 전용**으로 다시 배선했다.
 * ══════════════════════════════════════════════════════════════════════════════
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { isSubmitKey } from "@/lib/ime";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { T } from "@/components/ui/tokens";
import { askMixingAgent, type AgentCitation } from "@/lib/koryo-api";
import { resolveError } from "@/lib/error-contract";
import { COMPONENT_BOUNDS } from "@/types/api";
import { NotImplementedBanner, PageHeader, PageShell, num } from "../../_g1/ui";

/**
 * CR-DB-001 승인 8테이블(`receipts`·`claims`·`process_conditions`·`condition_history`·
 * `notification_rules`·`system_settings`·`master_codes`·`kpi_targets`)에 Agent 계열이
 * **없다** (db-schema.md §6). `POST /agents/mixing` 는 501 이다 (실측 2026-08-25).
 *
 * 승인되면 이 상수만 `true` 로 바꾼다 — 전송 경로는 이미 실 API 로 배선돼 있다.
 */
const AGENT_ENABLED: boolean = false;

/** 1번은 SF-AD2 §1.3 `FR-M-05` **원문 그대로**다. 2·3번은 같은 범위에서 도출했다 */
const EXAMPLE_QUESTIONS = [
  "Ag 3.2% 공급사 A 사용 시 최적 비율은?",
  "250°C / 45분 조건에서 최적 배합을 추천해줘",
  "Sn 편차가 큰 LOT 의 원인을 분석해줘",
] as const;

/** goal.md 2.3 — 합계 허용 오차 */
const SUM_TOLERANCE = 0.05;

const RATIO_KEYS = ["sn", "ag", "cu", "pb"] as const;
type RatioKey = (typeof RATIO_KEYS)[number];

const RATIO_LABELS: Record<RatioKey, string> = {
  sn: "Sn",
  ag: "Ag",
  cu: "Cu",
  pb: "Pb",
};

type ChatRole = "user" | "agent" | "system";

interface ChatMessage {
  id: string;
  role: ChatRole;
  /**
   * 🔴 **null 이 정상 값이다** (`agent-architecture.md` §6.4).
   * 근거가 없거나 룰 위반으로 답변을 폐기하면 서버가 null 을 준다.
   * 빈 문자열로 위장하지 않는다.
   */
  text: string | null;
  /** `HH:mm` — 클라이언트 생성. 안내 메시지는 비워 둔다 (SSR 하이드레이션 불일치 방지) */
  time: string;
  /** §7.11 — `string[]` 에서 `Citation[]` 으로 승격됐다 */
  sources?: AgentCitation[];
  /**
   * 응답의 **선택 필드**다 (`recommended_ratios?`).
   * 없는 답변에는 카드를 렌더하지 않는다 — 빈 카드 금지 (plan-g1 §9).
   */
  ratios?: Partial<Record<RatioKey, number>>;
}

const GUIDE_MESSAGE: ChatMessage = {
  id: "guide",
  role: "agent",
  text: "배합 최적화에 대해 질문해 주세요.\n자연어로 공정 조건과 성분을 말하면 최적 비율을 찾습니다.",
  time: "",
};

function clockHHmm(): string {
  return new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
}

export default function MixingAgentPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([GUIDE_MESSAGE]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const seqRef = useRef(0);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, pending]);

  /** `Math.random()` 을 쓰지 않는다 */
  const nextId = (prefix: string) => `${prefix}-${(seqRef.current += 1)}`;

  /**
   * 실 API 경로. v1 에서는 컨트롤이 `disabled` 라 도달하지 않지만
   * 승인 즉시 그대로 동작해야 하므로 배선해 둔다.
   * 실패는 회색 시스템 메시지로 **계약 문구 그대로** — 답변을 지어내지 않는다.
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
      const res = await askMixingAgent(question);
      setMessages((prev) => [
        ...prev,
        {
          id: nextId("a"),
          role: "agent",
          text: res.answer,
          time: clockHHmm(),
          sources: res.sources,
          // 서버가 준 값만 싣는다. 없으면 `undefined` → 카드가 그려지지 않는다
          ratios: res.recommended_ratios,
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
        title="배합 AI Agent"
        subtitle="자연어 배합 최적화 질의 (FR-M-05 · 선택 항목)"
        actions={<StatusBadge variant="gray" label="준비 중" dot />}
      />

      <NotImplementedBanner reason="Agent 대화·추천 이력 테이블이 CR-DB-001 승인 8개 테이블에 포함되지 않아 저장소가 없습니다. POST /api/v1/agents/mixing 는 현재 501 을 반환합니다." />

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
            <AIIcon size={34} muted />
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: T.text }}>배합 최적화 AI Agent</span>
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
              gap: 14,
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
                  if (isSubmitKey(e)) {   // 한글 조합 확정 Enter 를 전송으로 오인하지 않는다
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
            1번 질문은 SF-AD2 §1.3 FR-M-05 원문입니다.
          </span>
        </div>
      </div>
    </PageShell>
  );
}

// ── 조각 ─────────────────────────────────────────────────────────────────────
// FE-RT-10 과 채팅 UI 가 거의 같다. 공용 `components/agent/ChatPanel.tsx` 로의 추출은
// 디자이너(웨이브 B) 소관이라 라운드 2 에서는 화면별 지역 구현으로 둔다.

function AIIcon({ size = 28, muted = false }: { size?: number; muted?: boolean }) {
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
        // 준비 중에는 채도를 낮춘다 — "작동 중"으로 읽히지 않게
        background: muted ? T.border : "linear-gradient(135deg, #3A5BD9 0%, #6B8AFF 100%)",
      }}
    >
      <svg width={size * 0.47} height={size * 0.47} viewBox="0 0 16 16" fill="none">
        <path
          d="M8 2a2 2 0 0 1 2 2v1h1a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h1V4a2 2 0 0 1 2-2z"
          fill={muted ? "#687182" : "rgba(255,255,255,0.9)"}
        />
        <circle cx="6" cy="8" r="0.8" fill={muted ? T.border : "#3A5BD9"} />
        <circle cx="10" cy="8" r="0.8" fill={muted ? T.border : "#3A5BD9"} />
      </svg>
    </div>
  );
}

/**
 * 배합 결과 카드 — **서버 `recommended_ratios` 가 있을 때만** 렌더된다.
 *
 * ⚠ 응답에 `predicted_quality` 가 **없다** (api-contract §8.4 — FE-RT-14 와 다르다).
 *   그래서 이 카드에는 **품질 점수를 표시하지 않는다.** 필요하면 `자세히 보기` 로
 *   FE-RT-14 에서 다시 실행하게 유도한다.
 *
 * 소수 1자리 · 합계 행은 FE-RT-14 와 **같은 규약**이다.
 * 같은 물리량을 두 화면에서 다르게 표기하지 않는다 (plan-g1 §4).
 */
function RatioCard({ ratios }: { ratios: Partial<Record<RatioKey, number>> }) {
  const values = RATIO_KEYS.map((k) => ratios[k]);
  const present = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  // 값이 하나도 없으면 빈 카드를 그리지 않는다
  if (present.length === 0) return null;

  const sum = present.reduce((a, b) => a + b, 0);
  const sumOk = Math.abs(sum - 100) <= SUM_TOLERANCE;

  return (
    <div
      style={{
        marginTop: 10,
        width: "100%",
        background: T.surfaceSubtle,
        border: `1px solid ${T.border}`,
        borderRadius: 10,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: "8px 14px",
          background: "#EEF1FD",
          borderBottom: `1px solid ${T.border}`,
          fontSize: 11.5,
          fontWeight: 700,
          color: T.primary,
          letterSpacing: "0.02em",
        }}
      >
        추천 배합비율
      </div>

      <div style={{ padding: "10px 14px", display: "flex", flexDirection: "column", gap: 6 }}>
        {RATIO_KEYS.map((key) => {
          const v = ratios[key];
          const [lo, hi] = COMPONENT_BOUNDS[key];
          const outOfBounds = typeof v === "number" && Number.isFinite(v) && (v < lo || v > hi);
          return (
            <div
              key={key}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "3px 0",
                borderBottom: `1px solid ${T.border}`,
              }}
            >
              <span style={{ fontSize: 12, color: T.textSub }}>{RATIO_LABELS[key]}</span>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 12.5,
                  fontWeight: 700,
                  color: outOfBounds ? "#B45309" : T.text,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {num(v, 1)} %
                {outOfBounds && (
                  <span style={{ fontSize: 10.5, fontWeight: 600 }} title={`허용 ${lo} ~ ${hi}%`}>
                    ⚠ 경계 밖
                  </span>
                )}
              </span>
            </div>
          );
        })}

        {/* 합계 — 프론트 계산. FR-M-04 제약(`Sn+Ag+Cu+Pb=100%`)이 지켜졌는지 보이는 자리 */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            paddingTop: 5,
          }}
        >
          <span style={{ fontSize: 12, fontWeight: 700, color: T.textSub }}>합계</span>
          <span
            style={{
              fontSize: 12.5,
              fontWeight: 800,
              color: sumOk ? "#15803D" : T.error,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {num(sum, 1)} % {sumOk ? "✅" : "⚠"}
          </span>
        </div>
      </div>

      <div
        style={{
          padding: "8px 14px",
          borderTop: `1px solid ${T.border}`,
          background: T.surface,
          display: "flex",
          justifyContent: "flex-end",
        }}
      >
        <Link
          href="/mixing/optimize"
          style={{ fontSize: 11.5, fontWeight: 600, color: T.primary, textDecoration: "none" }}
        >
          자세히 보기 →
        </Link>
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  const isSystem = message.role === "system";

  if (isSystem) {
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
        gap: 10,
        alignItems: "flex-start",
      }}
    >
      {!isUser && <AIIcon size={34} muted />}
      <div
        style={{
          maxWidth: "72%",
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: isUser ? "flex-end" : "flex-start",
        }}
      >
        <div
          style={{
            padding: "10px 14px",
            borderRadius: isUser ? "16px 4px 16px 16px" : "4px 16px 16px 16px",
            background: isUser ? T.primary : T.surface,
            color: isUser ? "#fff" : T.text,
            border: isUser ? "none" : `1px solid ${T.border}`,
            fontSize: 13.5,
            lineHeight: 1.6,
            whiteSpace: "pre-wrap",
          }}
        >
          {message.text}
        </div>

        {/* 배합 카드 — `recommended_ratios` 가 있을 때만 */}
        {!isUser && message.ratios && <RatioCard ratios={message.ratios} />}

        {/* 근거 출처 — 비어 있으면 영역 자체를 그리지 않는다 */}
        {!isUser && message.sources && message.sources.length > 0 && (
          <div
            style={{
              marginTop: 6,
              width: "100%",
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
            {message.sources.map((s) => (
              <span key={s.ord} style={{ fontSize: 11.5, color: T.textSub, lineHeight: 1.5 }}>
                • {s.label}
                {/* 0 건도 근거다 — "조회했고 0건이었다" 는 사실이다 (§7.11.2) */}
                {s.count !== null && s.count !== undefined && ` (${s.count}건)`}
              </span>
            ))}
          </div>
        )}

        {message.time && (
          <span style={{ fontSize: 10.5, color: T.textMuted, marginTop: 3 }}>{message.time}</span>
        )}
      </div>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
      <AIIcon size={34} muted />
      <div
        aria-label="응답 대기 중"
        style={{
          padding: "12px 16px",
          borderRadius: "4px 16px 16px 16px",
          background: T.surface,
          border: `1px solid ${T.border}`,
          display: "flex",
          gap: 5,
          alignItems: "center",
        }}
      >
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: T.textMuted,
              opacity: 0.5,
              animation: `mixingDot 1.2s ${i * 0.2}s infinite`,
            }}
          />
        ))}
      </div>
      <style>{`
        @keyframes mixingDot {
          0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
          30% { transform: translateY(-5px); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
