"use client";

import { useState } from "react";

// ─── Mock Data ────────────────────────────────────────────────────────────────

type AnalysisType = "품질" | "생산" | "설비" | "배합";

interface Insight {
  text: string;
  severity: "info" | "warn" | "critical";
}

interface AnalysisReport {
  id: string;
  title: string;
  type: AnalysisType;
  datetime: string;
  summary: string;
  insights: Insight[];
  action: string;
}

const MOCK_REPORTS: AnalysisReport[] = [
  {
    id: "RPT-001",
    title: "이번 주 불량률 분석",
    type: "품질",
    datetime: "2026-06-27 14:05",
    summary: "이번 주(06/21~06/27) 전체 불량률은 2.8%로 지난주(2.3%) 대비 0.5%p 상승했습니다. 주요 원인은 SUP_B 공급 원자재의 SN 성분 편차 증가로 분석됩니다.",
    insights: [
      { text: "SUP_B 납품 Sn 순도 편차 ±0.8% → 지난주 대비 2.1배 증가", severity: "critical" },
      { text: "야간 생산 LOT에서 불량 집중 발생 (전체 불량의 61%)", severity: "warn" },
      { text: "SUP_A, SUP_C 원자재 품질은 정상 범위 유지", severity: "info" },
    ],
    action: "SUP_B 입고 검사 기준 강화 및 야간 공정 온도 프로파일 재검토 요청",
  },
  {
    id: "RPT-002",
    title: "공정 효율 분석",
    type: "생산",
    datetime: "2026-06-27 11:30",
    summary: "6월 전체 생산 효율을 분석한 결과, 용융온도 1,180°C 구간에서 양품률이 평균 0.5% 향상됩니다. 현재 표준 온도 1,175°C 대비 통계적으로 유의미한 차이입니다.",
    insights: [
      { text: "1,180°C 유지 시 양품률 97.8% (현재 97.3% 대비 +0.5%p)", severity: "info" },
      { text: "온도 상승에 따른 에너지 소비 증가분: 월 약 85만원 추정", severity: "warn" },
      { text: "3호 라인 온도 편차 ±3°C — 1, 2호 라인(±1°C) 대비 불안정", severity: "warn" },
    ],
    action: "3호 라인 히터 PID 제어 파라미터 재조정 후 1,180°C 시범 운영 검토",
  },
  {
    id: "RPT-003",
    title: "LOT별 품질 패턴 분석",
    type: "품질",
    datetime: "2026-06-26 16:45",
    summary: "주간/야간 생산 LOT 간 품질 편차를 분석했습니다. 야간(22시~06시) 생산 LOT에서 CU 성분 편차가 주간 대비 1.2배 높게 나타나며, 주요 원인으로 야간 실온 저하가 지목됩니다.",
    insights: [
      { text: "야간 LOT CU 편차 평균 ±0.063% vs 주간 ±0.052%", severity: "warn" },
      { text: "야간 실온 20°C 이하 구간에서 CU 편차 급증 패턴 확인", severity: "critical" },
      { text: "야간 LOT 합격률 96.1% — 주간(97.9%) 대비 1.8%p 낮음", severity: "warn" },
    ],
    action: "야간 공정 사전 예열 시간 30분 → 45분으로 연장 적용 권고",
  },
  {
    id: "RPT-004",
    title: "배합비율 최적화 분석",
    type: "배합",
    datetime: "2026-06-26 09:15",
    summary: "최근 30일 성분분석 데이터와 품질 점수를 기반으로 ML 모델이 최적 배합비율을 재산출했습니다. 현행 기준 대비 Sn 0.03% 하향 조정이 품질 점수 향상에 효과적입니다.",
    insights: [
      { text: "최적 SN 배합: 62.97% (현행 63.00% 대비 −0.03%)", severity: "info" },
      { text: "해당 조정 시 예측 품질점수 87.3점 (+2.1점)", severity: "info" },
      { text: "최적화 근거: 최근 SUP_A Sn 원료 순도 평균 99.91% 반영", severity: "info" },
    ],
    action: "배합 추천 모듈에서 신규 배합비 적용 후 시험 LOT 3개 생산 검증",
  },
  {
    id: "RPT-005",
    title: "설비 이상 징후 탐지",
    type: "설비",
    datetime: "2026-06-25 13:00",
    summary: "3호 라인 용융로 온도 센서(T-3-02)에서 비정상적인 노이즈가 감지되었습니다. 최근 7일간 간헐적 스파이크가 14회 발생했으며, 센서 교체 또는 정밀 점검이 필요합니다.",
    insights: [
      { text: "T-3-02 온도 스파이크 14회/7일 — 정상 설비 대비 7배 수준", severity: "critical" },
      { text: "스파이크 발생 시 해당 LOT 품질 점수 평균 3.2점 하락", severity: "critical" },
      { text: "3호 라인 가동률 98.1% — 설비 전체 평균(98.6%) 소폭 하회", severity: "warn" },
    ],
    action: "3호 라인 T-3-02 센서 즉시 점검 및 예비 센서 교체 일정 수립",
  },
];

const TYPE_STYLES: Record<AnalysisType, { color: string; bg: string }> = {
  품질: { color: "#3A5BD9", bg: "#EEF1FD" },
  생산: { color: "#16A34A", bg: "#ECFDF3" },
  설비: { color: "#DC2626", bg: "#FEF1F2" },
  배합: { color: "#7C3AED", bg: "#F5F3FF" },
};

const SEVERITY_STYLES: Record<Insight["severity"], { color: string; bg: string; icon: string }> = {
  info:     { color: "#1D4ED8", bg: "#EEF4FF", icon: "ℹ" },
  warn:     { color: "#B45309", bg: "#FEF6E7", icon: "⚠" },
  critical: { color: "#B91C1C", bg: "#FEF1F2", icon: "!" },
};

const PERIOD_OPTIONS = ["전체", "오늘", "이번 주", "이번 달"];
const TYPE_OPTIONS: ("전체" | AnalysisType)[] = ["전체", "생산", "품질", "설비", "배합"];

// ─── Report Card ──────────────────────────────────────────────────────────────

function ReportCard({ report }: { report: AnalysisReport }) {
  const [expanded, setExpanded] = useState(false);
  const typeStyle = TYPE_STYLES[report.type];

  return (
    <div
      className="card"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 14,
        border: "1px solid #E4E7EC",
        transition: "box-shadow 0.15s",
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <span style={{
              fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 20,
              color: typeStyle.color, background: typeStyle.bg,
            }}>
              {report.type}
            </span>
            <span style={{ fontSize: 11.5, color: "#9AA4B2", fontVariantNumeric: "tabular-nums" }}>
              {report.datetime}
            </span>
          </div>
          <h3 style={{ margin: 0, fontSize: 14.5, fontWeight: 700, color: "#161B26" }}>{report.title}</h3>
        </div>
        <button
          onClick={() => setExpanded((p) => !p)}
          style={{
            flexShrink: 0, padding: "5px 12px", fontSize: 12, fontWeight: 600,
            borderRadius: 7, border: "1px solid #E4E7EC", background: "#F8F9FB",
            color: "#687182", cursor: "pointer",
          }}
        >
          {expanded ? "접기" : "상세 보기"}
        </button>
      </div>

      {/* Summary */}
      <p style={{ margin: 0, fontSize: 13, color: "#4B5565", lineHeight: 1.65 }}>{report.summary}</p>

      {/* Insights */}
      {expanded && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: "#687182", letterSpacing: "0.04em", textTransform: "uppercase" }}>
            핵심 인사이트
          </div>
          {report.insights.map((ins, i) => {
            const s = SEVERITY_STYLES[ins.severity];
            return (
              <div key={i} style={{
                display: "flex", gap: 10, padding: "9px 12px",
                borderRadius: 8, background: s.bg, alignItems: "flex-start",
              }}>
                <span style={{
                  flexShrink: 0, width: 18, height: 18, borderRadius: "50%",
                  background: s.color, color: "#fff", fontSize: 10, fontWeight: 800,
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  {s.icon}
                </span>
                <span style={{ fontSize: 12.5, color: s.color, lineHeight: 1.5 }}>{ins.text}</span>
              </div>
            );
          })}
          {/* Action */}
          <div style={{
            marginTop: 4, padding: "10px 14px", borderRadius: 8,
            background: "#F8F9FB", border: "1px solid #E4E7EC",
            display: "flex", gap: 10, alignItems: "flex-start",
          }}>
            <span style={{ fontSize: 11.5, fontWeight: 700, color: "#3A5BD9", flexShrink: 0 }}>추천 액션</span>
            <span style={{ fontSize: 12.5, color: "#161B26", lineHeight: 1.5 }}>{report.action}</span>
          </div>
        </div>
      )}

      {/* Bottom action strip */}
      <div style={{ display: "flex", gap: 8, paddingTop: 4, borderTop: "1px solid #F2F4F7" }}>
        <button style={{
          padding: "4px 12px", fontSize: 11.5, fontWeight: 600, borderRadius: 6,
          border: "1px solid #E4E7EC", background: "#fff", color: "#687182", cursor: "pointer",
        }}>
          PDF 저장
        </button>
        <button style={{
          padding: "4px 12px", fontSize: 11.5, fontWeight: 600, borderRadius: 6,
          border: "1px solid #E4E7EC", background: "#fff", color: "#687182", cursor: "pointer",
        }}>
          공유
        </button>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AgentAnalysisPage() {
  const [typeFilter, setTypeFilter] = useState<"전체" | AnalysisType>("전체");
  const [periodFilter, setPeriodFilter] = useState("전체");
  const [requesting, setRequesting] = useState(false);

  const filtered = MOCK_REPORTS.filter((r) => {
    if (typeFilter !== "전체" && r.type !== typeFilter) return false;
    if (periodFilter === "오늘" && !r.datetime.startsWith("2026-06-27")) return false;
    if (periodFilter === "이번 주" && !["2026-06-27", "2026-06-26", "2026-06-25"].some((d) => r.datetime.startsWith(d))) return false;
    return true;
  });

  function requestAnalysis() {
    setRequesting(true);
    setTimeout(() => setRequesting(false), 2000);
  }

  const selectStyle: React.CSSProperties = {
    padding: "6px 10px", fontSize: 12.5, border: "1px solid #E4E7EC",
    borderRadius: 7, background: "#fff", color: "#161B26", cursor: "pointer", outline: "none",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 16 }}>
        <div style={{ flex: 1 }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: "#161B26", margin: 0 }}>생산/품질 분석</h1>
          <p style={{ fontSize: 12.5, color: "#687182", margin: "4px 0 0" }}>AI Agent 자동 분석 리포트 피드</p>
        </div>
        <button
          onClick={requestAnalysis}
          disabled={requesting}
          style={{
            padding: "8px 18px", fontSize: 13, fontWeight: 700, borderRadius: 8,
            border: "none", background: requesting ? "#9AA4B2" : "#3A5BD9",
            color: "#fff", cursor: requesting ? "not-allowed" : "pointer",
            display: "flex", alignItems: "center", gap: 7,
          }}
        >
          {requesting ? (
            <>
              <span style={{
                width: 12, height: 12, border: "2px solid rgba(255,255,255,0.4)",
                borderTopColor: "#fff", borderRadius: "50%", animation: "spin 0.7s linear infinite",
                display: "inline-block",
              }} />
              분석 요청 중...
            </>
          ) : (
            <>+ 새 분석 요청</>
          )}
        </button>
      </div>

      {/* Summary strip */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
        {[
          { label: "전체 리포트", value: MOCK_REPORTS.length, color: "#3A5BD9" },
          { label: "품질 분석",   value: MOCK_REPORTS.filter((r) => r.type === "품질").length,  color: "#3A5BD9" },
          { label: "긴급 인사이트", value: MOCK_REPORTS.flatMap((r) => r.insights).filter((i) => i.severity === "critical").length, color: "#DC2626" },
          { label: "대기 액션",   value: 3, color: "#D97706" },
        ].map((s) => (
          <div key={s.label} className="card" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: "#687182", letterSpacing: "0.03em", textTransform: "uppercase" as const }}>{s.label}</span>
            <span style={{ fontSize: 26, fontWeight: 800, color: s.color, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
              {s.value}
            </span>
          </div>
        ))}
      </div>

      {/* Filter bar */}
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, color: "#687182", fontWeight: 600 }}>필터:</span>
        <label style={{ fontSize: 12, color: "#687182", display: "flex", alignItems: "center", gap: 6 }}>
          분석 유형
          <select style={selectStyle} value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as typeof typeFilter)}>
            {TYPE_OPTIONS.map((t) => <option key={t}>{t}</option>)}
          </select>
        </label>
        <label style={{ fontSize: 12, color: "#687182", display: "flex", alignItems: "center", gap: 6 }}>
          기간
          <select style={selectStyle} value={periodFilter} onChange={(e) => setPeriodFilter(e.target.value)}>
            {PERIOD_OPTIONS.map((p) => <option key={p}>{p}</option>)}
          </select>
        </label>
        <span style={{ fontSize: 12, color: "#9AA4B2", marginLeft: "auto" }}>
          {filtered.length}개 리포트
        </span>
      </div>

      {/* Report feed */}
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {filtered.length === 0 ? (
          <div className="card" style={{ textAlign: "center", padding: "48px 24px", color: "#9AA4B2", fontSize: 13 }}>
            조건에 맞는 분석 리포트가 없습니다.
          </div>
        ) : (
          filtered.map((r) => <ReportCard key={r.id} report={r} />)
        )}
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
