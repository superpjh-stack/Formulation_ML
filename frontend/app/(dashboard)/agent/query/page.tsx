"use client";

import { useState, useRef, useEffect } from "react";

interface Message {
  id: number;
  role: "user" | "assistant";
  text: string;
  time: string;
  tags?: string[];
}

const QUICK_CHIPS = [
  "오늘 이상 LOT는?",
  "불량률 예측해줘",
  "이번 주 출하 요약",
  "배합 최적화 추천",
  "클레임 급증 원인 분석",
  "설비 이상 현황",
  "공급사별 성분 품질 비교",
];

const MOCK_RESPONSES: Record<string, { text: string; tags: string[] }> = {
  "오늘 이상 LOT는?": {
    text: "오늘(2026-06-27) 이상 LOT 현황입니다.\n\n**⚠️ 주의 LOT (1건)**\n• LOT-2026-0623 (Sn60Pb40, 현대모비스)\n  — Pb 함량 40.9% (규격 40±0.5% 초과)\n  — 현재 검사 중 / 재검사 예정\n\n**정상 범위 LOT:** 출하 완료 8건 모두 합격\n\n**권장 조치:** LOT-2026-0623 배합 공정 계량 센서 점검",
    tags: ["LOT", "품질"],
  },
  "불량률 예측해줘": {
    text: "현재 데이터 기반 불량률 예측 결과입니다.\n\n**이번 주 예측 불량률: 2.3%** (목표: <3.0%)\n\n| 기간 | 예측값 | 신뢰구간 |\n|------|--------|----------|\n| 오늘 | 1.8% | ±0.4% |\n| 내일 | 2.1% | ±0.5% |\n| 이번 주 | 2.3% | ±0.7% |\n\n**주요 리스크:** SUP_B 공급 Pb 순도 편차가 최근 증가 추세입니다. 입고 검사 강화를 권장합니다.",
    tags: ["예측", "품질"],
  },
  "배합 최적화 추천": {
    text: "현재 조건 기반 배합 최적화 추천입니다.\n\n**추천 배합비 (Sn63Pb37 기준)**\n• Sn: 63.0% → **62.95%** (−0.05%)\n• Pb: 37.0% → **37.05%** (+0.05%)\n\n**예측 품질점수:** 87.3점 (현재 대비 +2.1점)\n\n**근거:**\n— 오늘 SUP_A Sn 입고 순도 99.91% (목표 99.9%)\n— 최근 7일 Sn 편차 평균 −0.03% 반영\n— scipy SLSQP 최적화 (1,000회 반복)",
    tags: ["배합", "최적화"],
  },
};

function getTime() {
  return new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
}

const HISTORY_SESSIONS = [
  { id: 1, preview: "오늘 이상 LOT는?", time: "09:32", date: "오늘" },
  { id: 2, preview: "배합 최적화 추천해줘", time: "08:15", date: "오늘" },
  { id: 3, preview: "이번 달 클레임 분석", time: "16:40", date: "어제" },
  { id: 4, preview: "공급사 품질 비교", time: "11:22", date: "어제" },
  { id: 5, preview: "설비 예방정비 일정", time: "09:10", date: "6/25" },
];

export default function AgentQueryPage() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 0,
      role: "assistant",
      text: "안녕하세요! 고려솔더 통합 AI Agent입니다.\n\n전체 시스템 데이터(배합·품질·출하·공정·설비)를 참조하여 분석, 예측, 추천을 제공합니다. 무엇이든 질문하세요.",
      time: getTime(),
      tags: [],
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
    setMessages((p) => [...p, { id: Date.now(), role: "user", text: text.trim(), time: getTime() }]);
    setInput("");
    setLoading(true);
    setTimeout(() => {
      const r = MOCK_RESPONSES[text.trim()] ?? {
        text: `'${text.trim()}' 에 대해 전체 데이터베이스를 분석 중입니다.\n\n분석 범위: 배합이력 DB, 품질검사 DB, 출하관리 DB, 공정조건 DB, 설비이력 DB\n\n복합 분석 완료 후 결과를 드리겠습니다. 현재 데이터 기준으로 특이사항은 없습니다.`,
        tags: ["분석"],
      };
      setMessages((p) => [...p, { id: Date.now() + 1, role: "assistant", text: r.text, time: getTime(), tags: r.tags }]);
      setLoading(false);
    }, 1100);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, height: "calc(100vh - 108px)" }}>
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: "#161B26", margin: 0 }}>통합 AI 질의</h1>
        <p style={{ fontSize: 12.5, color: "#687182", margin: "4px 0 0" }}>
          전체 시스템 데이터 기반 AI 분석·예측·추천
        </p>
      </div>

      <div style={{ display: "flex", gap: 20, flex: 1, minHeight: 0 }}>
        {/* History sidebar */}
        <div style={{ width: 200, display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="card" style={{ padding: "12px 14px", flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#161B26", marginBottom: 10 }}>대화 히스토리</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {HISTORY_SESSIONS.map((s, i) => (
                <div key={s.id} style={{
                  padding: "8px 10px", borderRadius: 7, cursor: "pointer",
                  background: i === 0 ? "#EEF1FD" : "transparent",
                  transition: "background 0.1s",
                }}>
                  <div style={{ fontSize: 12, color: i === 0 ? "#3A5BD9" : "#161B26", fontWeight: i === 0 ? 600 : 400, lineHeight: 1.3, marginBottom: 3 }}>
                    {s.preview}
                  </div>
                  <div style={{ fontSize: 10.5, color: "#9AA4B2" }}>{s.date} {s.time}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Chat */}
        <div className="card" style={{ flex: 1, display: "flex", flexDirection: "column", padding: 0, overflow: "hidden" }}>
          {/* Data source bar */}
          <div style={{ padding: "8px 16px", borderBottom: "1px solid #F2F4F7", background: "#F8F9FB", display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ fontSize: 11.5, fontWeight: 600, color: "#687182" }}>연결된 데이터:</span>
            {["배합이력", "품질검사", "출하관리", "공정조건", "설비이력"].map((d) => (
              <span key={d} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 600, color: "#15803D" }}>
                <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#16A34A", display: "inline-block" }} />
                {d}
              </span>
            ))}
          </div>

          {/* Messages */}
          <div style={{ flex: 1, overflowY: "auto", padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
            {messages.map((m) => (
              <div key={m.id} style={{ display: "flex", flexDirection: m.role === "user" ? "row-reverse" : "row", gap: 10, alignItems: "flex-start" }}>
                <div style={{
                  width: 32, height: 32, borderRadius: "50%", flexShrink: 0,
                  background: m.role === "assistant" ? "linear-gradient(135deg,#3A5BD9,#6B8AFF)" : "#E4E7EC",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 11, fontWeight: 700, color: m.role === "assistant" ? "#fff" : "#687182",
                }}>
                  {m.role === "assistant" ? "AI" : "나"}
                </div>
                <div style={{ maxWidth: "75%", display: "flex", flexDirection: "column", gap: 4, alignItems: m.role === "user" ? "flex-end" : "flex-start" }}>
                  <div style={{
                    padding: "10px 14px", borderRadius: m.role === "user" ? "12px 4px 12px 12px" : "4px 12px 12px 12px",
                    background: m.role === "user" ? "#3A5BD9" : "#F8F9FB",
                    fontSize: 13, lineHeight: 1.65, color: m.role === "user" ? "#fff" : "#161B26",
                    whiteSpace: "pre-wrap",
                  }}>
                    {m.text}
                  </div>
                  {m.tags && m.tags.length > 0 && (
                    <div style={{ display: "flex", gap: 4 }}>
                      {m.tags.map((tag) => (
                        <span key={tag} style={{ padding: "1px 7px", borderRadius: 20, fontSize: 10.5, fontWeight: 600, background: "#EEF1FD", color: "#3A5BD9" }}>{tag}</span>
                      ))}
                    </div>
                  )}
                  <span style={{ fontSize: 10.5, color: "#9AA4B2" }}>{m.time}</span>
                </div>
              </div>
            ))}
            {loading && (
              <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                <div style={{ width: 32, height: 32, borderRadius: "50%", background: "linear-gradient(135deg,#3A5BD9,#6B8AFF)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: "#fff", flexShrink: 0 }}>AI</div>
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
          <div style={{ padding: "10px 16px", borderTop: "1px solid #F2F4F7", display: "flex", gap: 6, flexWrap: "wrap" }}>
            {QUICK_CHIPS.map((chip) => (
              <button key={chip} onClick={() => send(chip)} style={{ padding: "4px 11px", fontSize: 11.5, fontWeight: 500, borderRadius: 20, border: "1px solid #E4E7EC", background: "#fff", color: "#3A5BD9", cursor: "pointer", whiteSpace: "nowrap" }}>
                {chip}
              </button>
            ))}
          </div>

          {/* Input */}
          <div style={{ padding: "12px 16px", borderTop: "1px solid #E4E7EC", display: "flex", gap: 10 }}>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }}
              placeholder="전체 시스템 데이터를 기반으로 질문하세요..."
              style={{ flex: 1, height: 40, padding: "0 14px", border: "1px solid #E4E7EC", borderRadius: 8, fontSize: 13, color: "#161B26", background: "#F8F9FB", outline: "none", fontFamily: "inherit" }}
            />
            <button onClick={() => send(input)} disabled={!input.trim() || loading}
              style={{ width: 40, height: 40, borderRadius: 8, border: "none", background: input.trim() && !loading ? "#3A5BD9" : "#E4E7EC", color: "#fff", cursor: input.trim() && !loading ? "pointer" : "not-allowed", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M14 8L2 2l2 6-2 6 12-6z" fill={input.trim() && !loading ? "#fff" : "#9AA4B2"} /></svg>
            </button>
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
