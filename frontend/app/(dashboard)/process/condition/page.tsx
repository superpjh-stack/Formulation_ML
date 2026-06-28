"use client";

import { useState } from "react";
import { DataTable, Column } from "@/components/ui/DataTable";
import { StatusBadge } from "@/components/ui/StatusBadge";

// ─── Mock Data ────────────────────────────────────────────────────────────────

interface WorkCondition {
  id: string;
  product: string;
  furnaceTemp: number;
  mixerRpm: number;
  coolTemp: number;
  moldPress: number;
  processTime: number;
  updatedAt: string;
  status: "적용중" | "대기" | "검토중";
}

const MOCK_CONDITIONS: WorkCondition[] = [
  { id: "WC-001", product: "Sn63Pb37 솔더합금",       furnaceTemp: 310, mixerRpm: 245, coolTemp: 40, moldPress: 8.0, processTime: 45, updatedAt: "2026-06-20", status: "적용중" },
  { id: "WC-002", product: "Sn96.5Ag3Cu0.5 솔더합금", furnaceTemp: 340, mixerRpm: 260, coolTemp: 35, moldPress: 8.5, processTime: 50, updatedAt: "2026-06-18", status: "적용중" },
  { id: "WC-003", product: "Sn60Pb40 솔더합금",        furnaceTemp: 295, mixerRpm: 230, coolTemp: 45, moldPress: 7.5, processTime: 42, updatedAt: "2026-06-15", status: "적용중" },
  { id: "WC-004", product: "Sn99.3Cu0.7 무연솔더",    furnaceTemp: 360, mixerRpm: 270, coolTemp: 30, moldPress: 9.0, processTime: 55, updatedAt: "2026-06-10", status: "대기" },
  { id: "WC-005", product: "Sn95.5Ag4Cu0.5 솔더합금", furnaceTemp: 345, mixerRpm: 255, coolTemp: 38, moldPress: 8.8, processTime: 52, updatedAt: "2026-06-01", status: "검토중" },
];

const STATUS_MAP: Record<WorkCondition["status"], { variant: "green" | "gray" | "amber" }> = {
  적용중: { variant: "green" },
  대기:   { variant: "gray"  },
  검토중: { variant: "amber" },
};

// ─── Edit Modal ───────────────────────────────────────────────────────────────

interface EditModalProps {
  condition: WorkCondition;
  onClose: () => void;
  onSave: (updated: WorkCondition) => void;
}

function EditModal({ condition, onClose, onSave }: EditModalProps) {
  const [form, setForm] = useState({ ...condition });

  function field(label: string, key: keyof WorkCondition, unit: string) {
    return (
      <div style={{ display: "flex", flexDirection: "column" as const, gap: 4 }}>
        <label style={{ fontSize: 12, fontWeight: 600, color: "#687182" }}>
          {label} <span style={{ color: "#9AA4B2" }}>({unit})</span>
        </label>
        <input
          type="number"
          value={form[key] as number}
          onChange={(e) => setForm((f) => ({ ...f, [key]: Number(e.target.value) }))}
          style={{
            padding: "8px 10px", fontSize: 13, border: "1px solid #E4E7EC",
            borderRadius: 7, outline: "none", color: "#161B26", fontVariantNumeric: "tabular-nums",
          }}
        />
      </div>
    );
  }

  return (
    <div
      style={{
        position: "fixed", inset: 0, background: "rgba(14,19,32,0.55)",
        display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          background: "#fff", borderRadius: 14, width: 520, maxWidth: "90vw",
          boxShadow: "0 20px 60px rgba(0,0,0,.18)", overflow: "hidden",
        }}
      >
        {/* Modal header */}
        <div style={{ padding: "16px 20px", borderBottom: "1px solid #E4E7EC", display: "flex", alignItems: "center" }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#161B26" }}>작업조건 편집</div>
            <div style={{ fontSize: 12, color: "#687182", marginTop: 2 }}>{form.product}</div>
          </div>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", cursor: "pointer", color: "#9AA4B2", fontSize: 18, lineHeight: 1 }}
          >
            ×
          </button>
        </div>

        {/* Form */}
        <div style={{ padding: "20px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          {field("용광로 온도",   "furnaceTemp",  "°C")}
          {field("교반기 RPM",   "mixerRpm",     "rpm")}
          {field("냉각 온도",    "coolTemp",     "°C")}
          {field("몰드 압력",    "moldPress",    "MPa")}
          {field("공정 시간",    "processTime",  "분")}
          <div style={{ display: "flex", flexDirection: "column" as const, gap: 4 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: "#687182" }}>상태</label>
            <select
              value={form.status}
              onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as WorkCondition["status"] }))}
              style={{ padding: "8px 10px", fontSize: 13, border: "1px solid #E4E7EC", borderRadius: 7, outline: "none", color: "#161B26" }}
            >
              <option>적용중</option>
              <option>대기</option>
              <option>검토중</option>
            </select>
          </div>
        </div>

        {/* Actions */}
        <div style={{ padding: "12px 20px 20px", display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button
            onClick={onClose}
            style={{ padding: "8px 18px", fontSize: 13, fontWeight: 600, borderRadius: 8, border: "1px solid #E4E7EC", background: "#fff", color: "#687182", cursor: "pointer" }}
          >
            취소
          </button>
          <button
            onClick={() => { onSave({ ...form, updatedAt: "2026-06-27" }); onClose(); }}
            style={{ padding: "8px 18px", fontSize: 13, fontWeight: 600, borderRadius: 8, border: "none", background: "#3A5BD9", color: "#fff", cursor: "pointer" }}
          >
            저장
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ProcessConditionPage() {
  const [conditions, setConditions] = useState(MOCK_CONDITIONS);
  const [editing, setEditing] = useState<WorkCondition | null>(null);

  const columns: Column<WorkCondition>[] = [
    { key: "id",          header: "조건 ID",    width: 90 },
    { key: "product",     header: "제품명",      width: 220 },
    { key: "furnaceTemp", header: "용광로 온도", width: 110, align: "right", render: (v) => <span style={{ fontVariantNumeric: "tabular-nums" }}>{v as number} °C</span> },
    { key: "mixerRpm",    header: "교반기 RPM",  width: 110, align: "right", render: (v) => <span style={{ fontVariantNumeric: "tabular-nums" }}>{v as number} rpm</span> },
    { key: "coolTemp",    header: "냉각 온도",   width: 100, align: "right", render: (v) => <span style={{ fontVariantNumeric: "tabular-nums" }}>{v as number} °C</span> },
    { key: "moldPress",   header: "몰드 압력",   width: 100, align: "right", render: (v) => <span style={{ fontVariantNumeric: "tabular-nums" }}>{v as number} MPa</span> },
    { key: "processTime", header: "공정 시간",   width: 100, align: "right", render: (v) => <span style={{ fontVariantNumeric: "tabular-nums" }}>{v as number} 분</span> },
    { key: "updatedAt",   header: "수정일",      width: 110 },
    { key: "status",      header: "상태",        width: 90,  align: "center", render: (_, row) => <StatusBadge variant={STATUS_MAP[row.status].variant} label={row.status} dot /> },
    {
      key: "id",
      header: "편집",
      width: 70,
      align: "center",
      render: (_, row) => (
        <button
          onClick={() => setEditing(row)}
          style={{
            padding: "3px 10px", fontSize: 11.5, fontWeight: 600, borderRadius: 6,
            border: "1px solid #C7D2F8", background: "#EEF1FD", color: "#1D4ED8", cursor: "pointer",
          }}
        >
          편집
        </button>
      ),
    },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: "#161B26", margin: 0 }}>작업조건관리</h1>
        <p style={{ fontSize: 12.5, color: "#687182", margin: "4px 0 0" }}>제품별 표준 공정 조건 설정 및 관리</p>
      </div>

      {/* Summary */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
        {[
          { label: "전체 조건",  value: conditions.length,                                         color: "#3A5BD9" },
          { label: "적용중",     value: conditions.filter((c) => c.status === "적용중").length,    color: "#16A34A" },
          { label: "검토/대기",  value: conditions.filter((c) => c.status !== "적용중").length,    color: "#F59E0B" },
        ].map((s) => (
          <div key={s.label} className="card" style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: s.color, flexShrink: 0 }} />
            <div>
              <div style={{ fontSize: 11, color: "#687182", fontWeight: 600, letterSpacing: "0.03em", textTransform: "uppercase" as const }}>{s.label}</div>
              <div style={{ fontSize: 24, fontWeight: 800, color: s.color, lineHeight: 1.2 }}>{s.value}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "14px 16px", borderBottom: "1px solid #E4E7EC", display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: "#161B26", flex: 1 }}>표준 작업조건 목록</span>
          <button style={{ padding: "5px 14px", fontSize: 12, fontWeight: 600, borderRadius: 6, border: "none", background: "#3A5BD9", color: "#fff", cursor: "pointer" }}>
            + 신규 조건 추가
          </button>
        </div>
        <DataTable columns={columns} data={conditions} rowKey={(r) => r.id} stickyHeader />
      </div>

      {editing && (
        <EditModal
          condition={editing}
          onClose={() => setEditing(null)}
          onSave={(updated) =>
            setConditions((prev) => prev.map((c) => (c.id === updated.id ? updated : c)))
          }
        />
      )}
    </div>
  );
}
