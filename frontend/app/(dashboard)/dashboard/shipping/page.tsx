"use client";

import { KpiCard } from "@/components/ui/KpiCard";
import { DataTable, Column } from "@/components/ui/DataTable";
import { StatusBadge } from "@/components/ui/StatusBadge";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell,
} from "recharts";

// ── Mock Data ────────────────────────────────────────────────────────────────

const CUSTOMER_BAR = [
  { name: "삼성전기",   qty: 4.8 },
  { name: "LG이노텍",  qty: 3.9 },
  { name: "LS전선",    qty: 3.2 },
  { name: "현대모비스", qty: 2.4 },
  { name: "SK하이닉스", qty: 1.8 },
];

const BAR_COLORS = ["#3A5BD9", "#5470DC", "#6B84DF", "#8399E2", "#9AAFE5"];

const MONTHLY_TREND = [
  { month: "7월",  qty: 14.2 }, { month: "8월",  qty: 15.8 }, { month: "9월",  qty: 13.5 },
  { month: "10월", qty: 16.1 }, { month: "11월", qty: 17.2 }, { month: "12월", qty: 15.9 },
  { month: "1월",  qty: 14.8 }, { month: "2월",  qty: 16.3 }, { month: "3월",  qty: 17.5 },
  { month: "4월",  qty: 16.9 }, { month: "5월",  qty: 17.8 }, { month: "6월",  qty: 18.5 },
];

interface ShippingRow {
  id: string;
  customer: string;
  product: string;
  qty: number;
  shippedDate: string;
  dueDate: string;
  status: "납기준수" | "납기지연" | "출하준비" | "배송중";
}

const SHIPPING_DATA: ShippingRow[] = [
  { id: "SH-2406-042", customer: "삼성전기",   product: "SN63 솔더 합금",   qty: 800,  shippedDate: "2026-06-28", dueDate: "2026-06-28", status: "납기준수" },
  { id: "SH-2406-041", customer: "LG이노텍",  product: "SN96.5 무연솔더",  qty: 500,  shippedDate: "2026-06-27", dueDate: "2026-06-27", status: "납기준수" },
  { id: "SH-2406-040", customer: "LS전선",    product: "SN60 솔더 합금",   qty: 600,  shippedDate: "2026-06-27", dueDate: "2026-06-28", status: "납기준수" },
  { id: "SH-2406-039", customer: "현대모비스", product: "SN63 솔더 합금",   qty: 400,  shippedDate: "2026-06-26", dueDate: "2026-06-26", status: "납기준수" },
  { id: "SH-2406-038", customer: "SK하이닉스", product: "SN99.3 무연솔더",  qty: 300,  shippedDate: "—",          dueDate: "2026-06-29", status: "출하준비" },
  { id: "SH-2406-037", customer: "삼성전기",   product: "SN96.5 무연솔더",  qty: 700,  shippedDate: "2026-06-26", dueDate: "2026-06-25", status: "납기지연" },
  { id: "SH-2406-036", customer: "LG이노텍",  product: "SN62 솔더 합금",   qty: 450,  shippedDate: "2026-06-25", dueDate: "2026-06-25", status: "납기준수" },
  { id: "SH-2406-035", customer: "LS전선",    product: "SN63 솔더 합금",   qty: 550,  shippedDate: "2026-06-25", dueDate: "2026-06-25", status: "납기준수" },
  { id: "SH-2406-034", customer: "현대모비스", product: "SN60 솔더 합금",   qty: 350,  shippedDate: "2026-06-24", dueDate: "2026-06-24", status: "납기준수" },
  { id: "SH-2406-033", customer: "삼성전기",   product: "SN63 솔더 합금",   qty: 900,  shippedDate: "—",          dueDate: "2026-06-30", status: "배송중"   },
  { id: "SH-2406-032", customer: "SK하이닉스", product: "SN96.5 무연솔더",  qty: 200,  shippedDate: "2026-06-23", dueDate: "2026-06-24", status: "납기준수" },
  { id: "SH-2406-031", customer: "LG이노텍",  product: "SN99.3 무연솔더",  qty: 380,  shippedDate: "2026-06-23", dueDate: "2026-06-23", status: "납기준수" },
];

const SPARKLINE_SHIP   = MONTHLY_TREND.slice(-7).map((d) => ({ value: d.qty }));
const SPARKLINE_OTD    = [95.1, 95.8, 96.0, 95.5, 96.2, 96.2, 96.2].map((v) => ({ value: v }));
const SPARKLINE_CLAIM  = [0, 1, 0, 0, 0, 0, 0].map((v) => ({ value: v }));
const SPARKLINE_COUNT  = [38, 40, 41, 39, 42, 42, 42].map((v) => ({ value: v }));

// ── Sub-components ───────────────────────────────────────────────────────────

const STATUS_VARIANT: Record<string, "green" | "amber" | "red" | "blue" | "gray"> = {
  "납기준수": "green",
  "납기지연": "red",
  "출하준비": "amber",
  "배송중":   "blue",
};

const SHIP_COLUMNS: Column<ShippingRow>[] = [
  { key: "id",           header: "출하번호",  width: 130 },
  { key: "customer",     header: "고객사",    width: 120 },
  { key: "product",      header: "제품",      width: 160 },
  {
    key: "qty", header: "수량(kg)", align: "right", width: 90,
    render: (v) => <span style={{ fontVariantNumeric: "tabular-nums" }}>{(v as number).toLocaleString()}</span>,
  },
  { key: "shippedDate",  header: "출하일",    align: "center", width: 110 },
  { key: "dueDate",      header: "납기일",    align: "center", width: 110 },
  {
    key: "status", header: "상태", align: "center", width: 90,
    render: (_, row) => <StatusBadge variant={STATUS_VARIANT[row.status] ?? "gray"} label={row.status} dot />,
  },
];

const TOOLTIP_STYLE = {
  background: "#fff", border: "1px solid #E4E7EC", borderRadius: 8,
  padding: "8px 12px", fontSize: 12, boxShadow: "0 4px 12px rgba(0,0,0,.08)",
};

// ── Page ─────────────────────────────────────────────────────────────────────

export default function ShippingPage() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: "#161B26", margin: 0 }}>출하 현황 분석</h1>
          <p style={{ fontSize: 12.5, color: "#687182", margin: "4px 0 0" }}>월별 출하 실적 및 고객사별 현황</p>
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
        <KpiCard label="이번달 출하량" value="18.5" unit="톤"  trend="up"      trendValue="+3.9% vs 전월" sparkline={SPARKLINE_SHIP}  accentColor="#3A5BD9" />
        <KpiCard label="납기준수율"    value="96.2" unit="%"   trend="up"      trendValue="+0.7%p"        sparkline={SPARKLINE_OTD}   accentColor="#16A34A" />
        <KpiCard label="고객불만"      value="0"    unit="건"  trend="neutral" trendValue="이번달 0건"    sparkline={SPARKLINE_CLAIM}  accentColor="#687182" />
        <KpiCard label="출하건수"      value="42"   unit="건"  trend="up"      trendValue="+4건"          sparkline={SPARKLINE_COUNT}  accentColor="#7C3AED" />
      </div>

      {/* Charts row */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.6fr", gap: 20 }}>

        {/* Customer Bar */}
        <div className="card">
          <div style={{ fontSize: 13, fontWeight: 700, color: "#161B26", marginBottom: 4 }}>고객사별 출하량</div>
          <div style={{ fontSize: 12, color: "#9AA4B2", marginBottom: 16 }}>이번달 상위 5개사 (톤)</div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={CUSTOMER_BAR} layout="vertical" margin={{ top: 0, right: 24, bottom: 0, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#F2F4F7" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 11, fill: "#9AA4B2" }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v}t`} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 12, fill: "#161B26", fontWeight: 500 }} axisLine={false} tickLine={false} width={72} />
              <Tooltip
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null;
                  return (
                    <div style={TOOLTIP_STYLE}>
                      <div style={{ fontWeight: 700, marginBottom: 4 }}>{label}</div>
                      <div style={{ color: "#687182" }}>출하량: <strong style={{ color: "#3A5BD9" }}>{payload[0]?.value}톤</strong></div>
                    </div>
                  );
                }}
              />
              <Bar dataKey="qty" radius={[0, 4, 4, 0]} name="출하량">
                {CUSTOMER_BAR.map((_, i) => <Cell key={i} fill={BAR_COLORS[i]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Monthly Trend */}
        <div className="card">
          <div style={{ fontSize: 13, fontWeight: 700, color: "#161B26", marginBottom: 4 }}>월별 출하 추이</div>
          <div style={{ fontSize: 12, color: "#9AA4B2", marginBottom: 16 }}>최근 12개월 출하량 (톤)</div>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={MONTHLY_TREND} margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="shipGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#3A5BD9" stopOpacity={0.15} />
                  <stop offset="95%" stopColor="#3A5BD9" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#F2F4F7" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#9AA4B2" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: "#9AA4B2" }} axisLine={false} tickLine={false} domain={[10, 22]} tickFormatter={(v) => `${v}t`} width={30} />
              <Tooltip
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null;
                  return (
                    <div style={TOOLTIP_STYLE}>
                      <div style={{ fontWeight: 700, marginBottom: 4 }}>{label}</div>
                      <div style={{ color: "#687182" }}>출하량: <strong style={{ color: "#3A5BD9" }}>{payload[0]?.value}톤</strong></div>
                    </div>
                  );
                }}
              />
              <Line
                type="monotone" dataKey="qty" stroke="#3A5BD9" strokeWidth={2}
                dot={(props) => {
                  const isLast = props.index === MONTHLY_TREND.length - 1;
                  if (!isLast) return <circle key={props.key} r={0} />;
                  return <circle key={props.key} cx={props.cx} cy={props.cy} r={5} fill="#3A5BD9" stroke="#fff" strokeWidth={2} />;
                }}
                activeDot={{ r: 4 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Shipping Table */}
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "12px 20px", borderBottom: "1px solid #E4E7EC", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: "#161B26" }}>출하 현황</span>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, color: "#15803D" }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#16A34A", display: "inline-block" }} />
              납기준수 {SHIPPING_DATA.filter(r => r.status === "납기준수").length}건
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, color: "#B91C1C" }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#DC2626", display: "inline-block" }} />
              납기지연 {SHIPPING_DATA.filter(r => r.status === "납기지연").length}건
            </span>
            <span style={{ fontSize: 12, color: "#9AA4B2" }}>총 {SHIPPING_DATA.length}건</span>
          </div>
        </div>
        <DataTable
          columns={SHIP_COLUMNS}
          data={SHIPPING_DATA}
          rowKey={(row) => row.id}
          stickyHeader
        />
      </div>
    </div>
  );
}
