"use client";

import { useState } from "react";
import { StatusBadge } from "@/components/ui/StatusBadge";

interface Decision {
  id: string;
  priority: 1 | 2 | 3;
  title: string;
  category: "품질" | "배합" | "설비" | "출하" | "공급망";
  summary: string;
  basis: string[];
  expectedEffect: string;
  effort: "즉시" | "단기" | "중기";
  status: "대기" | "채택" | "기각";
  generatedAt: string;
}

const INITIAL_DECISIONS: Decision[] = [
  {
    id: "DEC-001",
    priority: 1,
    title: "LOT-2026-0623 재배합 또는 폐기 결정",
    category: "품질",
    summary: "Pb 함량 40.9% 초과로 불합격 판정된 LOT에 대한 처리 결정이 필요합니다.",
    basis: ["성분 검사 결과: Pb 40.9% (규격 40.0±0.5%)", "현재 재고량: 750 kg", "현대모비스 납기: 6/29"],
    expectedEffect: "재배합 시 품질 합격 가능성 82%. 납기 1일 지연 예상. 폐기 시 750 kg 손실.",
    effort: "즉시",
    status: "대기",
    generatedAt: "2026-06-27 11:30",
  },
  {
    id: "DEC-002",
    priority: 1,
    title: "배합 계량 센서 교정 실시",
    category: "설비",
    summary: "최근 3건의 성분 편차가 계량 오차에서 기인함. 즉시 센서 교정 권장.",
    basis: ["LOT-0623 Pb 편차 +0.9%", "LOT-0607 Sn 편차 +0.8%", "LOT-0592 Pb 편차 +0.7% (3건 연속 양방향 편차)"],
    expectedEffect: "교정 후 성분 편차 ±0.3% 이내 유지 예상. 불합격률 약 1.5%p 감소.",
    effort: "즉시",
    status: "대기",
    generatedAt: "2026-06-27 11:32",
  },
  {
    id: "DEC-003",
    priority: 2,
    title: "SUP_B 납(Pb) 공급사 대체 검토",
    category: "공급망",
    summary: "SUP_B 공급 Pb의 순도 편차가 최근 3개월간 증가 추세. 대체 공급사 발굴 권장.",
    basis: ["SUP_B Pb 순도 표준편차: 1월 0.02% → 6월 0.08%", "관련 클레임 2건 (CLM-001, CLM-004)", "대체 후보: SUP_D (순도 99.97% 인증)"],
    expectedEffect: "공급 품질 안정화로 성분불량 클레임 연간 2~3건 감소 예상.",
    effort: "중기",
    status: "대기",
    generatedAt: "2026-06-27 10:15",
  },
  {
    id: "DEC-004",
    priority: 2,
    title: "GradientBoosting 모델 재학습 실행",
    category: "배합",
    summary: "최근 30일 실제 품질점수와 예측값 MAPE가 4.1%로 목표(3.0%) 초과.",
    basis: ["현재 MAPE: 4.1% (목표 3.0% 초과)", "학습 데이터: 2개월 전 기준", "신규 원자재 공급사(SUP_C) 데이터 미반영"],
    expectedEffect: "재학습 후 MAPE 2.5~3.0% 달성 예측. 배합 추천 정확도 향상.",
    effort: "단기",
    status: "채택",
    generatedAt: "2026-06-26 16:00",
  },
  {
    id: "DEC-005",
    priority: 3,
    title: "출하 검사 체크리스트 디지털 전환",
    category: "출하",
    summary: "현재 수기 작성 체크리스트를 시스템 내 디지털 입력으로 전환하면 오류 감소 예상.",
    basis: ["수기 입력 오류 발생: 월 평균 2.3건", "INS-005 기록 오류 사례", "디지털 전환 시 자동 검증 가능"],
    expectedEffect: "기록 오류 90% 감소. 검사 결과 실시간 DB 반영.",
    effort: "중기",
    status: "기각",
    generatedAt: "2026-06-25 14:00",
  },
];

const PRIORITY_COLORS: Record<number, { bg: string; color: string; label: string }> = {
  1: { bg: "#FEF1F2", color: "#B91C1C", label: "긴급" },
  2: { bg: "#FEF6E7", color: "#B45309", label: "중요" },
  3: { bg: "#F2F4F7", color: "#5B6573", label: "일반" },
};

const CAT_COLORS: Record<Decision["category"], { bg: string; color: string }> = {
  품질:  { bg: "#ECFDF3", color: "#15803D" },
  배합:  { bg: "#EEF1FD", color: "#1D4ED8" },
  설비:  { bg: "#F5F1FE", color: "#6D28D9" },
  출하:  { bg: "#FEF6E7", color: "#B45309" },
  공급망: { bg: "#F0F9FF", color: "#0369A1" },
};

const EFFORT_V: Record<Decision["effort"], "red" | "amber" | "blue"> = {
  즉시: "red", 단기: "amber", 중기: "blue",
};

export default function DecisionPage() {
  const [decisions, setDecisions] = useState(INITIAL_DECISIONS);
  const [filter, setFilter] = useState<"전체" | Decision["status"]>("전체");

  function act(id: string, action: "채택" | "기각") {
    setDecisions((p) => p.map((d) => d.id === id ? { ...d, status: action } : d));
  }

  const filtered = filter === "전체" ? decisions : decisions.filter((d) => d.status === filter);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: "#161B26", margin: 0 }}>의사결정 지원</h1>
        <p style={{ fontSize: 12.5, color: "#687182", margin: "4px 0 0" }}>
          AI 추천 액션 목록 — 우선순위·근거·예상 효과 기반
        </p>
      </div>

      {/* Summary */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 }}>
        {[
          { label: "전체 추천",  value: decisions.length,                                 color: "#3A5BD9" },
          { label: "대기",        value: decisions.filter(d => d.status === "대기").length,  color: "#B45309" },
          { label: "채택",        value: decisions.filter(d => d.status === "채택").length, color: "#15803D" },
          { label: "기각",        value: decisions.filter(d => d.status === "기각").length, color: "#9AA4B2" },
        ].map((s) => (
          <div key={s.label} className="card" style={{ padding: "14px 16px" }}>
            <div style={{ fontSize: 11.5, fontWeight: 600, color: "#687182", letterSpacing: "0.03em", textTransform: "uppercase", marginBottom: 6 }}>{s.label}</div>
            <div style={{ fontSize: 28, fontWeight: 800, color: s.color, fontVariantNumeric: "tabular-nums" }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Filter */}
      <div style={{ display: "flex", gap: 8 }}>
        {(["전체", "대기", "채택", "기각"] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)} style={{ padding: "5px 14px", fontSize: 12.5, fontWeight: 600, borderRadius: 20, border: "1px solid", cursor: "pointer", borderColor: filter === f ? "#3A5BD9" : "#E4E7EC", background: filter === f ? "#3A5BD9" : "#fff", color: filter === f ? "#fff" : "#687182" }}>{f}</button>
        ))}
      </div>

      {/* Decision cards */}
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {filtered.map((d) => {
          const pc = PRIORITY_COLORS[d.priority];
          const cc = CAT_COLORS[d.category];
          const isPending = d.status === "대기";
          return (
            <div key={d.id} className="card" style={{ opacity: d.status === "기각" ? 0.6 : 1, borderLeft: `4px solid ${pc.color}` }}>
              <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
                {/* Priority badge */}
                <div style={{ width: 48, height: 48, borderRadius: 10, background: pc.bg, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <span style={{ fontSize: 18, fontWeight: 900, color: pc.color, lineHeight: 1 }}>P{d.priority}</span>
                  <span style={{ fontSize: 9.5, fontWeight: 700, color: pc.color }}>{pc.label}</span>
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  {/* Header */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 8 }}>
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                        <span style={{ fontSize: 14, fontWeight: 700, color: "#161B26" }}>{d.title}</span>
                        <span style={{ padding: "1px 7px", borderRadius: 20, fontSize: 11, fontWeight: 600, ...cc }}>{d.category}</span>
                        <StatusBadge variant={EFFORT_V[d.effort]} label={d.effort} />
                      </div>
                      <p style={{ margin: 0, fontSize: 12.5, color: "#687182", lineHeight: 1.5 }}>{d.summary}</p>
                    </div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
                      {d.status !== "대기" && (
                        <StatusBadge variant={d.status === "채택" ? "green" : "gray"} label={d.status} dot />
                      )}
                      {isPending && (
                        <>
                          <button onClick={() => act(d.id, "채택")} style={{ padding: "6px 16px", fontSize: 12.5, fontWeight: 700, borderRadius: 7, border: "none", background: "#3A5BD9", color: "#fff", cursor: "pointer" }}>채택</button>
                          <button onClick={() => act(d.id, "기각")} style={{ padding: "6px 16px", fontSize: 12.5, fontWeight: 700, borderRadius: 7, border: "1px solid #E4E7EC", background: "#fff", color: "#687182", cursor: "pointer" }}>기각</button>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Basis */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 10 }}>
                    <div style={{ background: "#F8F9FB", borderRadius: 8, padding: "10px 12px" }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "#687182", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.03em" }}>근거 데이터</div>
                      {d.basis.map((b, i) => (
                        <div key={i} style={{ display: "flex", gap: 6, fontSize: 12, color: "#161B26", lineHeight: 1.5, marginBottom: 2 }}>
                          <span style={{ color: "#3A5BD9", flexShrink: 0 }}>•</span>
                          {b}
                        </div>
                      ))}
                    </div>
                    <div style={{ background: "#F8F9FB", borderRadius: 8, padding: "10px 12px" }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "#687182", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.03em" }}>예상 효과</div>
                      <p style={{ margin: 0, fontSize: 12, color: "#161B26", lineHeight: 1.5 }}>{d.expectedEffect}</p>
                    </div>
                  </div>
                </div>
              </div>
              <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid #F2F4F7", display: "flex", justifyContent: "flex-end" }}>
                <span style={{ fontSize: 11, color: "#9AA4B2" }}>AI 생성: {d.generatedAt}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
