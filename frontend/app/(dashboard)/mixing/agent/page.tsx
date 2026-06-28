"use client";

import { useState, useRef, useEffect } from "react";

interface Message {
  id: string;
  role: "ai" | "user";
  text: string;
  timestamp: string;
  cards?: AnalysisCard[];
}

interface AnalysisCard {
  title: string;
  rows: { label: string; value: string; highlight?: boolean }[];
}

const QUICK_QUESTIONS = [
  "오늘 SN 편차가 가장 큰 LOT는?",
  "SUP_A 이번 달 성분 품질은?",
  "현재 최적 배합비율 추천해줘",
  "불량률이 높은 공정 조건은?",
  "AG 편차 경고 LOT 목록 보여줘",
  "이번 주 이상치 감지 현황은?",
];

function now() {
  return new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
}

function uid() {
  return Math.random().toString(36).slice(2, 9);
}

// Mock AI response generator
function generateResponse(question: string): { text: string; cards?: AnalysisCard[] } {
  const q = question.toLowerCase();

  if (q.includes("sn") && q.includes("편차") && q.includes("큰")) {
    return {
      text: "오늘 SN 편차 분석 결과입니다. LOT-2026-0625가 목표값(62.0%) 대비 +3.2% 편차로 가장 높게 측정되었습니다. 공급사 SUP_A에서 입고된 원재료로 추정되며, 해당 LOT는 이상치로 분류되어 검토 중입니다.",
      cards: [
        {
          title: "SN 편차 상위 LOT (오늘)",
          rows: [
            { label: "LOT-2026-0625", value: "+3.2%", highlight: true },
            { label: "LOT-2026-0627", value: "+1.1%" },
            { label: "LOT-2026-0624", value: "+0.3%" },
            { label: "LOT-2026-0626", value: "-0.2%" },
          ],
        },
      ],
    };
  }

  if (q.includes("sup_a") && (q.includes("품질") || q.includes("성분"))) {
    return {
      text: "SUP_A 공급사 이번 달 성분 품질 분석 결과입니다. 전체적으로 양호한 편이나 SN 성분에서 평균 +0.4% 편차가 관찰됩니다. AG와 CU는 목표값 범위 내에서 안정적으로 유지되고 있습니다.",
      cards: [
        {
          title: "SUP_A 6월 성분 품질 요약",
          rows: [
            { label: "측정 건수", value: "18건" },
            { label: "SN 평균편차", value: "+0.42%", highlight: true },
            { label: "AG 평균편차", value: "-0.08%" },
            { label: "CU 평균편차", value: "+0.02%" },
            { label: "이상치 발생", value: "1건", highlight: true },
            { label: "합격률", value: "94.4%" },
          ],
        },
      ],
    };
  }

  if (q.includes("최적") && (q.includes("배합") || q.includes("추천"))) {
    return {
      text: "현재 공정 조건(용융온도 250°C, 교반시간 45분)을 기준으로 ML 모델이 최적 배합비율을 추천합니다. GradientBoosting 모델 기준 예상 품질점수 87.3점입니다.",
      cards: [
        {
          title: "추천 배합비율 (gradient_boosting)",
          rows: [
            { label: "SN (주석)", value: "61.85%" },
            { label: "AG (은)", value: "3.02%" },
            { label: "CU (구리)", value: "0.48%" },
            { label: "PB (납)", value: "34.65%" },
            { label: "예상 품질점수", value: "87.3점", highlight: true },
            { label: "등급", value: "B등급" },
          ],
        },
      ],
    };
  }

  if (q.includes("불량") || q.includes("공정 조건")) {
    return {
      text: "지난 30일 공정 데이터 분석 결과, 용융온도 270°C 이상 + 교반시간 30분 미만 조합에서 불량률이 평균 대비 2.3배 높게 나타납니다. 특히 SUP_C 원재료 사용 시 해당 조건에서 편차가 심화됩니다.",
      cards: [
        {
          title: "고위험 공정 조건",
          rows: [
            { label: "용융온도", value: "≥ 270°C", highlight: true },
            { label: "교반시간", value: "≤ 30분", highlight: true },
            { label: "관련 공급사", value: "SUP_C" },
            { label: "불량률 (해당 조건)", value: "8.2%", highlight: true },
            { label: "불량률 (전체 평균)", value: "3.6%" },
          ],
        },
      ],
    };
  }

  if (q.includes("ag") && q.includes("경고")) {
    return {
      text: "이번 달 AG 성분이 경고 기준(±5%)을 초과한 LOT는 총 1건입니다. LOT-2026-0609에서 -7.0% 편차(실측 2.79%)가 감지되었습니다.",
      cards: [
        {
          title: "AG 편차 경고 LOT",
          rows: [
            { label: "LOT-2026-0609", value: "2.79% (−7.0%)", highlight: true },
            { label: "측정일", value: "2026-06-09" },
            { label: "공급사", value: "SUP_B" },
            { label: "판정", value: "경고", highlight: true },
          ],
        },
      ],
    };
  }

  if (q.includes("이상치") && (q.includes("이번 주") || q.includes("주"))) {
    return {
      text: "이번 주(6/23~6/27) 이상치 감지 현황입니다. 총 42건 측정 중 1건이 이상치로 분류되었으며, 이상치 비율은 2.4%로 지난 주(3.1%) 대비 개선되었습니다.",
      cards: [
        {
          title: "이번 주 이상치 현황",
          rows: [
            { label: "총 측정건수", value: "42건" },
            { label: "이상치 건수", value: "1건" },
            { label: "이상치 비율", value: "2.4%" },
            { label: "전주 대비", value: "▼ 0.7%p", highlight: false },
            { label: "이상 LOT", value: "LOT-2026-0625", highlight: true },
          ],
        },
      ],
    };
  }

  return {
    text: `"${question}"에 대한 분석을 진행합니다. 현재 성분 데이터베이스에서 관련 패턴을 탐색 중입니다. 더 구체적인 조건(기간, 공급사, 성분 등)을 함께 입력하시면 더 정확한 분석 결과를 제공할 수 있습니다.`,
  };
}

function AIIcon() {
  return (
    <div
      style={{
        width: 34,
        height: 34,
        borderRadius: "50%",
        background: "linear-gradient(135deg, #3A5BD9 0%, #6B8AFF 100%)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <path d="M8 2a2 2 0 0 1 2 2v1h1a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h1V4a2 2 0 0 1 2-2z" fill="rgba(255,255,255,0.9)" />
        <circle cx="6" cy="8" r="0.8" fill="#3A5BD9" />
        <circle cx="10" cy="8" r="0.8" fill="#3A5BD9" />
      </svg>
    </div>
  );
}

function AnalysisCardView({ card }: { card: AnalysisCard }) {
  return (
    <div
      style={{
        background: "#F8F9FB",
        border: "1px solid #E4E7EC",
        borderRadius: 10,
        overflow: "hidden",
        marginTop: 10,
      }}
    >
      <div
        style={{
          padding: "8px 14px",
          background: "#EEF1FD",
          borderBottom: "1px solid #E4E7EC",
          fontSize: 11.5,
          fontWeight: 700,
          color: "#3A5BD9",
          letterSpacing: "0.02em",
        }}
      >
        {card.title}
      </div>
      <div style={{ padding: "10px 14px", display: "flex", flexDirection: "column", gap: 6 }}>
        {card.rows.map((row, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "3px 0",
              borderBottom: i < card.rows.length - 1 ? "1px solid #F2F4F7" : "none",
            }}
          >
            <span style={{ fontSize: 12, color: "#687182" }}>{row.label}</span>
            <span
              style={{
                fontSize: 12.5,
                fontWeight: 700,
                color: row.highlight ? "#DC2626" : "#161B26",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {row.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

const INITIAL_MESSAGES: Message[] = [
  {
    id: "init",
    role: "ai",
    text: "안녕하세요! 성분 분석 AI Agent입니다. 배합 성분, 편차 분석, 최적화 추천을 도와드립니다. 아래 추천 질문을 클릭하거나 직접 입력해 주세요.",
    timestamp: now(),
  },
];

export default function AgentPage() {
  const [messages, setMessages] = useState<Message[]>(INITIAL_MESSAGES);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, thinking]);

  function sendMessage(text: string) {
    if (!text.trim() || thinking) return;

    const userMsg: Message = { id: uid(), role: "user", text: text.trim(), timestamp: now() };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setThinking(true);

    // Simulate AI thinking delay
    const delay = 800 + Math.random() * 600;
    setTimeout(() => {
      const { text: aiText, cards } = generateResponse(text);
      const aiMsg: Message = {
        id: uid(),
        role: "ai",
        text: aiText,
        timestamp: now(),
        cards,
      };
      setMessages((prev) => [...prev, aiMsg]);
      setThinking(false);
    }, delay);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "calc(100vh - 120px)",
        minHeight: 600,
        gap: 0,
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 0 16px",
          flexShrink: 0,
        }}
      >
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: "#161B26", margin: 0, lineHeight: 1.3 }}>
            성분 AI Agent
          </h1>
          <p style={{ fontSize: 12.5, color: "#687182", margin: "4px 0 0" }}>
            성분 분석 · 편차 탐색 · 배합 최적화 AI 어시스턴트
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "4px 12px",
              borderRadius: 20,
              fontSize: 12,
              fontWeight: 600,
              color: "#15803D",
              background: "#ECFDF3",
            }}
          >
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: "#16A34A",
                boxShadow: "0 0 0 2px #BBF7D0",
                animation: "pulse 2s infinite",
              }}
            />
            온라인
          </span>
          <button
            className="btn"
            onClick={() => {
              setMessages(INITIAL_MESSAGES);
              setInput("");
              setThinking(false);
            }}
            style={{ fontSize: 12 }}
          >
            초기화
          </button>
        </div>
      </div>

      {/* Chat area */}
      <div
        className="card"
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          gap: 0,
          padding: 0,
          overflow: "hidden",
          minHeight: 0,
        }}
      >
        {/* Quick question chips */}
        <div
          style={{
            padding: "12px 16px",
            borderBottom: "1px solid #E4E7EC",
            background: "#F8F9FB",
            flexShrink: 0,
          }}
        >
          <div style={{ fontSize: 11, fontWeight: 600, color: "#9AA4B2", letterSpacing: "0.05em", textTransform: "uppercase", marginBottom: 8 }}>
            추천 질문
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {QUICK_QUESTIONS.map((q) => (
              <button
                key={q}
                onClick={() => {
                  setInput(q);
                  inputRef.current?.focus();
                }}
                style={{
                  padding: "5px 12px",
                  fontSize: 12,
                  fontWeight: 500,
                  color: "#3A5BD9",
                  background: "#EEF1FD",
                  border: "1px solid #C7D2FD",
                  borderRadius: 20,
                  cursor: "pointer",
                  transition: "all 0.12s",
                  whiteSpace: "nowrap",
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.background = "#3A5BD9";
                  (e.currentTarget as HTMLButtonElement).style.color = "#fff";
                  (e.currentTarget as HTMLButtonElement).style.borderColor = "#3A5BD9";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.background = "#EEF1FD";
                  (e.currentTarget as HTMLButtonElement).style.color = "#3A5BD9";
                  (e.currentTarget as HTMLButtonElement).style.borderColor = "#C7D2FD";
                }}
              >
                {q}
              </button>
            ))}
          </div>
        </div>

        {/* Messages scroll area */}
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "20px 20px 12px",
            display: "flex",
            flexDirection: "column",
            gap: 16,
          }}
        >
          {messages.map((msg) => (
            <div
              key={msg.id}
              style={{
                display: "flex",
                flexDirection: msg.role === "user" ? "row-reverse" : "row",
                gap: 10,
                alignItems: "flex-start",
              }}
            >
              {msg.role === "ai" && <AIIcon />}

              <div
                style={{
                  maxWidth: "72%",
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                  alignItems: msg.role === "user" ? "flex-end" : "flex-start",
                }}
              >
                <div
                  style={{
                    padding: "10px 14px",
                    borderRadius: msg.role === "user" ? "16px 4px 16px 16px" : "4px 16px 16px 16px",
                    background: msg.role === "user" ? "#F2F4F7" : "#fff",
                    border: msg.role === "user" ? "none" : "1px solid #E4E7EC",
                    fontSize: 13.5,
                    lineHeight: 1.6,
                    color: "#161B26",
                    boxShadow: msg.role === "ai" ? "0 1px 3px rgba(16,24,40,0.05)" : "none",
                  }}
                >
                  {msg.text}
                </div>

                {msg.cards?.map((card, i) => (
                  <div key={i} style={{ width: "100%" }}>
                    <AnalysisCardView card={card} />
                  </div>
                ))}

                <span style={{ fontSize: 10.5, color: "#C2C9D6", marginTop: 2 }}>
                  {msg.timestamp}
                </span>
              </div>

              {msg.role === "user" && (
                <div
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: "50%",
                    background: "#E4E7EC",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                    fontSize: 14,
                    fontWeight: 700,
                    color: "#687182",
                  }}
                >
                  나
                </div>
              )}
            </div>
          ))}

          {/* Thinking indicator */}
          {thinking && (
            <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
              <AIIcon />
              <div
                style={{
                  padding: "12px 16px",
                  borderRadius: "4px 16px 16px 16px",
                  background: "#fff",
                  border: "1px solid #E4E7EC",
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
                      background: "#3A5BD9",
                      opacity: 0.4,
                      animation: `dotBounce 1.2s ${i * 0.2}s infinite`,
                    }}
                  />
                ))}
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* Input area */}
        <div
          style={{
            padding: "12px 16px",
            borderTop: "1px solid #E4E7EC",
            background: "#fff",
            flexShrink: 0,
          }}
        >
          <div
            style={{
              display: "flex",
              gap: 10,
              alignItems: "center",
              background: "#F8F9FB",
              border: "1px solid #E4E7EC",
              borderRadius: 12,
              padding: "8px 12px",
              transition: "border-color 0.15s",
            }}
            onFocusCapture={(e) => {
              (e.currentTarget as HTMLDivElement).style.borderColor = "#3A5BD9";
            }}
            onBlurCapture={(e) => {
              (e.currentTarget as HTMLDivElement).style.borderColor = "#E4E7EC";
            }}
          >
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="성분 분석, 편차 조회, 배합 추천 등 질문해 주세요..."
              style={{
                flex: 1,
                border: "none",
                outline: "none",
                background: "transparent",
                fontSize: 13.5,
                color: "#161B26",
                lineHeight: 1.5,
              }}
            />
            <button
              onClick={() => sendMessage(input)}
              disabled={!input.trim() || thinking}
              style={{
                width: 36,
                height: 36,
                borderRadius: 9,
                border: "none",
                background: input.trim() && !thinking ? "#3A5BD9" : "#E4E7EC",
                cursor: input.trim() && !thinking ? "pointer" : "not-allowed",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                transition: "background 0.15s",
              }}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path
                  d="M14 8L2 2l2.5 6L2 14l12-6z"
                  fill={input.trim() && !thinking ? "#fff" : "#9AA4B2"}
                />
              </svg>
            </button>
          </div>
          <div style={{ fontSize: 11, color: "#C2C9D6", marginTop: 6, textAlign: "center" }}>
            Enter 키로 전송 · AI 응답은 ML 모델 기반 분석 결과입니다
          </div>
        </div>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { box-shadow: 0 0 0 2px #BBF7D0; }
          50% { box-shadow: 0 0 0 4px #86EFAC; }
        }
        @keyframes dotBounce {
          0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
          30% { transform: translateY(-5px); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
