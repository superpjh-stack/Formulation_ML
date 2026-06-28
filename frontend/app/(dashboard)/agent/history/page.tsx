"use client";

import { useState } from "react";

// ─── Mock Data ────────────────────────────────────────────────────────────────

type AgentKind = "배합 최적화" | "품질 예측" | "이상 탐지" | "통합 분석" | "공정 추천";
type QStatus   = "완료" | "처리중" | "오류";

interface QueryRecord {
  id: string;
  question: string;
  user: string;
  datetime: string;
  agent: AgentKind;
  responseMs: number;
  status: QStatus;
  answer: string;
}

const MOCK_QUERIES: QueryRecord[] = [
  {
    id: "Q-001", datetime: "2026-06-27 14:22", user: "김민준",
    question: "오늘 생산된 LOT 중 품질 점수 85 미만인 항목은?",
    agent: "품질 예측", responseMs: 843, status: "완료",
    answer: "오늘(06/27) 생산 LOT 중 품질 점수 85 미만은 3건입니다.\n• LOT-2026-0627-003: 82.1점 (CU 편차 +0.09%)\n• LOT-2026-0627-007: 83.4점 (SN 편차 −0.31%)\n• LOT-2026-0627-011: 84.8점 (용융온도 편차 ±4°C)\n\n세 LOT 모두 2차 검사 대기 중입니다.",
  },
  {
    id: "Q-002", datetime: "2026-06-27 13:55", user: "이서연",
    question: "이번 주 SUP_B 원자재 SN 편차 트렌드 분석해줘",
    agent: "통합 분석", responseMs: 1204, status: "완료",
    answer: "SUP_B SN 편차 분석 결과 (06/21~06/27):\n\n평균 편차: ±0.42% (전주 ±0.20% 대비 2.1배 증가)\n최대 편차: +0.81% (06/25 LOT-B-260004)\n기준 초과 건수: 7건 / 전체 23건 (30.4%)\n\n→ SUP_B 입고 기준 강화 권장",
  },
  {
    id: "Q-003", datetime: "2026-06-27 11:30", user: "박지훈",
    question: "배합비율 Sn 62.5%, Ag 3.1% 일 때 예측 품질점수는?",
    agent: "배합 최적화", responseMs: 432, status: "완료",
    answer: "입력 배합: Sn 62.5%, Ag 3.1%, Cu 0.5%(기본값)\n\n예측 품질점수: 86.7점 ± 1.2점\n신뢰구간(95%): [85.3, 88.1]\n\n현재 기준(Sn 63.0%) 대비 −0.3점으로 소폭 낮으나 합격 범위 내입니다.\n모델: GradientBoosting (R² 0.627)",
  },
  {
    id: "Q-004", datetime: "2026-06-27 10:48", user: "김민준",
    question: "3호 라인 이상 징후 있어?",
    agent: "이상 탐지", responseMs: 671, status: "완료",
    answer: "3호 라인 이상 징후 감지 결과:\n\n⚠️ T-3-02 온도 센서 스파이크 14회/7일\n- 정상 설비 평균 2회/7일 대비 7배\n- 스파이크 발생 시 품질점수 평균 3.2점 하락\n\n→ 즉시 센서 점검 권고",
  },
  {
    id: "Q-005", datetime: "2026-06-27 09:15", user: "이서연",
    question: "최적 공정 온도 추천해줘",
    agent: "공정 추천", responseMs: 988, status: "완료",
    answer: "공정 최적화 분석 결과:\n\n권장 용융온도: 1,180°C (현행 1,175°C)\n예상 효과: 양품률 +0.5%p (97.3% → 97.8%)\n추가 에너지 비용: ~월 85만원\n\n3호 라인은 PID 재조정 후 적용 권장.",
  },
  {
    id: "Q-006", datetime: "2026-06-27 08:30", user: "박지훈",
    question: "오늘 출하 예정 LOT 품질 검토",
    agent: "품질 예측", responseMs: 756, status: "완료",
    answer: "오늘 출하 예정 LOT 품질 검토 결과:\n\n출하 대기: 12건\n합격: 11건 (91.7%)\n보류: 1건 — LOT-2026-0627-003 (재검사 필요)\n\n보류 LOT 제외 후 출하 진행 권장.",
  },
  {
    id: "Q-007", datetime: "2026-06-26 16:40", user: "김민준",
    question: "이번 달 클레임 발생 패턴 분석",
    agent: "통합 분석", responseMs: 1452, status: "완료",
    answer: "6월 클레임 패턴 분석:\n\n총 클레임: 8건 (전월 5건 대비 +60%)\n주요 원인:\n1. 성분 편차 초과: 5건 (62.5%)\n2. 외관 불량: 2건 (25%)\n3. 치수 불량: 1건 (12.5%)\n\n→ SUP_B 원자재 품질 관리 강화 필요",
  },
  {
    id: "Q-008", datetime: "2026-06-26 14:20", user: "이서연",
    question: "다음 주 생산 계획에 맞는 원자재 재고 충분해?",
    agent: "통합 분석", responseMs: 892, status: "완료",
    answer: "다음 주 생산 계획 대비 재고 분석:\n\n✅ SN: 2,450kg 보유 / 필요 1,800kg — 충분\n⚠️ AG: 125kg 보유 / 필요 150kg — 25kg 부족\n✅ CU: 85kg 보유 / 필요 60kg — 충분\n✅ PB: 340kg 보유 / 필요 280kg — 충분\n\n→ AG 긴급 발주 필요 (SUP_A 납기 3일)",
  },
  {
    id: "Q-009", datetime: "2026-06-26 11:05", user: "박지훈",
    question: "SUP_A vs SUP_C 납품 품질 비교",
    agent: "통합 분석", responseMs: 1103, status: "완료",
    answer: "공급사 품질 비교 (최근 3개월):\n\n| 지표 | SUP_A | SUP_C |\n|------|-------|-------|\n| 합격률 | 98.2% | 96.5% |\n| SN 편차 | ±0.18% | ±0.24% |\n| AG 편차 | ±0.08% | ±0.11% |\n\nSUP_A가 전 항목에서 우수합니다.",
  },
  {
    id: "Q-010", datetime: "2026-06-26 09:30", user: "김민준",
    question: "설비 예방정비 필요한 라인 알려줘",
    agent: "이상 탐지", responseMs: 534, status: "완료",
    answer: "예방정비 우선순위:\n\n🔴 3호 라인 — T-3-02 센서 즉시 점검\n🟡 1호 라인 — 용융로 필터 교체 예정 (D-12)\n🟢 2호 라인 — 정상 (다음 정기점검 D-28)\n\n3호 라인 조기 점검 권고.",
  },
  {
    id: "Q-011", datetime: "2026-06-25 15:22", user: "이서연",
    question: "LOT-2026-0625-005 상세 품질 분석",
    agent: "품질 예측", responseMs: 621, status: "완료",
    answer: "LOT-2026-0625-005 품질 분석:\n\nSN: 62.03% (목표 62.00% / 편차 +0.03%) ✅\nAG: 3.02% (목표 3.00% / 편차 +0.02%) ✅\nCU: 0.51% (목표 0.50% / 편차 +0.01%) ✅\n\n품질점수: 88.4점 — 양호\n판정: 합격",
  },
  {
    id: "Q-012", datetime: "2026-06-25 13:10", user: "박지훈",
    question: "야간 생산 불량 원인 분석",
    agent: "통합 분석", responseMs: 1678, status: "완료",
    answer: "야간 생산 불량 원인 분석:\n\n주원인: 야간 실온 저하 → CU 편차 증대\n- 22시~02시 실온 18°C 이하 빈도 높음\n- 해당 구간 CU 편차 평균 ±0.07%\n\n대책: 사전 예열 45분으로 연장 권고.",
  },
  {
    id: "Q-013", datetime: "2026-06-25 09:45", user: "김민준",
    question: "이번 주 생산 실적 요약",
    agent: "통합 분석", responseMs: 912, status: "완료",
    answer: "이번 주(06/21~06/25) 생산 실적:\n\n총 생산: 48 LOT / 24,000kg\n합격: 45건 (93.8%)\n불합격: 2건 (4.2%)\n보류: 1건 (2.1%)\n\n평균 품질점수: 87.1점\n전주 대비: +0.3점 ↑",
  },
  {
    id: "Q-014", datetime: "2026-06-24 16:00", user: "이서연",
    question: "현재 배합 조건으로 내일 품질 예측",
    agent: "품질 예측", responseMs: 748, status: "완료",
    answer: "내일 예측 (현행 배합 기준):\n\n예측 품질점수: 86.9점 ± 1.4점\n예측 합격률: 96.2%\n주요 리스크: SUP_B SN 편차 지속 시 불합격 가능성 ↑\n\n→ 배합비 재검토 권장",
  },
  {
    id: "Q-015", datetime: "2026-06-24 10:30", user: "박지훈",
    question: "AG 원료 재고 부족 대응 방안",
    agent: "공정 추천", responseMs: 867, status: "완료",
    answer: "AG 재고 부족 대응 방안:\n\n현재 재고: 125kg / 주간 소요: 150kg\n\n권장 조치:\n1. SUP_A 긴급 발주 50kg (납기 3일)\n2. 금주 AG 투입량 10% 절감 공정 조정\n3. 대체 공급사 SUP_C 긴급 견적 요청",
  },
  {
    id: "Q-016", datetime: "2026-06-23 14:55", user: "김민준",
    question: "불량 LOT 재처리 가능 여부 검토",
    agent: "배합 최적화", responseMs: 1023, status: "완료",
    answer: "불량 LOT 재처리 검토:\n\n대상: LOT-2026-0623-002 (SN 편차 −0.52%)\n재처리 가능성: 높음\n권장 재처리:\n- SN 추가 투입 0.5kg/배치\n- 재용융 온도 1,182°C\n\n예측 품질점수 회복: 84.2 → 87.5점",
  },
  {
    id: "Q-017", datetime: "2026-06-23 11:20", user: "이서연",
    question: "공급사별 납기 준수율 알려줘",
    agent: "통합 분석", responseMs: 743, status: "완료",
    answer: "공급사 납기 준수율 (최근 3개월):\n\nSUP_A: 98.5% ✅\nSUP_B: 94.2% ⚠️\nSUP_C: 97.8% ✅\nSUP_D: 91.0% 🔴\n\nSUP_D 납기 지연 패턴 — 대체 공급사 검토 필요",
  },
  {
    id: "Q-018", datetime: "2026-06-23 09:00", user: "박지훈",
    question: "에너지 비용 최적화 방안 분석",
    agent: "공정 추천", responseMs: 1341, status: "완료",
    answer: "에너지 비용 최적화 분석:\n\n현재 월 에너지 비용: 약 1,240만원\n\n최적화 방안:\n1. 대기 시간 설비 자동 절전 → 월 85만원 절감\n2. 용융로 예열 일정 최적화 → 월 45만원 절감\n3. 피크 시간대 생산 배분 조정 → 월 30만원 절감\n\n총 예상 절감: 월 160만원 (12.9%)",
  },
  {
    id: "Q-019", datetime: "2026-06-22 16:10", user: "김민준",
    question: "모델 재학습 필요한지 판단해줘",
    agent: "배합 최적화", responseMs: 2134, status: "완료",
    answer: "ML 모델 성능 점검 결과:\n\n현재 모델 (GradientBoosting):\n- RMSE: 3.21 (기준 3.5 이하) ✅\n- R²: 0.627 (기준 0.6 이상) ✅\n- MAPE: 2.78% (기준 5% 이하) ✅\n\n→ 현재 모델 성능 정상. 60일 후 재학습 예약 권고.",
  },
  {
    id: "Q-020", datetime: "2026-06-22 10:00", user: "이서연",
    question: "6월 전체 생산 요약 리포트 생성해줘",
    agent: "통합 분석", responseMs: 3210, status: "처리중",
    answer: "6월 생산 요약 리포트 생성 중...\n\n데이터 집계 범위: 2026-06-01 ~ 2026-06-28\n- 생산 실적 데이터 수집 완료\n- 품질 통계 집계 중...\n- 공급사 평가 계산 중...\n\n완료 예정: 약 2분",
  },
];

const AGENT_STYLES: Record<AgentKind, { color: string; bg: string }> = {
  "배합 최적화": { color: "#7C3AED", bg: "#F5F3FF" },
  "품질 예측":   { color: "#3A5BD9", bg: "#EEF1FD" },
  "이상 탐지":   { color: "#DC2626", bg: "#FEF1F2" },
  "통합 분석":   { color: "#16A34A", bg: "#ECFDF3" },
  "공정 추천":   { color: "#D97706", bg: "#FEF6E7" },
};

const STATUS_STYLES: Record<QStatus, { color: string; bg: string; dot: string }> = {
  완료:   { color: "#16A34A", bg: "#ECFDF3", dot: "#16A34A" },
  처리중: { color: "#D97706", bg: "#FEF6E7", dot: "#D97706" },
  오류:   { color: "#DC2626", bg: "#FEF1F2", dot: "#DC2626" },
};

const AGENTS: AgentKind[] = ["배합 최적화", "품질 예측", "이상 탐지", "통합 분석", "공정 추천"];
const USERS = ["전체", "김민준", "이서연", "박지훈"];

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AgentHistoryPage() {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [agentFilter, setAgentFilter]   = useState<"전체" | AgentKind>("전체");
  const [userFilter,  setUserFilter]    = useState("전체");
  const [dateFilter,  setDateFilter]    = useState("");

  const filtered = MOCK_QUERIES.filter((q) => {
    if (agentFilter !== "전체" && q.agent !== agentFilter) return false;
    if (userFilter  !== "전체" && q.user  !== userFilter)  return false;
    if (dateFilter && !q.datetime.startsWith(dateFilter)) return false;
    return true;
  });

  const todayCount  = MOCK_QUERIES.filter((q) => q.datetime.startsWith("2026-06-27")).length;
  const avgResponse = Math.round(MOCK_QUERIES.reduce((a, q) => a + q.responseMs, 0) / MOCK_QUERIES.length);
  const agentCounts = AGENTS.map((a) => ({ agent: a, count: MOCK_QUERIES.filter((q) => q.agent === a).length }));
  const topAgent    = agentCounts.sort((a, b) => b.count - a.count)[0];

  const selectStyle: React.CSSProperties = {
    padding: "6px 10px", fontSize: 12.5, border: "1px solid #E4E7EC",
    borderRadius: 7, background: "#fff", color: "#161B26", cursor: "pointer", outline: "none",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* Header */}
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: "#161B26", margin: 0 }}>사용자 질문이력</h1>
        <p style={{ fontSize: 12.5, color: "#687182", margin: "4px 0 0" }}>AI Agent 질의 전체 이력 및 응답 내역</p>
      </div>

      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
        <div className="card" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: "#687182", letterSpacing: "0.03em", textTransform: "uppercase" as const }}>오늘 질의 수</span>
          <span style={{ fontSize: 26, fontWeight: 800, color: "#3A5BD9", lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
            {todayCount}<span style={{ fontSize: 13, fontWeight: 500, color: "#9AA4B2", marginLeft: 3 }}>건</span>
          </span>
        </div>
        <div className="card" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: "#687182", letterSpacing: "0.03em", textTransform: "uppercase" as const }}>평균 응답시간</span>
          <span style={{ fontSize: 26, fontWeight: 800, color: "#16A34A", lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
            {avgResponse.toLocaleString()}<span style={{ fontSize: 13, fontWeight: 500, color: "#9AA4B2", marginLeft: 3 }}>ms</span>
          </span>
        </div>
        <div className="card" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: "#687182", letterSpacing: "0.03em", textTransform: "uppercase" as const }}>가장 많이 쓴 Agent</span>
          <span style={{ fontSize: 22, fontWeight: 800, color: "#7C3AED", lineHeight: 1 }}>
            {topAgent.agent}
          </span>
          <span style={{ fontSize: 11.5, color: "#9AA4B2" }}>{topAgent.count}회 사용</span>
        </div>
      </div>

      {/* Filter */}
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <label style={{ fontSize: 12, color: "#687182", display: "flex", alignItems: "center", gap: 6 }}>
          날짜
          <input
            type="date"
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value)}
            style={{ ...selectStyle, fontSize: 12 }}
          />
        </label>
        <label style={{ fontSize: 12, color: "#687182", display: "flex", alignItems: "center", gap: 6 }}>
          사용자
          <select style={selectStyle} value={userFilter} onChange={(e) => setUserFilter(e.target.value)}>
            {USERS.map((u) => <option key={u}>{u}</option>)}
          </select>
        </label>
        <label style={{ fontSize: 12, color: "#687182", display: "flex", alignItems: "center", gap: 6 }}>
          Agent
          <select style={selectStyle} value={agentFilter} onChange={(e) => setAgentFilter(e.target.value as typeof agentFilter)}>
            <option>전체</option>
            {AGENTS.map((a) => <option key={a}>{a}</option>)}
          </select>
        </label>
        {(agentFilter !== "전체" || userFilter !== "전체" || dateFilter) && (
          <button
            onClick={() => { setAgentFilter("전체"); setUserFilter("전체"); setDateFilter(""); }}
            style={{ padding: "5px 12px", fontSize: 12, fontWeight: 600, borderRadius: 6, border: "1px solid #E4E7EC", background: "#F8F9FB", color: "#687182", cursor: "pointer" }}
          >
            초기화
          </button>
        )}
        <span style={{ marginLeft: "auto", fontSize: 12, color: "#9AA4B2" }}>{filtered.length}건</span>
      </div>

      {/* Query list */}
      <div style={{ display: "flex", flexDirection: "column", gap: 0, border: "1px solid #E4E7EC", borderRadius: 12, overflow: "hidden", background: "#fff" }}>
        {/* Header row */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "1fr 80px 140px 110px 80px 70px",
          padding: "10px 16px", background: "#F8F9FB", borderBottom: "1px solid #E4E7EC",
          fontSize: 11.5, fontWeight: 600, color: "#687182", letterSpacing: "0.03em", textTransform: "uppercase",
        }}>
          <span>질문 내용</span>
          <span style={{ textAlign: "center" }}>사용자</span>
          <span>시간</span>
          <span>AI Agent</span>
          <span style={{ textAlign: "right" }}>응답시간</span>
          <span style={{ textAlign: "center" }}>상태</span>
        </div>

        {filtered.map((q, idx) => {
          const isExpanded = expandedId === q.id;
          const agSt = AGENT_STYLES[q.agent];
          const stSt = STATUS_STYLES[q.status];

          return (
            <div key={q.id} style={{ borderBottom: idx < filtered.length - 1 ? "1px solid #F2F4F7" : "none" }}>
              {/* Row */}
              <div
                role="button"
                tabIndex={0}
                onClick={() => setExpandedId(isExpanded ? null : q.id)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setExpandedId(isExpanded ? null : q.id); }}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 80px 140px 110px 80px 70px",
                  padding: "12px 16px",
                  cursor: "pointer",
                  background: isExpanded ? "#F8F9FB" : "transparent",
                  transition: "background 0.1s",
                  alignItems: "center",
                  outline: "none",
                }}
                onMouseEnter={(e) => { if (!isExpanded) (e.currentTarget as HTMLElement).style.background = "#F8F9FB"; }}
                onMouseLeave={(e) => { if (!isExpanded) (e.currentTarget as HTMLElement).style.background = "transparent"; }}
              >
                <span style={{ fontSize: 13, color: "#161B26", lineHeight: 1.4, paddingRight: 12, display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ color: isExpanded ? "#3A5BD9" : "#9AA4B2", fontSize: 10, transition: "transform 0.2s", display: "inline-block", transform: isExpanded ? "rotate(90deg)" : "rotate(0)" }}>▶</span>
                  {q.question}
                </span>
                <span style={{ fontSize: 12.5, color: "#687182", textAlign: "center" }}>{q.user}</span>
                <span style={{ fontSize: 12, color: "#9AA4B2", fontVariantNumeric: "tabular-nums" }}>{q.datetime}</span>
                <span>
                  <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 20, color: agSt.color, background: agSt.bg }}>
                    {q.agent}
                  </span>
                </span>
                <span style={{ fontSize: 12.5, color: "#161B26", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                  {q.responseMs.toLocaleString()} ms
                </span>
                <span style={{ textAlign: "center" }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 700, color: stSt.color, background: stSt.bg, padding: "2px 8px", borderRadius: 20 }}>
                    <span style={{ width: 5, height: 5, borderRadius: "50%", background: stSt.dot, display: "inline-block" }} />
                    {q.status}
                  </span>
                </span>
              </div>

              {/* Expanded answer */}
              {isExpanded && (
                <div style={{
                  padding: "14px 16px 16px 40px",
                  background: "#F8F9FB",
                  borderTop: "1px solid #F2F4F7",
                }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#687182", letterSpacing: "0.04em", textTransform: "uppercase", marginBottom: 8 }}>
                    AI 응답
                  </div>
                  <pre style={{
                    margin: 0, fontFamily: "inherit", fontSize: 12.5, color: "#161B26",
                    lineHeight: 1.75, whiteSpace: "pre-wrap", wordBreak: "break-word",
                    background: "#fff", padding: "12px 14px", borderRadius: 8,
                    border: "1px solid #E4E7EC",
                  }}>
                    {q.answer}
                  </pre>
                </div>
              )}
            </div>
          );
        })}

        {filtered.length === 0 && (
          <div style={{ padding: "40px 16px", textAlign: "center", color: "#9AA4B2", fontSize: 13 }}>
            조건에 맞는 질문이력이 없습니다.
          </div>
        )}
      </div>
    </div>
  );
}
