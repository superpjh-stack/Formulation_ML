"use client";

import { useState } from "react";
import { DataTable, Column } from "@/components/ui/DataTable";
import { StatusBadge } from "@/components/ui/StatusBadge";

// ─── Mock Data ────────────────────────────────────────────────────────────────

interface ProcessHistory {
  id: string;
  date: string;
  shift: "주간" | "야간";
  product: string;
  lot: string;
  startTime: string;
  endTime: string;
  duration: number;
  actualTemp: number;
  actualRpm: number;
  output: number;
  result: "정상" | "이상" | "경고";
}

const MOCK_HISTORY: ProcessHistory[] = [
  { id: "PH-001", date: "2026-06-27", shift: "주간", product: "Sn63Pb37",       lot: "LOT-0627-001", startTime: "08:00", endTime: "08:47", duration: 47, actualTemp: 312, actualRpm: 248, output: 498, result: "정상" },
  { id: "PH-002", date: "2026-06-27", shift: "주간", product: "Sn96.5Ag3Cu0.5", lot: "LOT-0627-002", startTime: "09:00", endTime: "09:52", duration: 52, actualTemp: 341, actualRpm: 262, output: 302, result: "정상" },
  { id: "PH-003", date: "2026-06-27", shift: "주간", product: "Sn60Pb40",       lot: "LOT-0627-003", startTime: "10:05", endTime: "10:44", duration: 39, actualTemp: 298, actualRpm: 231, output: 748, result: "정상" },
  { id: "PH-004", date: "2026-06-27", shift: "주간", product: "Sn63Pb37",       lot: "LOT-0627-004", startTime: "11:00", endTime: "11:58", duration: 58, actualTemp: 338, actualRpm: 251, output: 451, result: "경고" },
  { id: "PH-005", date: "2026-06-26", shift: "야간", product: "Sn96.5Ag3Cu0.5", lot: "LOT-0626-005", startTime: "22:00", endTime: "22:51", duration: 51, actualTemp: 342, actualRpm: 259, output: 305, result: "정상" },
  { id: "PH-006", date: "2026-06-26", shift: "야간", product: "Sn60Pb40",       lot: "LOT-0626-006", startTime: "23:10", endTime: "23:55", duration: 45, actualTemp: 294, actualRpm: 228, output: 740, result: "정상" },
  { id: "PH-007", date: "2026-06-26", shift: "주간", product: "Sn63Pb37",       lot: "LOT-0626-007", startTime: "08:00", endTime: "08:45", duration: 45, actualTemp: 309, actualRpm: 245, output: 502, result: "정상" },
  { id: "PH-008", date: "2026-06-26", shift: "주간", product: "Sn99.3Cu0.7",    lot: "LOT-0626-008", startTime: "09:30", endTime: "10:28", duration: 58, actualTemp: 362, actualRpm: 272, output: 198, result: "이상" },
  { id: "PH-009", date: "2026-06-25", shift: "주간", product: "Sn63Pb37",       lot: "LOT-0625-009", startTime: "08:00", endTime: "08:43", duration: 43, actualTemp: 310, actualRpm: 246, output: 510, result: "정상" },
  { id: "PH-010", date: "2026-06-25", shift: "야간", product: "Sn96.5Ag3Cu0.5", lot: "LOT-0625-010", startTime: "21:00", endTime: "21:49", duration: 49, actualTemp: 339, actualRpm: 258, output: 298, result: "정상" },
];

const RESULT_MAP: Record<ProcessHistory["result"], { variant: "green" | "red" | "amber" }> = {
  정상: { variant: "green" },
  이상: { variant: "red"   },
  경고: { variant: "amber" },
};

const COLUMNS: Column<ProcessHistory>[] = [
  { key: "date",       header: "날짜",      width: 100 },
  { key: "shift",      header: "교대",      width: 70, align: "center", render: (v) => <span style={{ fontSize: 11.5, fontWeight: 600, color: v === "야간" ? "#6D28D9" : "#1D4ED8" }}>{v as string}</span> },
  { key: "product",    header: "제품",      width: 180 },
  { key: "lot",        header: "LOT번호",   width: 140 },
  { key: "startTime",  header: "시작",      width: 70,  align: "center" },
  { key: "endTime",    header: "종료",      width: 70,  align: "center" },
  { key: "duration",   header: "소요(분)",  width: 90,  align: "right", render: (v) => <span style={{ fontVariantNumeric: "tabular-nums" }}>{v as number}분</span> },
  { key: "actualTemp", header: "실제온도",  width: 90,  align: "right", render: (v) => <span style={{ fontVariantNumeric: "tabular-nums" }}>{v as number}°C</span> },
  { key: "actualRpm",  header: "실제RPM",   width: 90,  align: "right", render: (v) => <span style={{ fontVariantNumeric: "tabular-nums" }}>{v as number}</span> },
  { key: "output",     header: "생산량(kg)", width: 100, align: "right", render: (v) => <span style={{ fontVariantNumeric: "tabular-nums" }}>{(v as number).toLocaleString()}</span> },
  { key: "result",     header: "결과",      width: 80,  align: "center", render: (_, row) => <StatusBadge variant={RESULT_MAP[row.result].variant} label={row.result} dot /> },
];

const SHIFTS   = ["전체", "주간", "야간"];
const RESULTS  = ["전체", "정상", "경고", "이상"];
const PRODUCTS = ["전체", "Sn63Pb37", "Sn96.5Ag3Cu0.5", "Sn60Pb40", "Sn99.3Cu0.7"];

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ProcessHistoryPage() {
  const [shift,   setShift]   = useState("전체");
  const [result,  setResult]  = useState("전체");
  const [product, setProduct] = useState("전체");

  const filtered = MOCK_HISTORY.filter((r) => {
    if (shift   !== "전체" && r.shift   !== shift)   return false;
    if (result  !== "전체" && r.result  !== result)  return false;
    if (product !== "전체" && !r.product.startsWith(product)) return false;
    return true;
  });

  const totalOutput  = filtered.reduce((s, r) => s + r.output, 0);
  const avgDuration  = filtered.length ? Math.round(filtered.reduce((s, r) => s + r.duration, 0) / filtered.length) : 0;
  const anomalyCount = filtered.filter((r) => r.result !== "정상").length;

  const selectStyle = {
    padding: "6px 10px", fontSize: 12.5, border: "1px solid #E4E7EC",
    borderRadius: 7, background: "#fff", color: "#161B26", cursor: "pointer", outline: "none",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: "#161B26", margin: 0 }}>공정이력조회</h1>
        <p style={{ fontSize: 12.5, color: "#687182", margin: "4px 0 0" }}>기간별 공정 실행 이력 및 결과 조회</p>
      </div>

      {/* Summary */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
        {[
          { label: "조회 건수",   value: filtered.length,              unit: "건",  color: "#3A5BD9" },
          { label: "총 생산량",   value: totalOutput.toLocaleString(), unit: "kg",  color: "#16A34A" },
          { label: "평균 소요",   value: avgDuration,                  unit: "분",  color: "#7C3AED" },
          { label: "이상/경고",   value: anomalyCount,                 unit: "건",  color: anomalyCount > 0 ? "#DC2626" : "#16A34A" },
        ].map((s) => (
          <div key={s.label} className="card" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: "#687182", letterSpacing: "0.03em", textTransform: "uppercase" as const }}>{s.label}</span>
            <span style={{ fontSize: 24, fontWeight: 800, color: s.color, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
              {s.value}<span style={{ fontSize: 12, fontWeight: 500, color: "#9AA4B2", marginLeft: 3 }}>{s.unit}</span>
            </span>
          </div>
        ))}
      </div>

      {/* Filter + Table */}
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 16px", borderBottom: "1px solid #E4E7EC", flexWrap: "wrap" as const }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: "#161B26", flex: 1, minWidth: 100 }}>공정 이력</span>
          <label style={{ fontSize: 12, color: "#687182", display: "flex", alignItems: "center", gap: 6 }}>
            교대 <select style={selectStyle} value={shift} onChange={(e) => setShift(e.target.value)}>{SHIFTS.map((s) => <option key={s}>{s}</option>)}</select>
          </label>
          <label style={{ fontSize: 12, color: "#687182", display: "flex", alignItems: "center", gap: 6 }}>
            제품 <select style={selectStyle} value={product} onChange={(e) => setProduct(e.target.value)}>{PRODUCTS.map((p) => <option key={p}>{p}</option>)}</select>
          </label>
          <label style={{ fontSize: 12, color: "#687182", display: "flex", alignItems: "center", gap: 6 }}>
            결과 <select style={selectStyle} value={result} onChange={(e) => setResult(e.target.value)}>{RESULTS.map((r) => <option key={r}>{r}</option>)}</select>
          </label>
          <button style={{ padding: "5px 14px", fontSize: 12, fontWeight: 600, borderRadius: 6, border: "1px solid #E4E7EC", background: "#F8F9FB", color: "#687182", cursor: "pointer" }}>
            CSV 내보내기
          </button>
        </div>
        <DataTable columns={COLUMNS} data={filtered} rowKey={(r) => r.id} stickyHeader />
      </div>
    </div>
  );
}
