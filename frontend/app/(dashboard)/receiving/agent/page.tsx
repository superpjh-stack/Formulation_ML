"use client";

import { useState, useRef, useEffect } from "react";

// ─── Mock Data ────────────────────────────────────────────────────────────────

interface Message {
  id: string;
  role: "user" | "agent";
  content: string;
  timestamp: string;
}

const EXAMPLE_QUESTIONS = [
  "SUP_A의 이번 달 품질 어때?",
  "최근 불합격 원자재 추이 알려줘",
  "SUP_D 공급사 등급이 낮은 이유는?",
  "AG 성분 편차가 가장 큰 공급사는?",
  "이번 주 입고 예정 요약해줘",
];

const MOCK_RESPONSES: Record<string, string> = {
  "SUP_A의 이번 달 품질 어때?":
    "SUP_A (한국금속)의 이번 달 품질 분석 결과입니다.\n\n• 총 입고 LOT: 18건\n• 합격: 18건 (합격률 100%)\n• 평균 SN 편차: ±0.07 (목표 62.0 대비)\n• 평균 AG 편차: ±0.03 (목표 3.0 대비)\n• 평균 CU 편차: ±0.01 (목표 0.5 대비)\n\n전월 대비 성분 편차가 12% 감소했습니다. A등급 유지 중이며 클레임 이력 없음. 안정적인 공급사로 평가됩니다.",
  "최근 불합격 원자재 추이 알려줘":
    "최근 30일 불합격 원자재 현황입니다.\n\n• 총 불합격: 15건 / 370건 (불합격률 4.1%)\n• SUP_D: 10건 (주로 AG 성분 초과 편차)\n• SUP_C: 7건 (SN 편차 기준 초과)\n• SUP_B: 5건 (혼입 이물질)\n\n⚠️ SUP_D의 불합격률이 18.5%로 경고 수준입니다. 공급사 교체 또는 강화 검수 조치를 권고드립니다.",
  "SUP_D 공급사 등급이 낮은 이유는?":
    "SUP_D (글로벌메탈)의 D등급 원인 분석입니다.\n\n1. 합격률 81.5% — 기준(88%) 미달\n2. AG 성분 편차 평균 ±0.18 (허용범위 ±0.15 초과)\n3. 최근 3개월 클레임 7건 (기준 5건 초과)\n4. 납기 지연 2회\n\n권고사항: 공급계약 재검토 및 대체 공급사 발굴을 검토하세요.",
  "AG 성분 편차가 가장 큰 공급사는?":
    "AG 성분 편차 공급사 순위입니다.\n\n1위 SUP_D: ±0.18 (허용 초과)\n2위 SUP_C: ±0.09\n3위 SUP_B: ±0.07\n4위 SUP_A: ±0.04 (최우수)\n\nSUP_D의 편차가 허용범위(±0.15)를 초과하고 있어 즉각적인 개선 요청이 필요합니다.",
  "이번 주 입고 예정 요약해줘":
    "2026년 6월 27일(이번 주) 입고 예정 요약입니다.\n\n• 총 8건 예정\n• SUP_A: 3건 (Sn 500kg, Ag 50kg, Pb 150kg)\n• SUP_B: 2건 (Pb 300kg, Sn 400kg)\n• SUP_C: 2건 (Cu 200kg, Sn 600kg)\n• SUP_D: 1건 (Ag 30kg)\n\n현재 검사완료 6건, 대기 2건 (SUP_A Pb, SUP_C Sn). 불합격 0건으로 양호한 상황입니다.",
};

function getResponse(question: string): string {
  const key = Object.keys(MOCK_RESPONSES).find((k) =>
    question.includes(k.slice(0, 6))
  );
  return (
    key
      ? MOCK_RESPONSES[key]
      : "입고 데이터를 분석 중입니다. 현재 데이터 기준으로 특이사항은 발견되지 않았습니다. 더 구체적인 질문을 해주시면 정확한 분석을 제공할 수 있습니다."
  );
}

function formatTime(): string {
  return new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ReceivingAgentPage() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "init",
      role: "agent",
      content:
        "안녕하세요! 입고관리 AI Agent입니다.\n공급사 품질, 입고 현황, 성분 편차 분석 등을 질의해 주세요.",
      timestamp: "09:00",
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function send(text: string) {
    if (!text.trim() || loading) return;
    const userMsg: Message = {
      id: `u-${Date.now()}`,
      role: "user",
      content: text.trim(),
      timestamp: formatTime(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);
    setTimeout(() => {
      const agentMsg: Message = {
        id: `a-${Date.now()}`,
        role: "agent",
        content: getResponse(text),
        timestamp: formatTime(),
      };
      setMessages((prev) => [...prev, agentMsg]);
      setLoading(false);
    }, 900);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, height: "calc(100vh - 120px)" }}>
      {/* Header */}
      <div style={{ flexShrink: 0 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: "#161B26", margin: 0 }}>입고 AI Agent</h1>
        <p style={{ fontSize: 12.5, color: "#687182", margin: "4px 0 0" }}>공급사 품질·입고 현황 자연어 질의응답</p>
      </div>

      <div style={{ display: "flex", gap: 16, flex: 1, minHeight: 0 }}>
        {/* Chat panel */}
        <div className="card" style={{ flex: 1, display: "flex", flexDirection: "column", padding: 0, overflow: "hidden" }}>
          {/* Agent header */}
          <div style={{ padding: "12px 16px", borderBottom: "1px solid #E4E7EC", display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 34, height: 34, borderRadius: "50%", background: "linear-gradient(135deg, #3A5BD9, #6B8AFF)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M8 2a3 3 0 100 6 3 3 0 000-6zM3 13c0-2.21 2.239-4 5-4s5 1.79 5 4" stroke="#fff" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#161B26" }}>입고관리 AI Agent</div>
              <div style={{ fontSize: 11, color: "#16A34A", display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#16A34A", display: "inline-block" }} />
                온라인
              </div>
            </div>
          </div>

          {/* Messages */}
          <div style={{ flex: 1, overflowY: "auto", padding: "16px", display: "flex", flexDirection: "column", gap: 12 }}>
            {messages.map((m) => (
              <div
                key={m.id}
                style={{
                  display: "flex",
                  flexDirection: m.role === "user" ? "row-reverse" : "row",
                  gap: 8,
                  alignItems: "flex-end",
                }}
              >
                {m.role === "agent" && (
                  <div style={{ width: 28, height: 28, borderRadius: "50%", background: "linear-gradient(135deg, #3A5BD9, #6B8AFF)", flexShrink: 0 }} />
                )}
                <div style={{ maxWidth: "72%" }}>
                  <div
                    style={{
                      padding: "10px 14px",
                      borderRadius: m.role === "user" ? "12px 12px 2px 12px" : "12px 12px 12px 2px",
                      background: m.role === "user" ? "#3A5BD9" : "#F8F9FB",
                      color: m.role === "user" ? "#fff" : "#161B26",
                      fontSize: 13,
                      lineHeight: 1.6,
                      whiteSpace: "pre-wrap",
                      border: m.role === "agent" ? "1px solid #E4E7EC" : "none",
                    }}
                  >
                    {m.content}
                  </div>
                  <div style={{ fontSize: 10.5, color: "#9AA4B2", marginTop: 3, textAlign: m.role === "user" ? "right" : "left" }}>
                    {m.timestamp}
                  </div>
                </div>
              </div>
            ))}
            {loading && (
              <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
                <div style={{ width: 28, height: 28, borderRadius: "50%", background: "linear-gradient(135deg, #3A5BD9, #6B8AFF)", flexShrink: 0 }} />
                <div style={{ padding: "10px 14px", borderRadius: "12px 12px 12px 2px", background: "#F8F9FB", border: "1px solid #E4E7EC", display: "flex", gap: 4, alignItems: "center" }}>
                  {[0, 1, 2].map((i) => (
                    <span key={i} style={{ width: 6, height: 6, borderRadius: "50%", background: "#9AA4B2", display: "inline-block", animation: `bounce 1s ease-in-out ${i * 0.15}s infinite` }} />
                  ))}
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div style={{ padding: "12px 16px", borderTop: "1px solid #E4E7EC", display: "flex", gap: 8 }}>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }}
              placeholder="질문을 입력하세요... (Enter로 전송)"
              style={{
                flex: 1, padding: "9px 12px", fontSize: 13, border: "1px solid #E4E7EC",
                borderRadius: 8, outline: "none", color: "#161B26", background: "#fff",
              }}
            />
            <button
              onClick={() => send(input)}
              disabled={!input.trim() || loading}
              style={{
                padding: "9px 16px", fontSize: 13, fontWeight: 600, borderRadius: 8,
                border: "none", background: !input.trim() || loading ? "#E4E7EC" : "#3A5BD9",
                color: !input.trim() || loading ? "#9AA4B2" : "#fff", cursor: !input.trim() || loading ? "default" : "pointer",
                transition: "all 0.12s",
              }}
            >
              전송
            </button>
          </div>
        </div>

        {/* Example questions sidebar */}
        <div style={{ width: 220, flexShrink: 0, display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="card">
            <div style={{ fontSize: 12, fontWeight: 700, color: "#161B26", marginBottom: 10 }}>예시 질문</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {EXAMPLE_QUESTIONS.map((q) => (
                <button
                  key={q}
                  onClick={() => send(q)}
                  style={{
                    textAlign: "left", padding: "7px 10px", fontSize: 12, color: "#1D4ED8",
                    background: "#EEF1FD", border: "1px solid #C7D2F8", borderRadius: 7,
                    cursor: "pointer", lineHeight: 1.4, transition: "background 0.1s",
                  }}
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
          <div className="card">
            <div style={{ fontSize: 12, fontWeight: 700, color: "#161B26", marginBottom: 8 }}>데이터 범위</div>
            <div style={{ fontSize: 11.5, color: "#687182", lineHeight: 1.7 }}>
              • 입고 이력: 최근 90일<br />
              • 공급사: 4개사<br />
              • 원자재: Sn / Pb / Ag / Cu<br />
              • 마지막 갱신: 14:22
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes bounce {
          0%, 80%, 100% { transform: translateY(0); }
          40% { transform: translateY(-5px); }
        }
      `}</style>
    </div>
  );
}
