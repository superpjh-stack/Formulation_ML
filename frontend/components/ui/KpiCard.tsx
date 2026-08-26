"use client";

/**
 * KpiCard — SF-TD3 §4 공통 KPI 카드.
 *
 * 웨이브 C 패치 (`specs/design-charts.md` §4.2):
 * 카드 안에 있던 private `Sparkline`(83줄) 을 **삭제하고 `TrendChart` 로 흡수**했다.
 * DPR 스케일링 · `color+"40"`/`color+"00"` 그라디언트 · `quadraticCurveTo` 루프 ·
 * 흰 테두리 엔드포인트 도트가 캔버스 차트 10벌과 **완전히 같은 코드**였다.
 * 캔버스 · 폭 100% · 축 없음이라 `TrendChart` 스파크라인 모드와 렌더 정책도 일치한다.
 *
 * ⚠ **공개 시그니처(`KpiCardProps`)는 바뀌지 않았다.** 이 컴포넌트를 쓰는 9개 화면은
 *   그대로 동작한다. `accentColor` 도 `string` 을 유지한다 (토큰 이름을 넘기면
 *   `TrendChart` 가 토큰으로 해석하고, hex 를 넘기면 그대로 쓴다).
 *
 * `components/charts/MiniSparkline` 은 **남긴다** — 순수 SVG · 고정 px · 서버 렌더 가능이라
 * 테이블 셀 안 인라인 미니차트라는 다른 용도를 담당한다 (design-charts §4.1).
 */

import { TrendChart } from "@/components/charts/TrendChart";

interface SparklinePoint {
  value: number;
}

interface KpiCardProps {
  label: string;
  value: string | number;
  unit?: string;
  trend?: "up" | "down" | "neutral";
  trendValue?: string;
  sparkline?: SparklinePoint[];
  accentColor?: string;
}

const TREND_CONFIG = {
  up:      { color: "#15803D", bg: "#ECFDF3", arrow: "↑" },
  down:    { color: "#B91C1C", bg: "#FEF1F2", arrow: "↓" },
  neutral: { color: "#5B6573", bg: "#F2F4F7", arrow: "→" },
};

export function KpiCard({
  label,
  value,
  unit,
  trend,
  trendValue,
  sparkline,
  accentColor = "#3A5BD9",
}: KpiCardProps) {
  const tc = trend ? TREND_CONFIG[trend] : null;

  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
      {/* Label row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <span
          style={{
            fontSize: 11.5,
            fontWeight: 600,
            color: "#687182",
            letterSpacing: "0.03em",
            textTransform: "uppercase",
          }}
        >
          {label}
        </span>
        {tc && trendValue && (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 3,
              padding: "2px 7px",
              borderRadius: 20,
              fontSize: 11,
              fontWeight: 700,
              color: tc.color,
              background: tc.bg,
            }}
          >
            {tc.arrow} {trendValue}
          </span>
        )}
      </div>

      {/* Value row */}
      <div style={{ display: "flex", alignItems: "flex-end", gap: 4 }}>
        <span
          style={{
            fontSize: 26,
            fontWeight: 800,
            color: "var(--color-text, #161B26)",
            lineHeight: 1,
            fontVariantNumeric: "tabular-nums",
            letterSpacing: "-0.02em",
          }}
        >
          {value}
        </span>
        {unit && (
          <span style={{ fontSize: 13, fontWeight: 500, color: "#9AA4B2", marginBottom: 2 }}>
            {unit}
          </span>
        )}
      </div>

      {/* 스파크라인 — TrendChart 스파크라인 모드 (축·그리드·범례 없음) */}
      {sparkline && sparkline.length > 1 && (
        <div style={{ marginTop: 4 }}>
          <TrendChart
            height={40}
            showAxis={false}
            legend={false}
            dots="last"
            categories={sparkline.map((_, i) => String(i))}
            series={[
              { name: label, values: sparkline.map((p) => p.value), color: accentColor },
            ]}
            ariaLabel={`${label} 추이`}
          />
        </div>
      )}
    </div>
  );
}
