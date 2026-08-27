"use client";

/**
 * AI Agent 대화 — FE-RT-10(입고) · FE-RT-20(출하) 공용.
 *
 * 두 화면이 같은 계약을 쓴다. 각자 구현하면 한쪽만 고쳐지는 일이 반드시 생긴다.
 * 화면별로 다른 것은 **제목·예시 질문·호출 함수** 세 개뿐이다.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * 이 컴포넌트가 지키는 계약 (`agent-architecture.md`)
 *
 * §2.9   준비 상태는 **`GET /agents/health` 만** 보고 판단한다. 화면이
 *        "온라인" 을 스스로 정하지 않는다. 초록 점을 띄우려면 서버가
 *        `configured && index_ready` 라고 말해야 한다.
 *
 * §6.4   `answer` 가 **null 인 것이 정상 값**이다. 빈 문자열로 위장하지 않는다.
 *        `answer_status` 가 왜 비었는지 말한다.
 *
 * §7.5   `answer_status` 는 5개 닫힌 집합이다. 모르는 값이 오면 그대로 표시한다 —
 *        임의로 "ok" 로 떨어뜨리면 실패가 성공으로 보인다.
 *
 * §4.5.1 `rule_violation` 이면 🔴 **본문을 지우고 위반 사유와 근거만 남긴다.**
 *        틀린 문장을 부분적으로 지우면 어디가 지워졌는지 사용자가 모른다.
 *
 * §7.11  `sources` 는 `Citation[]` 이다. `count` 가 null 인 `data` 근거와
 *        `snippet` 이 없는 `doc` 근거는 **근거로 세지 않는다** — 서버가 이미
 *        걸러 보내지만 화면도 같은 기준으로 센다.
 * ══════════════════════════════════════════════════════════════════════════
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { StatusBadge } from "@/components/ui/StatusBadge";
import { T } from "@/components/ui/tokens";
import { resolveError } from "@/lib/error-contract";
import { isSubmitKey } from "@/lib/ime";
import {
  getAgentHealth,
  submitAgentFeedback,
  type AgentAnswer,
  type AgentCitation,
  type AgentHealth,
} from "@/lib/koryo-api";

export interface AgentChatProps {
  /** 헤더에 보일 이름 */
  title: string;
  /** 이 화면이 무엇을 답하는지 — 안내 버블에 그대로 쓴다 */
  intro: string;
  exampleQuestions: readonly string[];
  ask: (question: string, sessionId?: number) => Promise<AgentAnswer>;
}

type Bubble =
  | { kind: "guide"; id: string; text: string }
  | { kind: "user"; id: string; text: string; time: string }
  | { kind: "answer"; id: string; time: string; res: AgentAnswer }
  | { kind: "system"; id: string; time: string; title: string; detail: string };

const STATUS_TEXT: Record<string, { label: string; tone: "warn" | "error" | "muted" }> = {
  no_evidence: {
    label: "근거를 찾지 못했습니다.",
    tone: "muted",
  },
  out_of_scope: {
    label: "이 화면이 답할 수 있는 질문이 아닙니다.",
    tone: "muted",
  },
  timeout: {
    label: "생성 시간이 초과됐습니다.",
    tone: "warn",
  },
  rule_violation: {
    label: "답변이 사내 기준과 어긋나 폐기했습니다. 아래 근거를 직접 확인하세요.",
    tone: "error",
  },
};

function clock(): string {
  return new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
}

/** §7.11.2·§7.11.3 — 자격 없는 근거는 세지 않는다 */
function qualifies(c: AgentCitation): boolean {
  if (c.kind === "data") return c.count !== null && c.count !== undefined;
  if (c.kind === "doc") return Boolean(c.snippet && c.snippet.trim());
  return true;
}

export function AgentChat({ title, intro, exampleQuestions, ask }: AgentChatProps) {
  const [health, setHealth] = useState<AgentHealth | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [sessionId, setSessionId] = useState<number | undefined>(undefined);
  const bottomRef = useRef<HTMLDivElement>(null);
  const seq = useRef(0);

  const nextId = (p: string) => `${p}-${(seq.current += 1)}`;

  useEffect(() => {
    let alive = true;
    getAgentHealth()
      .then((h) => alive && setHealth(h))
      .catch((e) => alive && setHealthError(resolveError(e).detail));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [bubbles, pending]);

  // 🔴 준비 여부는 서버가 정한다. 화면이 추측하지 않는다.
  const ready = Boolean(health?.configured);
  const canSend = ready && input.trim().length > 0 && !pending;

  const send = useCallback(
    async (raw: string) => {
      const question = raw.trim();
      if (!ready || !question || pending) return;

      setBubbles((prev) => [
        ...prev,
        { kind: "user", id: nextId("u"), text: question, time: clock() },
      ]);
      setInput("");
      setPending(true);
      try {
        const res = await ask(question, sessionId);
        setSessionId(res.session_id);
        setBubbles((prev) => [
          ...prev,
          { kind: "answer", id: nextId("a"), time: clock(), res },
        ]);
      } catch (err) {
        const entry = resolveError(err);
        setBubbles((prev) => [
          ...prev,
          {
            kind: "system",
            id: nextId("s"),
            time: clock(),
            title: entry.title,
            detail: entry.detail,
          },
        ]);
      } finally {
        setPending(false);
      }
    },
    [ask, pending, ready, sessionId]
  );

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 270px", gap: 20, alignItems: "start" }}>
      <div
        className="card"
        style={{ display: "flex", flexDirection: "column", padding: 0, overflow: "hidden", minHeight: 560 }}
      >
        <Header title={title} health={health} healthError={healthError} />

        {!ready && <NotReady health={health} healthError={healthError} />}

        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: 16,
            display: "flex",
            flexDirection: "column",
            gap: 14,
            minHeight: 340,
          }}
        >
          <GuideBubble text={intro} />
          {bubbles.map((b) => (
            <BubbleView key={b.id} bubble={b} />
          ))}
          {pending && <Typing />}
          <div ref={bottomRef} />
        </div>

        <div style={{ borderTop: `1px solid ${T.border}`, padding: 12, display: "flex", gap: 8 }}>
          <textarea
            rows={1}
            value={input}
            disabled={!ready || pending}
            onChange={(e) => setInput(e.target.value)}
            // 한글 조합 중 Enter 로 전송되면 글자가 잘린다 (lib/ime.ts)
            onKeyDown={(e) => {
              if (isSubmitKey(e)) {
                e.preventDefault();
                void send(input);
              }
            }}
            placeholder={ready ? "질문을 입력하세요 (Shift+Enter 줄바꿈)" : "AI Agent 가 준비되지 않았습니다"}
            style={{
              flex: 1,
              resize: "none",
              padding: "10px 12px",
              border: `1px solid ${T.border}`,
              borderRadius: 8,
              fontSize: 13.5,
              fontFamily: "inherit",
              lineHeight: 1.5,
              background: ready ? T.surface : T.surfaceSubtle,
              color: T.text,
            }}
          />
          <button
            type="button"
            className="btn btn-primary"
            disabled={!canSend}
            onClick={() => void send(input)}
            style={{ minWidth: 74 }}
          >
            {pending ? "생성 중" : "전송"}
          </button>
        </div>
      </div>

      <Sidebar
        health={health}
        examples={exampleQuestions}
        disabled={!ready || pending}
        onPick={(q) => void send(q)}
      />
    </div>
  );
}

// ── 헤더 ────────────────────────────────────────────────────────────────
function Header({
  title,
  health,
  healthError,
}: {
  title: string;
  health: AgentHealth | null;
  healthError: string | null;
}) {
  // 초록 점은 서버가 configured 라고 말할 때만 켠다 (§2.9)
  const variant = healthError ? "red" : health?.configured ? "green" : "gray";
  const label = healthError
    ? "상태 확인 불가"
    : health === null
      ? "확인 중"
      : health.configured
        ? health.index_ready
          ? "응답 가능"
          : "응답 가능 (문서 근거 없음)"
        : "미구성";

  return (
    <div
      style={{
        padding: "12px 16px",
        borderBottom: `1px solid ${T.border}`,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: T.text }}>{title}</span>
        <span style={{ fontSize: 11, color: T.textMuted }}>
          {health?.model_id ? `${health.provider} · ${health.model_id}` : "모델 미지정"}
        </span>
      </div>
      <StatusBadge variant={variant} label={label} dot />
    </div>
  );
}

function NotReady({ health, healthError }: { health: AgentHealth | null; healthError: string | null }) {
  const reason = healthError ?? health?.reason ?? "구성 상태를 확인하는 중입니다.";
  return (
    <div
      style={{
        margin: "12px 16px 0",
        padding: "10px 12px",
        borderRadius: 8,
        border: `1px solid ${T.border}`,
        background: T.surfaceSubtle,
        fontSize: 12.5,
        color: T.textSub,
        lineHeight: 1.6,
      }}
    >
      <strong style={{ color: T.text }}>AI Agent 가 준비되지 않았습니다.</strong>
      <div style={{ marginTop: 4 }}>{reason}</div>
    </div>
  );
}

// ── 버블 ────────────────────────────────────────────────────────────────
function GuideBubble({ text }: { text: string }) {
  return (
    <div
      style={{
        alignSelf: "flex-start",
        maxWidth: "82%",
        padding: "10px 13px",
        borderRadius: "12px 12px 12px 3px",
        background: T.surfaceSubtle,
        border: `1px solid ${T.border}`,
        fontSize: 13,
        color: T.textSub,
        whiteSpace: "pre-wrap",
        lineHeight: 1.65,
      }}
    >
      {text}
    </div>
  );
}

function BubbleView({ bubble }: { bubble: Bubble }) {
  if (bubble.kind === "guide") return <GuideBubble text={bubble.text} />;

  if (bubble.kind === "user") {
    return (
      <div style={{ alignSelf: "flex-end", maxWidth: "82%", textAlign: "right" }}>
        <div
          style={{
            padding: "10px 13px",
            borderRadius: "12px 12px 3px 12px",
            background: T.primary,
            color: "#fff",
            fontSize: 13,
            whiteSpace: "pre-wrap",
            textAlign: "left",
            lineHeight: 1.65,
          }}
        >
          {bubble.text}
        </div>
        <Time value={bubble.time} />
      </div>
    );
  }

  if (bubble.kind === "system") {
    return (
      <div style={{ alignSelf: "center", maxWidth: "90%" }}>
        <div
          style={{
            padding: "9px 12px",
            borderRadius: 8,
            background: T.surfaceSubtle,
            border: `1px solid ${T.error}33`,
            fontSize: 12.5,
            color: T.textSub,
            lineHeight: 1.6,
          }}
        >
          <strong style={{ color: T.error }}>{bubble.title}</strong> — {bubble.detail}
        </div>
      </div>
    );
  }

  return <AnswerBubble bubble={bubble} />;
}

function AnswerBubble({ bubble }: { bubble: Extract<Bubble, { kind: "answer" }> }) {
  const { res } = bubble;
  const note = STATUS_TEXT[res.answer_status];
  const sources = res.sources.filter(qualifies);

  return (
    <div style={{ alignSelf: "flex-start", maxWidth: "88%", display: "flex", flexDirection: "column", gap: 6 }}>
      <div
        style={{
          padding: "11px 14px",
          borderRadius: "12px 12px 12px 3px",
          background: T.surface,
          border: `1px solid ${res.answer_status === "rule_violation" ? T.error : T.border}`,
          fontSize: 13.5,
          color: T.text,
          whiteSpace: "pre-wrap",
          lineHeight: 1.7,
        }}
      >
        {/* 🔴 answer 가 null 이면 사유를 말한다. 빈 문자열로 위장하지 않는다 */}
        {res.answer ?? (
          <span style={{ color: note?.tone === "error" ? T.error : T.textMuted }}>
            {note?.label ?? `답변 없음 (${res.answer_status})`}
          </span>
        )}

        {res.violations.length > 0 && (
          <ul style={{ margin: "10px 0 0", paddingLeft: 18, fontSize: 12, color: T.error, lineHeight: 1.7 }}>
            {res.violations.map((v) => (
              <li key={v}>{v}</li>
            ))}
          </ul>
        )}

        {res.partial && (
          <div style={{ marginTop: 8, fontSize: 11.5, color: T.warning }}>
            일부 조회가 실패해 근거가 완전하지 않습니다.
          </div>
        )}
      </div>

      {sources.length > 0 && <Sources items={sources} />}

      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <Time value={bubble.time} />
        <span style={{ fontSize: 10.5, color: T.textMuted }}>{res.latency_ms}ms</span>
        {res.message_id !== null && <Feedback messageId={res.message_id} />}
      </div>
    </div>
  );
}

const KIND_LABEL: Record<AgentCitation["kind"], string> = {
  data: "조회",
  doc: "문서",
  model: "모델",
};

function Sources({ items }: { items: AgentCitation[] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={{ fontSize: 11, fontWeight: 700, color: T.textMuted }}>근거 {items.length}건</span>
      {items.map((c) => (
        <div
          key={c.ord}
          style={{
            padding: "8px 10px",
            borderRadius: 7,
            background: T.surfaceSubtle,
            border: `1px solid ${T.border}`,
            fontSize: 11.5,
            lineHeight: 1.6,
          }}
        >
          <div style={{ display: "flex", gap: 6, alignItems: "baseline", flexWrap: "wrap" }}>
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                padding: "1px 5px",
                borderRadius: 4,
                background: T.primaryLight,
                color: T.primary,
              }}
            >
              {KIND_LABEL[c.kind]}
            </span>
            <span style={{ fontWeight: 600, color: T.text }}>{c.label}</span>
            {/* 0 건도 근거다 — "조회했고 0건이었다" 는 사실이다 (§7.11.2) */}
            {c.count !== null && c.count !== undefined && (
              <span style={{ color: T.textMuted }}>{c.count}건</span>
            )}
            {c.score !== null && c.score !== undefined && (
              <span style={{ color: T.textMuted }}>유사도 {c.score}</span>
            )}
          </div>
          {c.snippet && (
            <div
              style={{
                marginTop: 5,
                color: T.textSub,
                whiteSpace: "pre-wrap",
                maxHeight: 96,
                overflow: "auto",
              }}
            >
              {c.snippet}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function Feedback({ messageId }: { messageId: number }) {
  const [sent, setSent] = useState<1 | -1 | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function vote(rating: 1 | -1) {
    if (sent !== null) return;
    try {
      await submitAgentFeedback(messageId, { rating });
      setSent(rating);
    } catch (e) {
      setError(resolveError(e).detail);
    }
  }

  if (error) return <span style={{ fontSize: 10.5, color: T.error }}>{error}</span>;
  if (sent !== null) {
    return <span style={{ fontSize: 10.5, color: T.textMuted }}>평가 완료 {sent === 1 ? "👍" : "👎"}</span>;
  }
  return (
    <span style={{ display: "inline-flex", gap: 4 }}>
      {([1, -1] as const).map((r) => (
        <button
          key={r}
          type="button"
          onClick={() => void vote(r)}
          aria-label={r === 1 ? "도움이 됨" : "도움이 안 됨"}
          style={{
            border: `1px solid ${T.border}`,
            background: T.surface,
            borderRadius: 5,
            fontSize: 11,
            lineHeight: 1,
            padding: "3px 5px",
            cursor: "pointer",
          }}
        >
          {r === 1 ? "👍" : "👎"}
        </button>
      ))}
    </span>
  );
}

function Time({ value }: { value: string }) {
  return <span style={{ fontSize: 10.5, color: T.textMuted }}>{value}</span>;
}

function Typing() {
  return (
    <div
      style={{
        alignSelf: "flex-start",
        padding: "10px 14px",
        borderRadius: "12px 12px 12px 3px",
        background: T.surfaceSubtle,
        border: `1px solid ${T.border}`,
        fontSize: 12.5,
        color: T.textMuted,
      }}
    >
      근거를 찾는 중…
    </div>
  );
}

// ── 우측 패널 ───────────────────────────────────────────────────────────
function Sidebar({
  health,
  examples,
  disabled,
  onPick,
}: {
  health: AgentHealth | null;
  examples: readonly string[];
  disabled: boolean;
  onPick: (q: string) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div className="card">
        <h3 style={{ fontSize: 12.5, fontWeight: 700, margin: "0 0 10px", color: T.text }}>예시 질문</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
          {examples.map((q) => (
            <button
              key={q}
              type="button"
              disabled={disabled}
              onClick={() => onPick(q)}
              style={{
                textAlign: "left",
                padding: "8px 10px",
                borderRadius: 7,
                border: `1px solid ${T.border}`,
                background: disabled ? T.surfaceSubtle : T.surface,
                color: disabled ? T.textMuted : T.textSub,
                fontSize: 12,
                lineHeight: 1.5,
                cursor: disabled ? "not-allowed" : "pointer",
              }}
            >
              {q}
            </button>
          ))}
        </div>
      </div>

      <div className="card">
        <h3 style={{ fontSize: 12.5, fontWeight: 700, margin: "0 0 10px", color: T.text }}>구성 상태</h3>
        <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "auto 1fr", gap: "6px 10px", fontSize: 11.5 }}>
          <Row k="제공자" v={health?.provider ?? "—"} />
          <Row k="모델" v={health?.model_id ?? "—"} />
          <Row k="문서 색인" v={health ? (health.index_ready ? `${health.chunk_count}청크` : "없음") : "—"} />
          {health && health.failed_sources > 0 && (
            <Row k="색인 실패" v={`${health.failed_sources}건`} danger />
          )}
        </dl>
        <p style={{ margin: "10px 0 0", fontSize: 11, color: T.textMuted, lineHeight: 1.6 }}>
          답변은 조회 결과와 등록된 문서에만 근거합니다. 근거가 없으면 답하지 않습니다.
        </p>
      </div>
    </div>
  );
}

function Row({ k, v, danger }: { k: string; v: string; danger?: boolean }) {
  return (
    <>
      <dt style={{ color: T.textMuted }}>{k}</dt>
      <dd style={{ margin: 0, color: danger ? T.error : T.textSub, wordBreak: "break-all" }}>{v}</dd>
    </>
  );
}
