"use client";

import { useState } from "react";
import { KpiCard } from "@/components/ui/KpiCard";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { DataTable, Column } from "@/components/ui/DataTable";

const SUPPLIERS = ["SUP_A", "SUP_B", "SUP_C", "SUP_D"];

interface MeasurementRow {
  id: string;
  lot: string;
  datetime: string;
  sn_pct: number;
  ag_pct: number;
  cu_pct: number;
  pb_pct: number;
  supplier: string;
  operator: string;
  status: "정상" | "이상치" | "검토중";
}

const INITIAL_DATA: MeasurementRow[] = [
  { id: "M-001", lot: "LOT-2026-0627", datetime: "2026-06-27 08:12", sn_pct: 62.1, ag_pct: 3.02, cu_pct: 0.50, pb_pct: 34.38, supplier: "SUP_A", operator: "김철수", status: "정상" },
  { id: "M-002", lot: "LOT-2026-0626", datetime: "2026-06-27 07:45", sn_pct: 61.8, ag_pct: 3.15, cu_pct: 0.51, pb_pct: 34.54, supplier: "SUP_B", operator: "이영희", status: "정상" },
  { id: "M-003", lot: "LOT-2026-0625", datetime: "2026-06-27 07:30", sn_pct: 65.2, ag_pct: 2.60, cu_pct: 0.58, pb_pct: 31.62, supplier: "SUP_A", operator: "박민준", status: "이상치" },
  { id: "M-004", lot: "LOT-2026-0624", datetime: "2026-06-27 06:55", sn_pct: 62.0, ag_pct: 3.00, cu_pct: 0.50, pb_pct: 34.50, supplier: "SUP_C", operator: "정수현", status: "정상" },
  { id: "M-005", lot: "LOT-2026-0623", datetime: "2026-06-27 06:40", sn_pct: 62.3, ag_pct: 2.95, cu_pct: 0.49, pb_pct: 34.26, supplier: "SUP_D", operator: "최지원", status: "정상" },
  { id: "M-006", lot: "LOT-2026-0622", datetime: "2026-06-26 17:10", sn_pct: 61.9, ag_pct: 3.08, cu_pct: 0.50, pb_pct: 34.52, supplier: "SUP_B", operator: "김철수", status: "정상" },
  { id: "M-007", lot: "LOT-2026-0621", datetime: "2026-06-26 16:35", sn_pct: 63.5, ag_pct: 2.80, cu_pct: 0.53, pb_pct: 33.17, supplier: "SUP_A", operator: "이영희", status: "검토중" },
  { id: "M-008", lot: "LOT-2026-0620", datetime: "2026-06-26 15:50", sn_pct: 62.2, ag_pct: 3.01, cu_pct: 0.50, pb_pct: 34.29, supplier: "SUP_C", operator: "박민준", status: "정상" },
];

const WEEKLY_SPARKLINE = [5, 6, 7, 6, 8, 8, 42].map((v) => ({ value: v }));

interface FormData {
  lot: string;
  sn_pct: string;
  ag_pct: string;
  cu_pct: string;
  pb_pct: string;
  supplier: string;
  operator: string;
}

const EMPTY_FORM: FormData = {
  lot: "",
  sn_pct: "62.0",
  ag_pct: "3.0",
  cu_pct: "0.5",
  pb_pct: "34.5",
  supplier: "SUP_A",
  operator: "",
};

function NumericField({
  label,
  value,
  onChange,
  unit = "%",
  min,
  max,
  step = "0.01",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  unit?: string;
  min?: string;
  max?: string;
  step?: string;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <label style={{ fontSize: 12, fontWeight: 600, color: "#687182", letterSpacing: "0.02em" }}>
        {label}
      </label>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(e) => onChange(e.target.value)}
          style={{
            flex: 1,
            padding: "8px 10px",
            fontSize: 13,
            fontWeight: 600,
            color: "#161B26",
            border: "1px solid #E4E7EC",
            borderRadius: 8,
            outline: "none",
            fontVariantNumeric: "tabular-nums",
          }}
        />
        <span style={{ fontSize: 12, color: "#9AA4B2", minWidth: 20 }}>{unit}</span>
      </div>
    </div>
  );
}

const STATUS_CONFIG: Record<MeasurementRow["status"], { variant: "green" | "red" | "amber" }> = {
  정상: { variant: "green" },
  이상치: { variant: "red" },
  검토중: { variant: "amber" },
};

function PctCell({ value }: { value: number }) {
  return (
    <span style={{ fontVariantNumeric: "tabular-nums" }}>{value.toFixed(2)}%</span>
  );
}

export default function CollectPage() {
  const [rows, setRows] = useState<MeasurementRow[]>(INITIAL_DATA);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<FormData>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const today = rows.filter((r) => r.datetime.startsWith("2026-06-27")).length;
  const anomalies = rows.filter((r) => r.status === "이상치").length;

  function setField<K extends keyof FormData>(key: K, val: FormData[K]) {
    setForm((prev) => ({ ...prev, [key]: val }));
  }

  function handleSave() {
    setSaving(true);
    setTimeout(() => {
      const total =
        parseFloat(form.sn_pct) +
        parseFloat(form.ag_pct) +
        parseFloat(form.cu_pct) +
        parseFloat(form.pb_pct);

      const isAnomaly =
        Math.abs(parseFloat(form.sn_pct) - 62.0) > 3 ||
        Math.abs(parseFloat(form.ag_pct) - 3.0) > 0.5 ||
        Math.abs(total - 100) > 1;

      const newRow: MeasurementRow = {
        id: `M-${String(rows.length + 1).padStart(3, "0")}`,
        lot: form.lot || `LOT-2026-${String(Date.now()).slice(-4)}`,
        datetime: new Date().toLocaleString("sv-SE").replace("T", " ").slice(0, 16),
        sn_pct: parseFloat(form.sn_pct),
        ag_pct: parseFloat(form.ag_pct),
        cu_pct: parseFloat(form.cu_pct),
        pb_pct: parseFloat(form.pb_pct),
        supplier: form.supplier,
        operator: form.operator || "미상",
        status: isAnomaly ? "이상치" : "정상",
      };
      setRows((prev) => [newRow, ...prev]);
      setModalOpen(false);
      setForm(EMPTY_FORM);
      setSaving(false);
    }, 800);
  }

  const COLUMNS: Column<MeasurementRow>[] = [
    { key: "id",       header: "ID",       width: 80 },
    { key: "lot",      header: "LOT번호",   width: 150 },
    { key: "datetime", header: "측정일시",  width: 140 },
    { key: "sn_pct",   header: "SN%",      width: 80,  align: "right", render: (_, r) => <PctCell value={r.sn_pct} /> },
    { key: "ag_pct",   header: "AG%",      width: 80,  align: "right", render: (_, r) => <PctCell value={r.ag_pct} /> },
    { key: "cu_pct",   header: "CU%",      width: 80,  align: "right", render: (_, r) => <PctCell value={r.cu_pct} /> },
    { key: "pb_pct",   header: "PB%",      width: 80,  align: "right", render: (_, r) => <PctCell value={r.pb_pct} /> },
    { key: "supplier", header: "공급사",    width: 80 },
    { key: "operator", header: "측정자",    width: 80 },
    {
      key: "status",
      header: "상태",
      width: 90,
      align: "center",
      render: (_, r) => (
        <StatusBadge
          variant={STATUS_CONFIG[r.status].variant}
          label={r.status}
          dot
        />
      ),
    },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: "#161B26", margin: 0, lineHeight: 1.3 }}>
            성분데이터 수집 · 관리
          </h1>
          <p style={{ fontSize: 12.5, color: "#687182", margin: "4px 0 0" }}>
            LOT별 성분 측정값 입력 및 이상치 관리
          </p>
        </div>
        <button
          className="btn pri"
          onClick={() => { setForm(EMPTY_FORM); setModalOpen(true); }}
          style={{ flexShrink: 0 }}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M7 1v12M1 7h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          새 측정값 입력
        </button>
      </div>

      {/* KPI cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
        <KpiCard
          label="오늘 측정"
          value={today}
          unit="건"
          trend="up"
          trendValue="+3건"
          sparkline={[5, 6, 4, 7, 6, 5, today].map((v) => ({ value: v }))}
          accentColor="#3A5BD9"
        />
        <KpiCard
          label="이번 주 누적"
          value={42}
          unit="건"
          trend="up"
          trendValue="+8건"
          sparkline={WEEKLY_SPARKLINE}
          accentColor="#16A34A"
        />
        <KpiCard
          label="이상치 감지"
          value={anomalies}
          unit="건"
          trend={anomalies > 0 ? "down" : "neutral"}
          trendValue={anomalies > 0 ? "검토 필요" : "이상 없음"}
          sparkline={[0, 1, 0, 0, 1, 0, anomalies].map((v) => ({ value: v }))}
          accentColor="#DC2626"
        />
      </div>

      {/* Table */}
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "14px 16px",
            borderBottom: "1px solid #E4E7EC",
          }}
        >
          <span style={{ fontSize: 13, fontWeight: 700, color: "#161B26", flex: 1 }}>
            최근 수집 데이터
          </span>
          <span style={{ fontSize: 11.5, color: "#9AA4B2" }}>
            총 {rows.length}건
          </span>
          <button className="btn" style={{ fontSize: 11.5, padding: "5px 12px" }}>
            내보내기
          </button>
        </div>
        <DataTable
          columns={COLUMNS}
          data={rows}
          rowKey={(r) => r.id}
          stickyHeader
        />
      </div>

      {/* Modal overlay */}
      {modalOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(14, 19, 32, 0.5)",
            zIndex: 100,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
          }}
          onClick={(e) => { if (e.target === e.currentTarget) setModalOpen(false); }}
        >
          <div
            style={{
              background: "#fff",
              borderRadius: 16,
              width: "100%",
              maxWidth: 520,
              boxShadow: "0 20px 60px rgba(14,19,32,0.2)",
              display: "flex",
              flexDirection: "column",
              gap: 0,
              overflow: "hidden",
            }}
          >
            {/* Modal header */}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "18px 24px",
                borderBottom: "1px solid #E4E7EC",
              }}
            >
              <span style={{ fontSize: 15, fontWeight: 700, color: "#161B26" }}>
                새 측정값 입력
              </span>
              <button
                onClick={() => setModalOpen(false)}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: "#9AA4B2",
                  fontSize: 20,
                  lineHeight: 1,
                  padding: 4,
                }}
              >
                ×
              </button>
            </div>

            {/* Modal body */}
            <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
              {/* LOT number */}
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: "#687182" }}>LOT번호</label>
                <input
                  type="text"
                  value={form.lot}
                  onChange={(e) => setField("lot", e.target.value)}
                  placeholder="예: LOT-2026-0628"
                  style={{
                    padding: "8px 12px",
                    fontSize: 13,
                    color: "#161B26",
                    border: "1px solid #E4E7EC",
                    borderRadius: 8,
                    outline: "none",
                  }}
                />
              </div>

              {/* Component inputs 2x2 */}
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#687182", marginBottom: 10 }}>
                  성분 비율
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <NumericField label="SN (주석)" value={form.sn_pct} onChange={(v) => setField("sn_pct", v)} min="50" max="75" />
                  <NumericField label="AG (은)" value={form.ag_pct} onChange={(v) => setField("ag_pct", v)} min="0" max="10" />
                  <NumericField label="CU (구리)" value={form.cu_pct} onChange={(v) => setField("cu_pct", v)} min="0" max="3" step="0.01" />
                  <NumericField label="PB (납)" value={form.pb_pct} onChange={(v) => setField("pb_pct", v)} min="20" max="50" />
                </div>
                {/* Total indicator */}
                <div style={{ marginTop: 8 }}>
                  {(() => {
                    const t = parseFloat(form.sn_pct) + parseFloat(form.ag_pct) + parseFloat(form.cu_pct) + parseFloat(form.pb_pct);
                    const ok = Math.abs(t - 100) < 0.5;
                    const warn = Math.abs(t - 100) >= 0.5 && Math.abs(t - 100) < 2;
                    return (
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div style={{ flex: 1, height: 4, background: "#F2F4F7", borderRadius: 2, overflow: "hidden" }}>
                          <div
                            style={{
                              height: "100%",
                              width: `${Math.min(t, 100)}%`,
                              background: ok ? "#16A34A" : warn ? "#D97706" : "#DC2626",
                              borderRadius: 2,
                              transition: "width 0.2s",
                            }}
                          />
                        </div>
                        <span style={{ fontSize: 12, fontWeight: 700, color: ok ? "#16A34A" : warn ? "#D97706" : "#DC2626", fontVariantNumeric: "tabular-nums", minWidth: 64 }}>
                          합계 {isNaN(t) ? "—" : t.toFixed(1)}%
                        </span>
                      </div>
                    );
                  })()}
                </div>
              </div>

              {/* Supplier + operator */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: "#687182" }}>공급사</label>
                  <select
                    value={form.supplier}
                    onChange={(e) => setField("supplier", e.target.value)}
                    style={{
                      padding: "8px 10px",
                      fontSize: 13,
                      fontWeight: 600,
                      color: "#161B26",
                      border: "1px solid #E4E7EC",
                      borderRadius: 8,
                      background: "#fff",
                      outline: "none",
                      cursor: "pointer",
                    }}
                  >
                    {SUPPLIERS.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: "#687182" }}>측정자</label>
                  <input
                    type="text"
                    value={form.operator}
                    onChange={(e) => setField("operator", e.target.value)}
                    placeholder="예: 김철수"
                    style={{
                      padding: "8px 12px",
                      fontSize: 13,
                      color: "#161B26",
                      border: "1px solid #E4E7EC",
                      borderRadius: 8,
                      outline: "none",
                    }}
                  />
                </div>
              </div>
            </div>

            {/* Modal footer */}
            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: 10,
                padding: "16px 24px",
                borderTop: "1px solid #E4E7EC",
                background: "#F8F9FB",
              }}
            >
              <button className="btn" onClick={() => setModalOpen(false)}>
                취소
              </button>
              <button
                className="btn pri"
                onClick={handleSave}
                disabled={saving}
                style={{ minWidth: 80, justifyContent: "center" }}
              >
                {saving ? (
                  <span
                    style={{
                      width: 13,
                      height: 13,
                      border: "2px solid rgba(255,255,255,0.3)",
                      borderTopColor: "#fff",
                      borderRadius: "50%",
                      display: "inline-block",
                      animation: "spin 0.7s linear infinite",
                    }}
                  />
                ) : (
                  "저장"
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
