"use client";

/**
 * FE-RT-25 · `/process/analysis` · 공정 분석 (FR-P-05)
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * 🔴 하드코딩 배열·클라이언트 상관계수 계산을 `GET /api/v1/process/analysis` 로 교체했다.
 *   **상관계수는 서버 계산(Pearson)이다.** 프론트가 다시 계산하지 않는다.
 *
 * ⚠ 분석 가능한 인자는 `lots` 의 수치형 컬럼뿐이다 — 온도·시간(공정 조건) + 성분 3종(참고).
 *   **RPM·냉각온도·압력은 저장 컬럼이 없다. 만들지 마라.**
 *
 * ⚠ **표본 수 표기를 생략하지 않는다.** n=5 의 r=0.9 와 n=500 의 r=0.9 는 전혀 다른
 *   이야기다. `sample_size < 30` 이면 상관계수를 **숨기지 말고** 주의 배지를 함께 띄운다.
 *
 * ⚠ `quality_corr` 이 `null` 이면 "계산 불가"다. `0` 으로 대체하지 마라 —
 *   무상관(r=0)과 계산 불가는 완전히 다른 의미다.
 * ══════════════════════════════════════════════════════════════════════════════
 */

import { useState } from "react";
import { useProcessAnalysis } from "@/hooks/useKoryoData";
import { StatusScreen } from "@/components/layout/StatusScreen";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { PillFilter } from "@/components/ui/PillFilter";
import { ScatterChart } from "@/components/charts/ScatterChart";
import { T } from "@/components/ui/tokens";
import type { ProcessAnalysisFactor } from "@/types/api";

/** 표본이 이보다 적으면 신뢰도 주의 배지를 붙인다 (통계학 통용 기준) */
const MIN_RELIABLE_SAMPLE = 30;

const DAYS_OPTIONS: { value: "30" | "90" | "180"; label: string }[] = [
  { value: "30", label: "30일" },
  { value: "90", label: "90일" },
  { value: "180", label: "180일" },
];

const FACTOR_META: Record<
  ProcessAnalysisFactor,
  { label: string; unit: string; decimals: number; kind: "공정 조건" | "배합 조성" }
> = {
  temperature: { label: "용해 온도", unit: "°C", decimals: 1, kind: "공정 조건" },
  time_min: { label: "처리 시간", unit: "분", decimals: 0, kind: "공정 조건" },
  sn_pct: { label: "Sn 비율", unit: "%", decimals: 3, kind: "배합 조성" },
  ag_pct: { label: "Ag 비율", unit: "%", decimals: 3, kind: "배합 조성" },
  cu_pct: { label: "Cu 비율", unit: "%", decimals: 3, kind: "배합 조성" },
};

const FACTOR_OPTIONS: { value: ProcessAnalysisFactor; label: string }[] = (
  Object.keys(FACTOR_META) as ProcessAnalysisFactor[]
).map((f) => ({ value: f, label: FACTOR_META[f].label }));

/** 통계학 통용 구간 (산출물 근거 없음 — UI 관례) */
function strengthOf(r: number): { label: string; variant: "red" | "amber" | "gray" } {
  const abs = Math.abs(r);
  if (abs >= 0.8) return { label: "강함", variant: "red" };
  if (abs >= 0.5) return { label: "보통", variant: "amber" };
  return { label: "약함", variant: "gray" };
}

const signed = (r: number) => `${r >= 0 ? "+" : "-"}${Math.abs(r).toFixed(3)}`;

export default function ProcessAnalysisPage() {
  const [days, setDays] = useState<"30" | "90" | "180">("90");
  const [factor, setFactor] = useState<ProcessAnalysisFactor>("temperature");

  const { data, loading, error, refetch } = useProcessAnalysis(factor, Number(days));

  if (loading) return <StatusScreen tone="loading" title="공정 분석을 불러오는 중" />;

  if (error) {
    return (
      <StatusScreen
        tone="error"
        title="공정 분석을 불러오지 못했습니다"
        code={error}
        actions={[{ label: "다시 시도", onClick: refetch, primary: true }]}
      />
    );
  }

  if (!data) return null;

  // 응답의 `scatter.factor` 가 정본이다 — 내가 보낸 값이 아니라 서버가 그린 인자를 쓴다
  const shownFactor = data.scatter.factor;
  const meta = FACTOR_META[shownFactor];
  const points = data.scatter.points;
  const lowSample = data.sample_size < MIN_RELIABLE_SAMPLE;

  const ranked = [...data.correlations].sort(
    (a, b) => Math.abs(b.quality_corr ?? 0) - Math.abs(a.quality_corr ?? 0)
  );
  const maxAbs = Math.max(...ranked.map((c) => Math.abs(c.quality_corr ?? 0)), 0.0001);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* [A] 헤더 */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: T.text, margin: 0 }}>공정 분석</h1>
          <p style={{ fontSize: 12.5, color: T.textSub, margin: "4px 0 0" }}>
            공정 조건과 품질 점수의 상관 분석 (FR-P-05)
          </p>
        </div>
        <PillFilter options={DAYS_OPTIONS} value={days} onChange={setDays} label="기간:" />
      </div>

      {lowSample && (
        <div style={bannerStyle}>
          표본이 적어 신뢰도가 낮습니다 (n = {data.sample_size} · 권장 {MIN_RELIABLE_SAMPLE} 이상).
          상관계수를 숨기지 않되 해석에 주의하세요.
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 20, alignItems: "start" }}>
        {/* [B] 산점도 */}
        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, gap: 12, flexWrap: "wrap" }}>
            <div style={{ ...sectionTitle, marginBottom: 0 }}>
              {meta.label} ↔ 품질 점수
            </div>
            <PillFilter options={FACTOR_OPTIONS} value={factor} onChange={setFactor} size="sm" />
          </div>
          {points.length === 0 ? (
            <p style={{ fontSize: 12.5, color: T.textMuted, margin: 0 }}>
              선택한 기간에 분석할 표본이 없습니다.
            </p>
          ) : (
            <ScatterChart
              points={points}
              xLabel={`${meta.label} (${meta.unit})`}
              yLabel="품질 점수"
              height={320}
              trendLine
              formatX={(v) => v.toFixed(meta.decimals)}
              formatY={(v) => v.toFixed(0)}
              ariaLabel={`${meta.label} 대 품질 점수 산점도`}
            />
          )}
          <p style={{ fontSize: 11, color: T.textMuted, margin: "10px 0 0" }}>
            추세선은 화면에서 그린 단순 선형회귀입니다. 상관계수 자체는 서버가 계산한 Pearson 값입니다.
            품질 점수가 없는 LOT 은 서버 집계에서 제외됩니다 (0 으로 대체하지 않습니다).
          </p>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {/* [C] 상관계수 순위 */}
          <div className="card">
            <div style={sectionTitle}>상관계수 순위</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {ranked.map((c) => {
                const m = FACTOR_META[c.factor];
                if (c.quality_corr === null) {
                  return (
                    <div key={c.factor} style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                      <span style={{ color: T.text }}>{m.label}</span>
                      <span style={{ color: T.textMuted }}>계산 불가</span>
                    </div>
                  );
                }
                const r = c.quality_corr;
                const strength = strengthOf(r);
                return (
                  <div key={c.factor} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                      <span style={{ fontSize: 12, color: T.text }}>
                        {m.label}
                        <span style={{ fontSize: 10.5, color: T.textMuted, marginLeft: 5 }}>{m.kind}</span>
                      </span>
                      <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                        <span style={{ fontSize: 12.5, fontWeight: 700, fontVariantNumeric: "tabular-nums", color: T.text }}>
                          {signed(r)}
                        </span>
                        <StatusBadge variant={strength.variant} label={strength.label} />
                      </span>
                    </div>
                    <div style={{ height: 8, background: T.surfaceSubtle, borderRadius: 5, overflow: "hidden" }}>
                      <div
                        style={{
                          width: `${(Math.abs(r) / maxAbs) * 100}%`,
                          height: "100%",
                          background: r >= 0 ? T.primary : T.error,
                          borderRadius: 5,
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
            <p style={{ fontSize: 11, color: T.textMuted, margin: "12px 0 0" }}>
              강도 구간은 |r| ≥ 0.8 강함 · 0.5 이상 보통 · 그 미만 약함입니다 (통계학 통용 구간).
            </p>
          </div>

          {/* [D] 표본 정보 */}
          <div className="card">
            <div style={sectionTitle}>표본 정보</div>
            <dl style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, margin: 0, fontSize: 13 }}>
              <div>
                <dt style={{ fontSize: 11, color: T.textMuted, fontWeight: 600 }}>분석 기간</dt>
                <dd style={{ margin: "2px 0 0", color: T.text }}>최근 {data.days}일</dd>
              </div>
              <div>
                <dt style={{ fontSize: 11, color: T.textMuted, fontWeight: 600 }}>표본 수</dt>
                <dd
                  style={{
                    margin: "2px 0 0",
                    color: lowSample ? T.warning : T.text,
                    fontWeight: lowSample ? 700 : 400,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {data.sample_size.toLocaleString("ko-KR")} 건
                </dd>
              </div>
            </dl>
            <p style={{ fontSize: 11, color: T.textMuted, margin: "12px 0 0", lineHeight: 1.6 }}>
              분석 인자는 <code>lots</code> 가 실제로 보유한 수치형 컬럼뿐입니다. 설비 RPM·압력·냉각
              온도는 저장 컬럼이 없어 분석할 수 없습니다.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── 스타일 ───────────────────────────────────────────────────────────────────

const sectionTitle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 700,
  color: T.text,
  marginBottom: 14,
};

const bannerStyle: React.CSSProperties = {
  background: "#FFFBEB",
  border: "1px solid #FCD34D",
  borderRadius: 10,
  padding: "10px 14px",
  fontSize: 12.5,
  color: "#92400E",
};
