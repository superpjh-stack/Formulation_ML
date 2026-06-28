"use client";

import { useState, useRef, useEffect } from "react";
import { KpiCard } from "@/components/ui/KpiCard";
import { DataTable, Column } from "@/components/ui/DataTable";
import { StatusBadge } from "@/components/ui/StatusBadge";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, Legend,
} from "recharts";

// ── Mock Data ────────────────────────────────────────────────────────────────

const TREND_7D = [
  { date: "6/22", actual: 4620, target: 5000 },
  { date: "6/23", actual: 4910, target: 5000 },
  { date: "6/24", actual: 5080, target: 5000 },
  { date: "6/25", actual: 4750, target: 5000 },
  { date: "6/26", actual: 4390, target: 5000 },
  { date: "6/27", actual: 5120, target: 5000 },
  { date: "6/28", actual: 4820, target: 5000 },
];

const SPARKLINE_PROD  = TREND_7D.map((d) => ({ value: d.actual }));
const SPARKLINE_YIELD = [97.2, 97.5, 98.1, 97.9, 97.6, 97.8, 97.8].map((v) => ({ value: v }));
const SPARKLINE_UTIL  = [89.1, 90.3, 91.0, 90.8, 90.5, 91.3, 91.3].map((v) => ({ value: v }));
const SPARKLINE_DEF   = [2.1, 2.0, 2.3, 2.2, 2.4, 2.2, 2.2].map((v) => ({ value: v }));

interface LotRow {
  lot: string;
  product: string;
  target: number;
  actual: number;
  rate: number;
  grade: string;
  status: string;
}

const LOT_DATA: LotRow[] = [
  { lot: "L2406-001", product: "SN63 솔더 합금",   target: 500, actual: 512, rate: 102.4, grade: "A", status: "완료" },
  { lot: "L2406-002", product: "SN60 솔더 합금",   target: 400, actual: 398, rate: 99.5,  grade: "A", status: "완료" },
  { lot: "L2406-003", product: "SN96.5 무연솔더",  target: 300, actual: 315, rate: 105.0, grade: "S", status: "완료" },
  { lot: "L2406-004", product: "SN63 솔더 합금",   target: 500, actual: 487, rate: 97.4,  grade: "B", status: "완료" },
  { lot: "L2406-005", product: "SN99.3 무연솔더",  target: 250, actual: 261, rate: 104.4, grade: "A", status: "완료" },
  { lot: "L2406-006", product: "SN60 솔더 합금",   target: 400, actual: 356, rate: 89.0,  grade: "C", status: "불량검토" },
  { lot: "L2406-007", product: "SN63 솔더 합금",   target: 500, actual: 502, rate: 100.4, grade: "A", status: "완료" },
  { lot: "L2406-008", product: "SN96.5 무연솔더",  target: 300, actual: 308, rate: 102.7, grade: "A", status: "완료" },
  { lot: "L2406-009", product: "SN62 솔더 합금",   target: 450, actual: 441, rate: 98.0,  grade: "A", status: "출하대기" },
  { lot: "L2406-010", product: "SN63 솔더 합금",   target: 500, actual: 498, rate: 99.6,  grade: "A", status: "출하대기" },
  { lot: "L2406-011", product: "SN60 솔더 합금",   target: 400, actual: 0,   rate: 0,     grade: "-", status: "생산중" },
  { lot: "L2406-012", product: "SN96.5 무연솔더",  target: 270, actual: 0,   rate: 0,     grade: "-", status: "생산중" },
];

// ── Sub-components ───────────────────────────────────────────────────────────

function RateCell({ rate }: { rate: number }) {
  if (rate === 0) return <span style={{ color: "#9AA4B2", fontVariantNumeric: "tabular-nums" }}>—</span>;
  const color = rate >= 100 ? "#15803D" : rate >= 90 ? "#B45309" : "#B91C1C";
  const bg    = rate >= 100 ? "#ECFDF3"  : rate >= 90 ? "#FEF6E7"  : "#FEF1F2";
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

function StatusCell({ status }: { status: string }) {
  const map: Record<string, "green" | "amber" | "red" | "blue" | "gray"> = {
    "완료": "green", "출하대기": "blue", "생산중": "amber", "불량검토": "red",
  };
  return <StatusBadge variant={map[status] ?? "gray"} label={status} dot />;
}

const COLUMNS: Column<LotRow>[] = [
  { key: "lot",     header: "LOT 번호", width: 120 },
  { key: "product", header: "제품",     width: 160 },
  { key: "target",  header: "목표량(kg)", align: "right", render: (v) => <span style={{ fontVariantNumeric: "tabular-nums" }}>{(v as number).toLocaleString()}</span> },
  { key: "actual",  header: "실적량(kg)", align: "right", render: (v) => <span style={{ fontVariantNumeric: "tabular-nums" }}>{v === 0 ? "—" : (v as number).toLocaleString()}</span> },
  { key: "rate",    header: "달성률",   align: "center", render: (v) => <RateCell rate={v as number} /> },
  { key: "grade",   header: "품질등급", align: "center" },
  { key: "status",  header: "상태",     align: "center", render: (_, row) => <StatusCell status={row.status} /> },
];

const CUSTOM_TOOLTIP = ({ active, payload, label }: { active?: boolean; payload?: { value: number; name: string }[]; label?: string }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: "#fff", border: "1px solid #E4E7EC", borderRadius: 8, padding: "8px 12px", fontSize: 12, boxShadow: "0 4px 12px rgba(0,0,0,.08)" }}>
      <div style={{ fontWeight: 700, color: "#161B26", marginBottom: 4 }}>{label}</div>
      {payload.map((p) => (
        <div key={p.name} style={{ color: "#687182" }}>
          {p.name === "actual" ? "실적" : "목표"}: <strong style={{ color: "#161B26" }}>{p.value.toLocaleString()} kg</strong>
        </div>
      ))}
    </div>
  );
};

// ── Page ─────────────────────────────────────────────────────────────────────

type Tab = "일" | "주" | "월";

export default function ProductionPage() {
  const [tab, setTab] = useState<Tab>("일");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: "#161B26", margin: 0 }}>생산 현황 분석</h1>
          <p style={{ fontSize: 12.5, color: "#687182", margin: "4px 0 0" }}>당일 생산 실적 및 LOT별 진행 현황</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {/* Tab group */}
          <div style={{ display: "flex", background: "#F2F4F7", borderRadius: 8, padding: 2, gap: 2 }}>
            {(["일", "주", "월"] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                style={{
                  padding: "5px 14px", borderRadius: 6, border: "none", cursor: "pointer",
                  fontSize: 12.5, fontWeight: 600,
                  background: tab === t ? "#fff" : "transparent",
                  color: tab === t ? "#161B26" : "#687182",
                  boxShadow: tab === t ? "0 1px 3px rgba(0,0,0,.08)" : "none",
                  transition: "all 0.15s",
                }}
              >
                {t}
              </button>
            ))}
          </div>
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

      {/* KPI Cards — 6개, 2행 3열 */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
        <KpiCard label="당일 생산량"  value="4,820" unit="kg"  trend="up"      trendValue="+6.4% vs 어제" sparkline={SPARKLINE_PROD}  accentColor="#3A5BD9" />
        <KpiCard label="양품률"       value="97.8"  unit="%"   trend="down"    trendValue="-0.3%p"        sparkline={SPARKLINE_YIELD} accentColor="#16A34A" />
        <KpiCard label="가동률"       value="91.3"  unit="%"   trend="up"      trendValue="+1.2%p"        sparkline={SPARKLINE_UTIL}  accentColor="#7C3AED" />
        <KpiCard label="불량률"       value="2.2"   unit="%"   trend="down"    trendValue="+0.3%p"        sparkline={SPARKLINE_DEF}   accentColor="#DC2626" />
        <KpiCard label="생산효율"     value="87.4"  unit="%"   trend="neutral" trendValue="전주대비"       sparkline={[85,86,87,88,87,87,87].map(v=>({value:v}))} accentColor="#F59E0B" />
        <KpiCard label="LOT 수"       value="12"    unit="건"  trend="neutral" trendValue="진행 중 2건"   sparkline={[10,11,12,11,12,12,12].map(v=>({value:v}))} accentColor="#0EA5E9" />
      </div>

      {/* Trend Chart */}
      <div className="card">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#161B26" }}>생산 추이 (7일)</div>
            <div style={{ fontSize: 12, color: "#9AA4B2", marginTop: 2 }}>일별 실적량과 목표량 비교</div>
          </div>
          <div style={{ display: "flex", gap: 16, fontSize: 12, color: "#687182" }}>
            <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <span style={{ width: 12, height: 3, background: "#3A5BD9", borderRadius: 2, display: "inline-block" }} />실적
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <span style={{ width: 12, height: 2, background: "#E4E7EC", borderRadius: 2, display: "inline-block", borderTop: "2px dashed #9AA4B2" }} />목표 5,000 kg
            </span>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={TREND_7D} margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#F2F4F7" vertical={false} />
            <XAxis dataKey="date" tick={{ fontSize: 11.5, fill: "#9AA4B2" }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: "#9AA4B2" }} axisLine={false} tickLine={false} domain={[4000, 5500]} tickFormatter={(v) => `${(v/1000).toFixed(1)}k`} width={38} />
            <Tooltip content={<CUSTOM_TOOLTIP />} />
            <ReferenceLine y={5000} stroke="#CBD5E1" strokeDasharray="5 4" strokeWidth={1.5} />
            <Line type="monotone" dataKey="actual" stroke="#3A5BD9" strokeWidth={2} dot={{ r: 3, fill: "#3A5BD9", strokeWidth: 0 }} activeDot={{ r: 5 }} name="actual" />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* LOT Table */}
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "12px 20px", borderBottom: "1px solid #E4E7EC", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: "#161B26" }}>제품별 생산실적</span>
          <span style={{ fontSize: 12, color: "#9AA4B2" }}>총 {LOT_DATA.length}건</span>
        </div>
        <DataTable
          columns={COLUMNS}
          data={LOT_DATA}
          rowKey={(row) => row.lot}
          stickyHeader
        />
      </div>
    </div>
  );
}
