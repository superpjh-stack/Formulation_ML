"use client";

import { useState } from "react";
import { DataTable, Column } from "@/components/ui/DataTable";
import { StatusBadge } from "@/components/ui/StatusBadge";

// ─── Mock Data ────────────────────────────────────────────────────────────────

interface HistoryItem {
  id: string;
  date: string;
  supplier: string;
  lot: string;
  material: string;
  qty: string;
  sn: number;
  ag: number;
  cu: number;
  result: "합격" | "불합격" | "보류";
}

const MOCK_HISTORY: HistoryItem[] = [
  { id: "RC-2026-0601", date: "2026-06-27", supplier: "SUP_A", lot: "LOT-A-240001", material: "Sn (주석)", qty: "500 kg", sn: 62.1, ag: 2.98, cu: 0.51, result: "합격" },
  { id: "RC-2026-0602", date: "2026-06-27", supplier: "SUP_B", lot: "LOT-B-240001", material: "Pb (납)",   qty: "300 kg", sn: 61.8, ag: 3.02, cu: 0.49, result: "합격" },
  { id: "RC-2026-0603", date: "2026-06-27", supplier: "SUP_A", lot: "LOT-A-240002", material: "Ag (은)",   qty: "50 kg",  sn: 62.3, ag: 3.05, cu: 0.52, result: "합격" },
  { id: "RC-2026-0604", date: "2026-06-26", supplier: "SUP_C", lot: "LOT-C-240001", material: "Cu (구리)", qty: "200 kg", sn: 61.5, ag: 2.85, cu: 0.47, result: "보류" },
  { id: "RC-2026-0605", date: "2026-06-26", supplier: "SUP_B", lot: "LOT-B-240002", material: "Sn (주석)", qty: "400 kg", sn: 62.0, ag: 3.01, cu: 0.50, result: "합격" },
  { id: "RC-2026-0606", date: "2026-06-26", supplier: "SUP_D", lot: "LOT-D-240001", material: "Ag (은)",   qty: "30 kg",  sn: 59.8, ag: 2.72, cu: 0.44, result: "불합격" },
  { id: "RC-2026-0607", date: "2026-06-25", supplier: "SUP_A", lot: "LOT-A-240003", material: "Pb (납)",   qty: "150 kg", sn: 62.2, ag: 2.99, cu: 0.51, result: "합격" },
  { id: "RC-2026-0608", date: "2026-06-25", supplier: "SUP_C", lot: "LOT-C-240002", material: "Sn (주석)", qty: "600 kg", sn: 61.9, ag: 3.03, cu: 0.50, result: "합격" },
  { id: "RC-2026-0609", date: "2026-06-24", supplier: "SUP_A", lot: "LOT-A-240004", material: "Cu (구리)", qty: "250 kg", sn: 62.4, ag: 3.07, cu: 0.53, result: "합격" },
  { id: "RC-2026-0610", date: "2026-06-24", supplier: "SUP_B", lot: "LOT-B-240003", material: "Sn (주석)", qty: "350 kg", sn: 61.6, ag: 2.91, cu: 0.48, result: "합격" },
  { id: "RC-2026-0611", date: "2026-06-23", supplier: "SUP_D", lot: "LOT-D-240002", material: "Ag (은)",   qty: "45 kg",  sn: 60.2, ag: 2.78, cu: 0.43, result: "불합격" },
  { id: "RC-2026-0612", date: "2026-06-23", supplier: "SUP_C", lot: "LOT-C-240003", material: "Pb (납)",   qty: "180 kg", sn: 62.1, ag: 3.00, cu: 0.50, result: "합격" },
];

const RESULT_MAP: Record<HistoryItem["result"], { variant: "green" | "red" | "amber" }> = {
  합격:   { variant: "green" },
  불합격: { variant: "red" },
  보류:   { variant: "amber" },
};

// Deviation cell helpers
function deviationCell(value: number, target: number, tolerance: number) {
  const dev = value - target;
  const isOk = Math.abs(dev) <= tolerance;
  return (
    <span style={{ fontVariantNumeric: "tabular-nums", color: isOk ? "#161B26" : "#B91C1C", fontWeight: isOk ? 400 : 600 }}>
      {value.toFixed(2)}
      <span style={{ fontSize: 10, color: isOk ? "#9AA4B2" : "#DC2626", marginLeft: 3 }}>
        ({dev >= 0 ? "+" : ""}{dev.toFixed(2)})
      </span>
    </span>
  );
}

const COLUMNS: Column<HistoryItem>[] = [
  { key: "date",     header: "입고일",   width: 110 },
  { key: "supplier", header: "공급사",   width: 90 },
  { key: "lot",      header: "LOT번호",  width: 140 },
  { key: "material", header: "원자재",   width: 110 },
  { key: "qty",      header: "수량",     width: 90, align: "right" },
  {
    key: "sn",
    header: "SN 실측 (목표62.0)",
    width: 150,
    align: "right",
    render: (v) => deviationCell(v as number, 62.0, 0.5),
  },
  {
    key: "ag",
    header: "AG 실측 (목표3.0)",
    width: 150,
    align: "right",
    render: (v) => deviationCell(v as number, 3.0, 0.15),
  },
  {
    key: "cu",
    header: "CU 실측 (목표0.5)",
    width: 150,
    align: "right",
    render: (v) => deviationCell(v as number, 0.5, 0.05),
  },
  {
    key: "result",
    header: "판정",
    width: 80,
    align: "center",
    render: (_, row) => <StatusBadge variant={RESULT_MAP[row.result].variant} label={row.result} dot />,
  },
];

// ─── Page ─────────────────────────────────────────────────────────────────────

const SUPPLIERS = ["전체", "SUP_A", "SUP_B", "SUP_C", "SUP_D"];
const MATERIALS = ["전체", "Sn (주석)", "Pb (납)", "Ag (은)", "Cu (구리)"];
const RESULTS   = ["전체", "합격", "불합격", "보류"] as const;

export default function ReceivingHistoryPage() {
  const [supplier, setSupplier] = useState("전체");
  const [material, setMaterial] = useState("전체");
  const [result,   setResult]   = useState<string>("전체");

  const filtered = MOCK_HISTORY.filter((r) => {
    if (supplier !== "전체" && r.supplier !== supplier) return false;
    if (material !== "전체" && r.material !== material) return false;
    if (result   !== "전체" && r.result   !== result)   return false;
    return true;
  });

  const passCount = filtered.filter((r) => r.result === "합격").length;
  const failCount = filtered.filter((r) => r.result === "불합격").length;
  const holdCount = filtered.filter((r) => r.result === "보류").length;
  const passRate  = filtered.length ? Math.round((passCount / filtered.length) * 100) : 0;

  const selectStyle = {
    padding: "6px 10px", fontSize: 12.5, border: "1px solid #E4E7EC",
    borderRadius: 7, background: "#fff", color: "#161B26", cursor: "pointer", outline: "none",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* Header */}
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: "#161B26", margin: 0 }}>원자재 입고 이력</h1>
        <p style={{ fontSize: 12.5, color: "#687182", margin: "4px 0 0" }}>성분 실측치 및 검사 판정 이력 조회</p>
      </div>

      {/* Stats cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
        {[
          { label: "조회 건수", value: filtered.length, unit: "건", color: "#3A5BD9" },
          { label: "합격",      value: passCount,        unit: "건", color: "#16A34A" },
          { label: "불합격",    value: failCount,        unit: "건", color: "#DC2626" },
          { label: "합격률",    value: passRate,         unit: "%",  color: "#7C3AED" },
        ].map((s) => (
          <div key={s.label} className="card" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 11.5, fontWeight: 600, color: "#687182", letterSpacing: "0.03em", textTransform: "uppercase" as const }}>{s.label}</span>
            <span style={{ fontSize: 26, fontWeight: 800, color: s.color, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
              {s.value}<span style={{ fontSize: 13, fontWeight: 500, color: "#9AA4B2", marginLeft: 3 }}>{s.unit}</span>
            </span>
          </div>
        ))}
      </div>

      {/* Filter + Table */}
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 16px", borderBottom: "1px solid #E4E7EC", flexWrap: "wrap" as const }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: "#161B26", flex: 1, minWidth: 100 }}>이력 조회</span>
          <label style={{ fontSize: 12, color: "#687182", display: "flex", alignItems: "center", gap: 6 }}>
            공급사
            <select style={selectStyle} value={supplier} onChange={(e) => setSupplier(e.target.value)}>
              {SUPPLIERS.map((s) => <option key={s}>{s}</option>)}
            </select>
          </label>
          <label style={{ fontSize: 12, color: "#687182", display: "flex", alignItems: "center", gap: 6 }}>
            원자재
            <select style={selectStyle} value={material} onChange={(e) => setMaterial(e.target.value)}>
              {MATERIALS.map((m) => <option key={m}>{m}</option>)}
            </select>
          </label>
          <label style={{ fontSize: 12, color: "#687182", display: "flex", alignItems: "center", gap: 6 }}>
            판정
            <select style={selectStyle} value={result} onChange={(e) => setResult(e.target.value)}>
              {RESULTS.map((r) => <option key={r}>{r}</option>)}
            </select>
          </label>
          <button style={{ padding: "5px 14px", fontSize: 12, fontWeight: 600, borderRadius: 6, border: "1px solid #E4E7EC", background: "#F8F9FB", color: "#687182", cursor: "pointer" }}>
            CSV 내보내기
          </button>
        </div>
        <DataTable columns={COLUMNS} data={filtered} rowKey={(r) => r.id} stickyHeader />
        <div style={{ padding: "10px 16px", borderTop: "1px solid #F2F4F7", display: "flex", gap: 20 }}>
          <span style={{ fontSize: 11.5, color: "#687182" }}>
            합격 <strong style={{ color: "#16A34A" }}>{passCount}</strong> · 불합격 <strong style={{ color: "#DC2626" }}>{failCount}</strong> · 보류 <strong style={{ color: "#B45309" }}>{holdCount}</strong>
          </span>
        </div>
      </div>
    </div>
  );
}
