"use client";

import { useState, useRef, useEffect } from "react";

interface Message {
  id: number;
  role: "user" | "assistant";
  text: string;
  time: string;
}

const QUICK_CHIPS = [
  "오늘 출하 현황 요약해줘",
  "LOT-2026-0623 불합격 원인 분석",
  "이번 달 클레임 패턴 알려줘",
  "성분불량 재발 방지 방안 제안",
  "출하 대기 건 우선순위 알려줘",
];

const MOCK_RESPONSES: Record<string, string> = {
  "오늘 출하 현황 요약해줘":
    "오늘(2026-06-27) 출하 현황 요약입니다.\n\n• 총 출하 예정: **15건**\n• 완료: **8건** (53.3%)\n• 진행중: **4건**\n• 대기/승인대기: **3건**\n\n⚠️ SH-013 (LS산전, 700 kg)이 승인 보류 중입니다. 검사 결과 확인 후 승인 처리를 권장합니다.",
  "LOT-2026-0623 불합격 원인 분석":
    "LOT-2026-0623 (Sn60Pb40, 현대모비스) 불합격 분석 결과입니다.\n\n**불합격 항목:** 성분 검사\n**원인:** Pb 함량이 규격(40±0.5%)을 초과한 40.9%로 측정되었습니다.\n\n**추정 원인:**\n1. 원자재 입고 시 Pb 순도 편차 (LOT 입고 데이터 참조)\n2. 배합 공정 계량 오차 (+0.9 kg 과투입 추정)\n\n**권장 조치:** 배합 공정 계량 센서 재보정 및 SUP_B 원자재 성분 재검증",
  "이번 달 클레임 패턴 알려줘":
    "2026년 6월 클레임 분석 결과입니다.\n\n**총 10건 접수** (전월 대비 +2건)\n\n| 유형 | 건수 | 비율 |\n|------|------|------|\n| 성분불량 | 4 | 40% |\n| 외관불량 | 2 | 20% |\n| 중량불량 | 2 | 20% |\n| 기타 | 2 | 20% |\n\n**패턴 분석:** 성분불량이 40%를 차지하며, 주요 원인은 Sn/Pb 함량 편차입니다. 배합 최적화 AI 정확도 향상이 필요합니다.",
};

function getTime() {
  return new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
}

export default function ShippingAgentPage() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 0,
      role: "assistant",
      text: "안녕하세요! 출하 AI Agent입니다. 출하 현황, LOT 추적, 클레임 분석 등 포장출하 관련 질문에 답변해 드립니다.",
      time: getTime(),
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
    const userMsg: Message = { id: Date.now(), role: "user", text: text.trim(), time: getTime() };
    setMessages((p) => [...p, userMsg]);
    setInput("");
    setLoading(true);

    setTimeout(() => {
      const reply =
        MOCK_RESPONSES[text.trim()] ??
        `'${text.trim()}' 에 대한 출하 데이터를 분석 중입니다. 잠시 후 결과를 제공해 드리겠습니다.\n\n현재 연결된 데이터소스: 출하관리 DB, 검사이력 DB, 클레임 DB`;
      setMessages((p) => [...p, { id: Date.now() + 1, role: "assistant", text: reply, time: getTime() }]);
      setLoading(false);
    }, 900);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, height: "calc(100vh - 108px)" }}>
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: "#161B26", margin: 0 }}>출하 AI Agent</h1>
        <p style={{ fontSize: 12.5, color: "#687182", margin: "4px 0 0" }}>
          출하·LOT·클레임 데이터 기반 AI 분석 및 답변
        </p>
      </div>

      <div style={{ display: "flex", gap: 20, flex: 1, minHeight: 0 }}>
        {/* Chat area */}
        <div className="card" style={{ flex: 1, display: "flex", flexDirection: "column", padding: 0, overflow: "hidden" }}>
          {/* Messages */}
          <div style={{ flex: 1, overflowY: "auto", padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
            {messages.map((m) => (
              <div key={m.id} style={{ display: "flex", flexDirection: m.role === "user" ? "row-reverse" : "row", gap: 10, alignItems: "flex-start" }}>
                {/* Avatar */}
                <div style={{
                  width: 32, height: 32, borderRadius: "50%", flexShrink: 0,
                  background: m.role === "assistant" ? "linear-gradient(135deg,#3A5BD9,#6B8AFF)" : "#E4E7EC",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 13, fontWeight: 700, color: m.role === "assistant" ? "#fff" : "#687182",
                }}>
                  {m.role === "assistant" ? "AI" : "나"}
                </div>
                <div style={{ maxWidth: "72%", display: "flex", flexDirection: "column", gap: 4, alignItems: m.role === "user" ? "flex-end" : "flex-start" }}>
                  <div style={{
                    padding: "10px 14px", borderRadius: m.role === "user" ? "12px 4px 12px 12px" : "4px 12px 12px 12px",
                    background: m.role === "user" ? "#3A5BD9" : "#F8F9FB",
                    fontSize: 13, lineHeight: 1.6,
                    color: m.role === "user" ? "#fff" : "#161B26",
                    whiteSpace: "pre-wrap",
                  }}>
                    {m.text}
                  </div>
                  <span style={{ fontSize: 10.5, color: "#9AA4B2" }}>{m.time}</span>
                </div>
              </div>
            ))}

            {loading && (
              <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                <div style={{ width: 32, height: 32, borderRadius: "50%", background: "linear-gradient(135deg,#3A5BD9,#6B8AFF)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, color: "#fff", flexShrink: 0 }}>AI</div>
                <div style={{ padding: "12px 16px", borderRadius: "4px 12px 12px 12px", background: "#F8F9FB", display: "flex", gap: 5, alignItems: "center" }}>
                  {[0, 1, 2].map((i) => (
                    <span key={i} style={{ width: 6, height: 6, borderRadius: "50%", background: "#3A5BD9", animation: `bounce 1s ${i * 0.2}s ease-in-out infinite` }} />
                  ))}
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Quick chips */}
          <div style={{ padding: "10px 20px", borderTop: "1px solid #F2F4F7", display: "flex", gap: 6, flexWrap: "wrap" }}>
            {QUICK_CHIPS.map((chip) => (
              <button
                key={chip}
                onClick={() => send(chip)}
                style={{
                  padding: "4px 11px", fontSize: 11.5, fontWeight: 500,
                  borderRadius: 20, border: "1px solid #E4E7EC", background: "#fff",
                  color: "#3A5BD9", cursor: "pointer", whiteSpace: "nowrap",
                }}
              >
                {chip}
              </button>
            ))}
          </div>

          {/* Input */}
          <div style={{ padding: "12px 20px", borderTop: "1px solid #E4E7EC", display: "flex", gap: 10 }}>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }}
              placeholder="출하 관련 질문을 입력하세요..."
              style={{
                flex: 1, height: 40, padding: "0 14px", border: "1px solid #E4E7EC",
                borderRadius: 8, fontSize: 13, color: "#161B26", background: "#F8F9FB",
                outline: "none", fontFamily: "inherit",
              }}
            />
            <button
              onClick={() => send(input)}
              disabled={!input.trim() || loading}
              style={{
                width: 40, height: 40, borderRadius: 8, border: "none",
                background: input.trim() && !loading ? "#3A5BD9" : "#E4E7EC",
                color: "#fff", cursor: input.trim() && !loading ? "pointer" : "not-allowed",
                display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
              }}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M14 8L2 2l2 6-2 6 12-6z" fill={input.trim() && !loading ? "#fff" : "#9AA4B2"} />
              </svg>
            </button>
          </div>
        </div>

        {/* Side info */}
        <div style={{ width: 220, display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="card" style={{ padding: "14px 16px" }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#161B26", marginBottom: 10 }}>연결 데이터소스</div>
            {[
              { label: "출하관리 DB",  status: "연결됨", color: "#16A34A" },
              { label: "검사이력 DB",  status: "연결됨", color: "#16A34A" },
              { label: "클레임 DB",    status: "연결됨", color: "#16A34A" },
              { label: "LOT 추적 DB",  status: "연결됨", color: "#16A34A" },
            ].map((d) => (
              <div key={d.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 7 }}>
                <span style={{ fontSize: 12, color: "#687182" }}>{d.label}</span>
                <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 600, color: d.color }}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: d.color, display: "inline-block" }} />
                  {d.status}
                </span>
              </div>
            ))}
          </div>
          <div className="card" style={{ padding: "14px 16px" }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#161B26", marginBottom: 10 }}>오늘 주요 알림</div>
            {[
              { text: "승인 대기 1건", color: "#F59E0B" },
              { text: "불합격 LOT 1건", color: "#DC2626" },
              { text: "클레임 분석중 2건", color: "#3A5BD9" },
            ].map((a, i) => (
              <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start", marginBottom: 8 }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: a.color, flexShrink: 0, marginTop: 4 }} />
                <span style={{ fontSize: 12, color: "#161B26", lineHeight: 1.4 }}>{a.text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <style>{`
        @keyframes bounce {
          0%, 80%, 100% { transform: translateY(0); }
          40% { transform: translateY(-6px); }
        }
      `}</style>
    </div>
  );
}
