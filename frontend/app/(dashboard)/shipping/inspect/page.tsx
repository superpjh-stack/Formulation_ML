"use client";

import { useState } from "react";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { DataTable, Column } from "@/components/ui/DataTable";

interface InspectRecord {
  id: string;
  lot: string;
  product: string;
  date: string;
  inspector: string;
  appearance: "합격" | "불합격";
  component: "합격" | "불합격";
  weight: "합격" | "불합격";
  packing: "합격" | "불합격";
  overall: "합격" | "불합격" | "보류";
}

const MOCK_INSPECTIONS: InspectRecord[] = [
  { id: "INS-001", lot: "LOT-2026-0621", product: "Sn63Pb37",       date: "2026-06-27 08:00", inspector: "김철수", appearance: "합격", component: "합격", weight: "합격", packing: "합격", overall: "합격" },
  { id: "INS-002", lot: "LOT-2026-0622", product: "Sn96.5Ag3Cu0.5", date: "2026-06-27 09:10", inspector: "이영희", appearance: "합격", component: "합격", weight: "합격", packing: "합격", overall: "합격" },
  { id: "INS-003", lot: "LOT-2026-0623", product: "Sn60Pb40",        date: "2026-06-26 15:30", inspector: "박민준", appearance: "합격", component: "불합격", weight: "합격", packing: "합격", overall: "불합격" },
  { id: "INS-004", lot: "LOT-2026-0624", product: "Sn63Pb37",       date: "2026-06-26 11:00", inspector: "최수진", appearance: "합격", component: "합격", weight: "합격", packing: "합격", overall: "합격" },
  { id: "INS-005", lot: "LOT-2026-0625", product: "Sn96.5Ag3Cu0.5", date: "2026-06-25 14:00", inspector: "정동혁", appearance: "불합격", component: "합격", weight: "합격", packing: "합격", overall: "보류" },
  { id: "INS-006", lot: "LOT-2026-0626", product: "Sn63Pb37",       date: "2026-06-25 10:30", inspector: "김철수", appearance: "합격", component: "합격", weight: "합격", packing: "합격", overall: "합격" },
  { id: "INS-007", lot: "LOT-2026-0627", product: "Sn60Pb40",        date: "2026-06-24 16:00", inspector: "이영희", appearance: "합격", component: "합격", weight: "불합격", packing: "합격", overall: "불합격" },
  { id: "INS-008", lot: "LOT-2026-0628", product: "Sn96.5Ag3Cu0.5", date: "2026-06-24 09:00", inspector: "박민준", appearance: "합격", component: "합격", weight: "합격", packing: "합격", overall: "합격" },
];

function PassBadge({ v }: { v: "합격" | "불합격" }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      padding: "2px 8px", borderRadius: 20, fontSize: 11.5, fontWeight: 600,
      color: v === "합격" ? "#15803D" : "#B91C1C",
      background: v === "합격" ? "#ECFDF3" : "#FEF1F2",
    }}>
      {v}
    </span>
  );
}

const COLUMNS: Column<InspectRecord>[] = [
  { key: "id",         header: "검사번호",  width: 100 },
  { key: "lot",        header: "LOT번호",   width: 155 },
  { key: "product",    header: "제품",      width: 170 },
  { key: "date",       header: "검사일시",  width: 145 },
  { key: "inspector",  header: "검사자",    width: 90 },
  { key: "appearance", header: "외관",      width: 75, align: "center", render: (v) => <PassBadge v={v as "합격" | "불합격"} /> },
  { key: "component",  header: "성분",      width: 75, align: "center", render: (v) => <PassBadge v={v as "합격" | "불합격"} /> },
  { key: "weight",     header: "중량",      width: 75, align: "center", render: (v) => <PassBadge v={v as "합격" | "불합격"} /> },
  { key: "packing",    header: "포장",      width: 75, align: "center", render: (v) => <PassBadge v={v as "합격" | "불합격"} /> },
  {
    key: "overall",
    header: "종합판정",
    width: 90,
    align: "center",
    render: (v) => {
      const val = v as string;
      const variant = val === "합격" ? "green" : val === "불합격" ? "red" : "amber";
      return <StatusBadge variant={variant} label={val} dot />;
    },
  },
];

export default function InspectPage() {
  const [filter, setFilter] = useState<"전체" | "합격" | "불합격" | "보류">("전체");

  const filtered = filter === "전체" ? MOCK_INSPECTIONS : MOCK_INSPECTIONS.filter((r) => r.overall === filter);

  const pass   = MOCK_INSPECTIONS.filter((r) => r.overall === "합격").length;
  const fail   = MOCK_INSPECTIONS.filter((r) => r.overall === "불합격").length;
  const hold   = MOCK_INSPECTIONS.filter((r) => r.overall === "보류").length;
  const passRate = Math.round((pass / MOCK_INSPECTIONS.length) * 100);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: "#161B26", margin: 0 }}>검사결과관리</h1>
        <p style={{ fontSize: 12.5, color: "#687182", margin: "4px 0 0" }}>
          출하 전 검사 항목별 합격·불합격 이력
        </p>
      </div>

      {/* Summary KPIs */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
        {[
          { label: "전체 검사", value: MOCK_INSPECTIONS.length, unit: "건", color: "#3A5BD9", bg: "#EEF1FD" },
          { label: "합격",     value: pass,   unit: "건", color: "#15803D", bg: "#ECFDF3" },
          { label: "불합격",   value: fail,   unit: "건", color: "#B91C1C", bg: "#FEF1F2" },
          { label: "합격률",   value: passRate, unit: "%", color: "#7C3AED", bg: "#F5F1FE" },
        ].map((item) => (
          <div key={item.label} className="card" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 11.5, fontWeight: 600, color: "#687182", letterSpacing: "0.03em", textTransform: "uppercase" }}>
              {item.label}
            </span>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 4 }}>
              <span style={{ fontSize: 28, fontWeight: 800, color: item.color, fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>
                {item.value}
              </span>
              <span style={{ fontSize: 13, color: "#9AA4B2", marginBottom: 2 }}>{item.unit}</span>
            </div>
            <div style={{ height: 4, borderRadius: 2, background: "#F2F4F7", overflow: "hidden", marginTop: 4 }}>
              <div style={{ height: "100%", width: `${item.label === "합격률" ? item.value : (item.value / MOCK_INSPECTIONS.length) * 100}%`, background: item.color, borderRadius: 2 }} />
            </div>
          </div>
        ))}
      </div>

      {/* Inspection category breakdown */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
        {[
          { label: "외관 검사", pass: MOCK_INSPECTIONS.filter(r => r.appearance === "합격").length, total: MOCK_INSPECTIONS.length },
          { label: "성분 검사", pass: MOCK_INSPECTIONS.filter(r => r.component === "합격").length, total: MOCK_INSPECTIONS.length },
          { label: "중량 검사", pass: MOCK_INSPECTIONS.filter(r => r.weight === "합격").length,    total: MOCK_INSPECTIONS.length },
          { label: "포장 검사", pass: MOCK_INSPECTIONS.filter(r => r.packing === "합격").length,   total: MOCK_INSPECTIONS.length },
        ].map((item) => {
          const rate = Math.round((item.pass / item.total) * 100);
          return (
            <div key={item.label} className="card" style={{ padding: "14px 16px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <span style={{ fontSize: 12.5, fontWeight: 600, color: "#161B26" }}>{item.label}</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: rate >= 90 ? "#15803D" : "#B91C1C", fontVariantNumeric: "tabular-nums" }}>
                  {rate}%
                </span>
              </div>
              <div style={{ height: 6, borderRadius: 3, background: "#F2F4F7" }}>
                <div style={{ height: "100%", width: `${rate}%`, borderRadius: 3, background: rate >= 90 ? "#16A34A" : "#DC2626", transition: "width 0.4s" }} />
              </div>
              <div style={{ fontSize: 11, color: "#9AA4B2", marginTop: 6 }}>{item.pass}/{item.total} 합격</div>
            </div>
          );
        })}
      </div>

      {/* Table */}
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "14px 16px", borderBottom: "1px solid #E4E7EC" }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: "#161B26", flex: 1 }}>검사 이력</span>
          {(["전체", "합격", "불합격", "보류"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{
                padding: "4px 12px", fontSize: 12, fontWeight: 600, borderRadius: 20,
                border: "1px solid", cursor: "pointer",
                borderColor: filter === f ? "#3A5BD9" : "#E4E7EC",
                background: filter === f ? "#3A5BD9" : "#fff",
                color: filter === f ? "#fff" : "#687182",
              }}
            >
              {f}
            </button>
          ))}
        </div>
        <DataTable columns={COLUMNS} data={filtered} rowKey={(r) => r.id} stickyHeader />
      </div>
    </div>
  );
}
