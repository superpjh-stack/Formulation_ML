"use client";

import { useState } from "react";
import { KpiCard } from "@/components/ui/KpiCard";
import { DataTable, Column } from "@/components/ui/DataTable";
import { StatusBadge } from "@/components/ui/StatusBadge";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell,
} from "recharts";

// ── Mock Data ────────────────────────────────────────────────────────────────

const PARETO_DATA = [
  { type: "성분이탈", count: 18, cumPct: 38.3 },
  { type: "외관불량", count: 12, cumPct: 63.8 },
  { type: "중량불량", count:  8, cumPct: 80.9 },
  { type: "포장불량", count:  6, cumPct: 93.6 },
  { type: "기타",     count:  3, cumPct: 100.0 },
];

const PARETO_COLORS = ["#3A5BD9", "#5E78E0", "#8095E8", "#A3B2F0", "#C6CCF7"];

interface QualityRow {
  product: string;
  lots: number;
  pass: number;
  fail: number;
  defectRate: number;
  grade: string;
}

const QUALITY_DATA: QualityRow[] = [
  { product: "SN63 솔더 합금",   lots: 24, pass: 23, fail: 1, defectRate: 4.2,  grade: "A" },
  { product: "SN60 솔더 합금",   lots: 18, pass: 17, fail: 1, defectRate: 5.6,  grade: "B" },
  { product: "SN96.5 무연솔더",  lots: 16, pass: 16, fail: 0, defectRate: 0.0,  grade: "S" },
  { product: "SN99.3 무연솔더",  lots: 12, pass: 11, fail: 1, defectRate: 8.3,  grade: "B" },
  { product: "SN62 솔더 합금",   lots: 10, pass: 10, fail: 0, defectRate: 0.0,  grade: "A" },
  { product: "SN95.5 무연솔더",  lots:  8, pass:  8, fail: 0, defectRate: 0.0,  grade: "S" },
  { product: "PB-FREE 특수합금", lots:  6, pass:  5, fail: 1, defectRate: 16.7, grade: "C" },
];

type FilterPeriod = "7일" | "30일" | "90일";

const TREND_DATA: Record<FilterPeriod, { date: string; rate: number }[]> = {
  "7일": [
    { date: "6/22", rate: 1.6 }, { date: "6/23", rate: 1.9 }, { date: "6/24", rate: 1.4 },
    { date: "6/25", rate: 2.1 }, { date: "6/26", rate: 2.3 }, { date: "6/27", rate: 1.7 }, { date: "6/28", rate: 1.8 },
  ],
  "30일": Array.from({ length: 30 }, (_, i) => ({
    date: `6/${i + 1 > 28 ? i - 27 : i + 1}`,
    rate: +(1.5 + Math.sin(i * 0.4) * 0.5 + Math.random() * 0.3).toFixed(1),
  })),
  "90일": Array.from({ length: 12 }, (_, i) => ({
    date: `W${i + 1}`,
    rate: +(1.8 + Math.cos(i * 0.5) * 0.4 + Math.random() * 0.3).toFixed(1),
  })),
};

const SPARKLINE_TOTAL  = [2.1, 1.9, 1.8, 2.0, 2.2, 1.8, 1.8].map((v) => ({ value: v }));
const SPARKLINE_PROC   = [1.0, 0.9, 0.8, 1.0, 1.1, 0.9, 0.9].map((v) => ({ value: v }));
const SPARKLINE_SHIP   = [0.5, 0.4, 0.3, 0.5, 0.4, 0.4, 0.4].map((v) => ({ value: v }));
const SPARKLINE_CLAIM  = [0.6, 0.5, 0.5, 0.6, 0.5, 0.5, 0.5].map((v) => ({ value: v }));

// ── Sub-components ───────────────────────────────────────────────────────────

function GradeCell({ grade }: { grade: string }) {
  const map: Record<string, "green" | "blue" | "amber" | "red" | "gray"> = {
    S: "blue", A: "green", B: "amber", C: "red",
  };
  return <StatusBadge variant={map[grade] ?? "gray"} label={grade} />;
}

function DefectCell({ rate }: { rate: number }) {
  const color = rate === 0 ? "#15803D" : rate < 5 ? "#B45309" : "#B91C1C";
  const bg    = rate === 0 ? "#ECFDF3" : rate < 5 ? "#FEF6E7" : "#FEF1F2";
  return (
    <span style={{
      display: "inline-block", padding: "2px 8px", borderRadius: 20,
      fontSize: 11.5, fontWeight: 700, color, background: bg,
      fontVariantNumeric: "tabular-nums",
    }}>
      {rate.toFixed(1)}%
    </span>
  );
}

const Q_COLUMNS: Column<QualityRow>[] = [
  { key: "product",    header: "제품명",   width: 180 },
  { key: "lots",       header: "LOT수",   align: "right" },
  { key: "pass",       header: "합격",    align: "right", render: (v) => <span style={{ color: "#15803D", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{v as number}</span> },
  { key: "fail",       header: "불합격",  align: "right", render: (v) => <span style={{ color: v === 0 ? "#9AA4B2" : "#B91C1C", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{v as number}</span> },
  { key: "defectRate", header: "불량률",  align: "center", render: (v) => <DefectCell rate={v as number} /> },
  { key: "grade",      header: "등급",    align: "center", render: (_, row) => <GradeCell grade={row.grade} /> },
];

const TOOLTIP_STYLE = { background: "#fff", border: "1px solid #E4E7EC", borderRadius: 8, padding: "8px 12px", fontSize: 12, boxShadow: "0 4px 12px rgba(0,0,0,.08)" };

// ── Page ─────────────────────────────────────────────────────────────────────

export default function QualityPage() {
  const [period, setPeriod] = useState<FilterPeriod>("7일");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: "#161B26", margin: 0 }}>품질 현황 분석</h1>
          <p style={{ fontSize: 12.5, color: "#687182", margin: "4px 0 0" }}>불량 유형별 현황 및 제품별 품질 지표</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z"/><path d="M12 7v5l3 3"/></svg>
            새로고침
          </button>
          <button className="btn">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            다운로드
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
        <KpiCard label="종합 불량률" value="1.8"  unit="%" trend="down"    trendValue="-0.2%p" sparkline={SPARKLINE_TOTAL}  accentColor="#DC2626" />
        <KpiCard label="공정 불량"   value="0.9"  unit="%" trend="neutral" trendValue="전주대비" sparkline={SPARKLINE_PROC}   accentColor="#F59E0B" />
        <KpiCard label="출하 불량"   value="0.4"  unit="%" trend="up"      trendValue="-0.1%p" sparkline={SPARKLINE_SHIP}   accentColor="#3A5BD9" />
        <KpiCard label="클레임"      value="0.5"  unit="%" trend="neutral" trendValue="0건 접수" sparkline={SPARKLINE_CLAIM}  accentColor="#7C3AED" />
      </div>

      {/* Charts row */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>

        {/* Pareto */}
        <div className="card">
          <div style={{ fontSize: 13, fontWeight: 700, color: "#161B26", marginBottom: 4 }}>불량 유형별 파레토</div>
          <div style={{ fontSize: 12, color: "#9AA4B2", marginBottom: 16 }}>건수 기준 / 누적 비율 오버레이</div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={PARETO_DATA} margin={{ top: 4, right: 40, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#F2F4F7" vertical={false} />
              <XAxis dataKey="type" tick={{ fontSize: 11.5, fill: "#9AA4B2" }} axisLine={false} tickLine={false} />
              <YAxis yAxisId="left" tick={{ fontSize: 11, fill: "#9AA4B2" }} axisLine={false} tickLine={false} width={28} />
              <YAxis yAxisId="right" orientation="right" domain={[0, 100]} tick={{ fontSize: 11, fill: "#9AA4B2" }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v}%`} width={32} />
              <Tooltip
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null;
                  return (
                    <div style={TOOLTIP_STYLE}>
                      <div style={{ fontWeight: 700, marginBottom: 4 }}>{label}</div>
                      <div style={{ color: "#687182" }}>건수: <strong style={{ color: "#161B26" }}>{payload[0]?.value}건</strong></div>
                      <div style={{ color: "#687182" }}>누적: <strong style={{ color: "#3A5BD9" }}>{payload[1]?.value}%</strong></div>
                    </div>
                  );
                }}
              />
              <Bar yAxisId="left" dataKey="count" radius={[4, 4, 0, 0]} name="건수">
                {PARETO_DATA.map((_, i) => <Cell key={i} fill={PARETO_COLORS[i]} />)}
              </Bar>
              <Line yAxisId="right" type="monotone" dataKey="cumPct" stroke="#F59E0B" strokeWidth={2} dot={{ r: 3, fill: "#F59E0B", strokeWidth: 0 }} name="누적%" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Trend */}
        <div className="card">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#161B26" }}>불량률 트렌드</div>
              <div style={{ fontSize: 12, color: "#9AA4B2", marginTop: 2 }}>기간별 종합 불량률 추이</div>
            </div>
            <div style={{ display: "flex", background: "#F2F4F7", borderRadius: 8, padding: 2, gap: 2 }}>
              {(["7일", "30일", "90일"] as FilterPeriod[]).map((p) => (
                <button
                  key={p}
                  onClick={() => setPeriod(p)}
                  style={{
                    padding: "4px 12px", borderRadius: 6, border: "none", cursor: "pointer",
                    fontSize: 12, fontWeight: 600,
                    background: period === p ? "#fff" : "transparent",
                    color: period === p ? "#161B26" : "#687182",
                    boxShadow: period === p ? "0 1px 3px rgba(0,0,0,.08)" : "none",
                    transition: "all 0.15s",
                  }}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={TREND_DATA[period]} margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#F2F4F7" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#9AA4B2" }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 11, fill: "#9AA4B2" }} axisLine={false} tickLine={false} domain={[0, 4]} tickFormatter={(v) => `${v}%`} width={32} />
              <Tooltip
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null;
                  return (
                    <div style={TOOLTIP_STYLE}>
                      <div style={{ fontWeight: 700, marginBottom: 4 }}>{label}</div>
                      <div style={{ color: "#687182" }}>불량률: <strong style={{ color: "#DC2626" }}>{payload[0]?.value}%</strong></div>
                    </div>
                  );
                }}
              />
              <Line type="monotone" dataKey="rate" stroke="#DC2626" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Quality Table */}
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "12px 20px", borderBottom: "1px solid #E4E7EC", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: "#161B26" }}>제품별 품질 현황</span>
          <span style={{ fontSize: 12, color: "#9AA4B2" }}>이번 달 기준</span>
        </div>
        <DataTable
          columns={Q_COLUMNS}
          data={QUALITY_DATA}
          rowKey={(row) => row.product}
          stickyHeader
        />
      </div>
    </div>
  );
}
