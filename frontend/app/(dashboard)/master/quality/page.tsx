"use client";

import { useState } from "react";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { DataTable, Column } from "@/components/ui/DataTable";

interface QualityStd {
  id: string;
  product: string;
  spec: string;
  snMin: number;
  snMax: number;
  agMin: number;
  agMax: number;
  cuMin: number;
  cuMax: number;
  pbMin: number;
  pbMax: number;
  weightTol: number;
  qualityMin: number;
  updatedAt: string;
  status: "적용중" | "검토중" | "폐기";
}

const MOCK_STANDARDS: QualityStd[] = [
  { id: "QS-001", product: "Sn63Pb37",        spec: "IPC J-STD-006",  snMin: 62.5, snMax: 63.5, agMin: 0,   agMax: 0,   cuMin: 0,   cuMax: 0,   pbMin: 36.5, pbMax: 37.5, weightTol: 0.2, qualityMin: 80, updatedAt: "2026-03-01", status: "적용중" },
  { id: "QS-002", product: "Sn96.5Ag3Cu0.5",  spec: "IPC J-STD-006",  snMin: 96.2, snMax: 96.8, agMin: 2.9, agMax: 3.1, cuMin: 0.45, cuMax: 0.55, pbMin: 0,   pbMax: 0.1,  weightTol: 0.1, qualityMin: 85, updatedAt: "2026-03-01", status: "적용중" },
  { id: "QS-003", product: "Sn60Pb40",         spec: "IPC J-STD-006",  snMin: 59.5, snMax: 60.5, agMin: 0,   agMax: 0,   cuMin: 0,   cuMax: 0,   pbMin: 39.5, pbMax: 40.5, weightTol: 0.2, qualityMin: 78, updatedAt: "2026-03-01", status: "적용중" },
  { id: "QS-004", product: "Sn62Pb36Ag2",      spec: "IPC J-STD-006",  snMin: 61.5, snMax: 62.5, agMin: 1.8, agMax: 2.2, cuMin: 0,   cuMax: 0,   pbMin: 35.5, pbMax: 36.5, weightTol: 0.2, qualityMin: 82, updatedAt: "2026-01-15", status: "적용중" },
  { id: "QS-005", product: "Sn95.5Ag3.8Cu0.7", spec: "IPC J-STD-006", snMin: 95.0, snMax: 96.0, agMin: 3.6, agMax: 4.0, cuMin: 0.65, cuMax: 0.75, pbMin: 0,   pbMax: 0.1,  weightTol: 0.1, qualityMin: 88, updatedAt: "2026-05-10", status: "검토중" },
  { id: "QS-006", product: "Sn50Pb50 (구)",    spec: "사내 기준",       snMin: 49.5, snMax: 50.5, agMin: 0,   agMax: 0,   cuMin: 0,   cuMax: 0,   pbMin: 49.5, pbMax: 50.5, weightTol: 0.3, qualityMin: 70, updatedAt: "2025-06-01", status: "폐기" },
];

const STATUS_V: Record<QualityStd["status"], "green" | "amber" | "gray"> = {
  적용중: "green",
  검토중: "amber",
  폐기:   "gray",
};

const COLUMNS: Column<QualityStd>[] = [
  { key: "product",    header: "제품명",     width: 180 },
  { key: "spec",       header: "규격",       width: 130 },
  { key: "snMin",      header: "Sn 최소(%)", width: 90, align: "right" },
  { key: "snMax",      header: "Sn 최대(%)", width: 90, align: "right" },
  { key: "agMin",      header: "Ag 최소(%)", width: 90, align: "right" },
  { key: "agMax",      header: "Ag 최대(%)", width: 90, align: "right" },
  { key: "cuMin",      header: "Cu 최소(%)", width: 90, align: "right" },
  { key: "cuMax",      header: "Cu 최대(%)", width: 90, align: "right" },
  { key: "weightTol",  header: "중량허용(kg)", width: 100, align: "right" },
  { key: "qualityMin", header: "품질점수 최소", width: 110, align: "right" },
  { key: "updatedAt",  header: "개정일",     width: 100 },
  {
    key: "status",
    header: "상태",
    width: 85,
    align: "center",
    render: (_, row) => <StatusBadge variant={STATUS_V[row.status]} label={row.status} dot />,
  },
  {
    key: "id",
    header: "액션",
    width: 110,
    align: "center",
    render: () => (
      <div style={{ display: "flex", gap: 5, justifyContent: "center" }}>
        <button style={{ padding: "3px 8px", fontSize: 11.5, fontWeight: 600, borderRadius: 5, border: "1px solid #E4E7EC", background: "#fff", color: "#3A5BD9", cursor: "pointer" }}>수정</button>
        <button style={{ padding: "3px 8px", fontSize: 11.5, fontWeight: 600, borderRadius: 5, border: "1px solid #FEF1F2", background: "#FEF1F2", color: "#B91C1C", cursor: "pointer" }}>폐기</button>
      </div>
    ),
  },
];

export default function QualityMasterPage() {
  const [filter, setFilter] = useState<"전체" | QualityStd["status"]>("전체");
  const data = filter === "전체" ? MOCK_STANDARDS : MOCK_STANDARDS.filter((s) => s.status === filter);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: "#161B26", margin: 0 }}>품질기준 관리</h1>
          <p style={{ fontSize: 12.5, color: "#687182", margin: "4px 0 0" }}>제품별 성분 범위 및 품질 허용 기준 관리</p>
        </div>
        <button style={{ padding: "8px 18px", fontSize: 13, fontWeight: 600, borderRadius: 8, border: "none", background: "#3A5BD9", color: "#fff", cursor: "pointer" }}>
          + 기준 추가
        </button>
      </div>

      {/* Summary cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14 }}>
        {[
          { label: "적용중 기준",  value: MOCK_STANDARDS.filter(s => s.status === "적용중").length, color: "#15803D", bg: "#ECFDF3" },
          { label: "검토중",       value: MOCK_STANDARDS.filter(s => s.status === "검토중").length, color: "#B45309", bg: "#FEF6E7" },
          { label: "폐기",         value: MOCK_STANDARDS.filter(s => s.status === "폐기").length,   color: "#5B6573", bg: "#F2F4F7" },
        ].map((s) => (
          <div key={s.label} className="card" style={{ padding: "14px 16px", borderLeft: `3px solid ${s.color}` }}>
            <div style={{ fontSize: 11.5, fontWeight: 600, color: "#687182", letterSpacing: "0.03em", textTransform: "uppercase", marginBottom: 6 }}>{s.label}</div>
            <div style={{ fontSize: 28, fontWeight: 800, color: s.color, fontVariantNumeric: "tabular-nums" }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Key targets callout */}
      <div className="card" style={{ background: "#EEF1FD", border: "1px solid #C7D2FE" }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "#3A5BD9", marginBottom: 10 }}>피처 목표값 (engineering.py 기준)</div>
        <div style={{ display: "flex", gap: 24 }}>
          {[
            { element: "SN_TARGET", value: "62.0%", desc: "Sn 함량 목표" },
            { element: "AG_TARGET", value: "3.0%",  desc: "Ag 함량 목표" },
            { element: "CU_TARGET", value: "0.5%",  desc: "Cu 함량 목표" },
          ].map((t) => (
            <div key={t.element} style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <code style={{ fontFamily: "monospace", fontSize: 12, background: "#fff", padding: "2px 8px", borderRadius: 5, color: "#3A5BD9", fontWeight: 700 }}>{t.element}</code>
              <span style={{ fontSize: 14, fontWeight: 800, color: "#161B26", fontVariantNumeric: "tabular-nums" }}>{t.value}</span>
              <span style={{ fontSize: 12, color: "#687182" }}>{t.desc}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "14px 16px", borderBottom: "1px solid #E4E7EC" }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: "#161B26", flex: 1 }}>품질기준 목록</span>
          {(["전체", "적용중", "검토중", "폐기"] as const).map((f) => (
            <button key={f} onClick={() => setFilter(f)} style={{ padding: "4px 12px", fontSize: 12, fontWeight: 600, borderRadius: 20, border: "1px solid", cursor: "pointer", borderColor: filter === f ? "#3A5BD9" : "#E4E7EC", background: filter === f ? "#3A5BD9" : "#fff", color: filter === f ? "#fff" : "#687182" }}>{f}</button>
          ))}
        </div>
        <DataTable columns={COLUMNS} data={data} rowKey={(r) => r.id} stickyHeader />
      </div>
    </div>
  );
}
