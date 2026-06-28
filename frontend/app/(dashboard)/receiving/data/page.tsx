"use client";

import { useState, useRef, useEffect } from "react";
import { DataTable, Column } from "@/components/ui/DataTable";

// ─── Mock Data ────────────────────────────────────────────────────────────────

interface StockItem {
  material: string;
  code: string;
  currentKg: number;
  optimalKg: number;
  unit: string;
  color: string;
}

const STOCK: StockItem[] = [
  { material: "SN 원료 (주석)", code: "SN", currentKg: 2450, optimalKg: 3000, unit: "kg", color: "#3A5BD9" },
  { material: "AG 원료 (은)",   code: "AG", currentKg: 125,  optimalKg: 200,  unit: "kg", color: "#7C3AED" },
  { material: "CU 원료 (구리)", code: "CU", currentKg: 85,   optimalKg: 150,  unit: "kg", color: "#D97706" },
  { material: "PB 원료 (납)",   code: "PB", currentKg: 340,  optimalKg: 400,  unit: "kg", color: "#687182" },
];

interface ReceivingRow {
  id: string;
  date: string;
  lot: string;
  material: string;
  supplier: string;
  qty: number;
  unit: string;
  unitPrice: number;
  total: number;
  inspector: string;
}

const MOCK_RECEIVING: ReceivingRow[] = [
  { id: "RC-0627-001", date: "2026-06-27", lot: "LOT-A-260001", material: "SN",  supplier: "SUP_A", qty: 500,  unit: "kg", unitPrice: 28500, total: 14250000, inspector: "김민준" },
  { id: "RC-0627-002", date: "2026-06-27", lot: "LOT-B-260001", material: "AG",  supplier: "SUP_B", qty: 30,   unit: "kg", unitPrice: 980000, total: 29400000, inspector: "이서연" },
  { id: "RC-0626-001", date: "2026-06-26", lot: "LOT-A-260002", material: "PB",  supplier: "SUP_A", qty: 200,  unit: "kg", unitPrice: 3200,  total: 640000,   inspector: "박지훈" },
  { id: "RC-0626-002", date: "2026-06-26", lot: "LOT-C-260001", material: "CU",  supplier: "SUP_C", qty: 50,   unit: "kg", unitPrice: 12400, total: 620000,   inspector: "김민준" },
  { id: "RC-0625-001", date: "2026-06-25", lot: "LOT-B-260002", material: "SN",  supplier: "SUP_B", qty: 600,  unit: "kg", unitPrice: 28500, total: 17100000, inspector: "이서연" },
  { id: "RC-0625-002", date: "2026-06-25", lot: "LOT-A-260003", material: "AG",  supplier: "SUP_A", qty: 25,   unit: "kg", unitPrice: 980000, total: 24500000, inspector: "박지훈" },
  { id: "RC-0624-001", date: "2026-06-24", lot: "LOT-D-260001", material: "PB",  supplier: "SUP_D", qty: 300,  unit: "kg", unitPrice: 3200,  total: 960000,   inspector: "김민준" },
  { id: "RC-0624-002", date: "2026-06-24", lot: "LOT-C-260002", material: "CU",  supplier: "SUP_C", qty: 80,   unit: "kg", unitPrice: 12400, total: 992000,   inspector: "이서연" },
  { id: "RC-0623-001", date: "2026-06-23", lot: "LOT-A-260004", material: "SN",  supplier: "SUP_A", qty: 450,  unit: "kg", unitPrice: 28500, total: 12825000, inspector: "박지훈" },
  { id: "RC-0623-002", date: "2026-06-23", lot: "LOT-B-260003", material: "AG",  supplier: "SUP_B", qty: 40,   unit: "kg", unitPrice: 980000, total: 39200000, inspector: "김민준" },
];

// Monthly bar chart data — 6 months, by material
const MONTHLY: { month: string; SN: number; AG: number; CU: number; PB: number }[] = [
  { month: "1월", SN: 1800, AG: 95,  CU: 60,  PB: 280 },
  { month: "2월", SN: 2100, AG: 110, CU: 70,  PB: 310 },
  { month: "3월", SN: 1950, AG: 100, CU: 65,  PB: 295 },
  { month: "4월", SN: 2300, AG: 120, CU: 80,  PB: 330 },
  { month: "5월", SN: 2200, AG: 115, CU: 75,  PB: 320 },
  { month: "6월", SN: 2450, AG: 125, CU: 85,  PB: 340 },
];

const MATERIAL_COLORS: Record<string, string> = {
  SN: "#3A5BD9",
  AG: "#7C3AED",
  CU: "#D97706",
  PB: "#687182",
};

// ─── Bar Chart (Canvas) ────────────────────────────────────────────────────────

function MonthlyBarChart() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const W = canvas.offsetWidth;
    const H = canvas.offsetHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.scale(dpr, dpr);

    const padL = 48, padR = 20, padT = 20, padB = 36;
    const chartW = W - padL - padR;
    const chartH = H - padT - padB;

    const materials = ["SN", "AG", "CU", "PB"] as const;
    // Normalize: SN is dominant; scale others up for visibility
    // We'll use separate y-axes conceptually — show SN on left scale
    const snMax = 3000;
    const months = MONTHLY.length;
    const groupW = chartW / months;
    const barCount = materials.length;
    const gap = 2;
    const barW = (groupW - (barCount + 1) * gap) / barCount;

    // Grid lines
    ctx.strokeStyle = "#F2F4F7";
    ctx.lineWidth = 1;
    for (let i = 0; i <= 5; i++) {
      const y = padT + (chartH / 5) * i;
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(padL + chartW, y);
      ctx.stroke();
      // y-axis labels (SN scale)
      const val = Math.round(snMax - (snMax / 5) * i);
      ctx.fillStyle = "#9AA4B2";
      ctx.font = `${10 * dpr / dpr}px system-ui`;
      ctx.textAlign = "right";
      ctx.fillText(val >= 1000 ? `${(val / 1000).toFixed(1)}k` : String(val), padL - 6, y + 3.5);
    }

    // Bars
    MONTHLY.forEach((d, mi) => {
      const groupX = padL + mi * groupW + gap;

      materials.forEach((mat, bi) => {
        const raw = d[mat];
        // Normalize all materials to SN scale for visual comparison
        const normalized = mat === "SN" ? raw : raw * (mat === "AG" ? 18 : mat === "CU" ? 25 : 6);
        const barH = Math.min((normalized / snMax) * chartH, chartH);
        const x = groupX + bi * (barW + gap);
        const y = padT + chartH - barH;

        ctx.beginPath();
        ctx.roundRect(x, y, barW, barH, [3, 3, 0, 0]);
        ctx.fillStyle = MATERIAL_COLORS[mat];
        ctx.globalAlpha = 0.85;
        ctx.fill();
        ctx.globalAlpha = 1;
      });

      // Month label
      ctx.fillStyle = "#687182";
      ctx.font = `${11 * dpr / dpr}px system-ui`;
      ctx.textAlign = "center";
      ctx.fillText(d.month, padL + mi * groupW + groupW / 2, padT + chartH + 20);
    });

    // Legend
    const legendY = 4;
    let lx = padL;
    materials.forEach((mat) => {
      ctx.beginPath();
      ctx.roundRect(lx, legendY, 10, 10, 2);
      ctx.fillStyle = MATERIAL_COLORS[mat];
      ctx.fill();
      ctx.fillStyle = "#687182";
      ctx.font = `${11 * dpr / dpr}px system-ui`;
      ctx.textAlign = "left";
      ctx.fillText(mat, lx + 13, legendY + 9);
      lx += 44;
    });
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: "100%", height: "100%", display: "block" }}
    />
  );
}

// ─── Progress Bar ──────────────────────────────────────────────────────────────

function StockProgressBar({ item }: { item: StockItem }) {
  const pct = Math.min(Math.round((item.currentKg / item.optimalKg) * 100), 100);
  const status = pct < 40 ? "critical" : pct < 70 ? "warn" : "ok";
  const barColor = status === "critical" ? "#DC2626" : status === "warn" ? "#D97706" : item.color;

  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: "#161B26" }}>{item.material}</span>
        {status === "critical" && (
          <span style={{ fontSize: 10.5, fontWeight: 700, color: "#DC2626", background: "#FEF1F2", padding: "1px 7px", borderRadius: 20 }}>재고 부족</span>
        )}
        {status === "warn" && (
          <span style={{ fontSize: 10.5, fontWeight: 700, color: "#B45309", background: "#FEF6E7", padding: "1px 7px", borderRadius: 20 }}>주의</span>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ flex: 1, height: 8, background: "#F2F4F7", borderRadius: 8, overflow: "hidden" }}>
          <div
            style={{
              width: `${pct}%`,
              height: "100%",
              background: barColor,
              borderRadius: 8,
              transition: "width 0.6s ease",
            }}
          />
        </div>
        <span style={{ fontSize: 11, fontWeight: 700, color: barColor, fontVariantNumeric: "tabular-nums", minWidth: 36, textAlign: "right" }}>
          {pct}%
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
        <span style={{ fontSize: 22, fontWeight: 800, color: "#161B26", fontVariantNumeric: "tabular-nums", letterSpacing: "-0.02em" }}>
          {item.currentKg.toLocaleString()}
        </span>
        <span style={{ fontSize: 12, color: "#9AA4B2" }}>/ {item.optimalKg.toLocaleString()} {item.unit}</span>
      </div>
    </div>
  );
}

// ─── Table columns ────────────────────────────────────────────────────────────

const COLUMNS: Column<ReceivingRow>[] = [
  { key: "date",     header: "입고일",   width: 110 },
  { key: "lot",      header: "LOT번호",  width: 140 },
  {
    key: "material",
    header: "원자재",
    width: 80,
    align: "center",
    render: (v) => {
      const mat = v as string;
      return (
        <span style={{
          display: "inline-block",
          padding: "2px 10px",
          borderRadius: 20,
          fontSize: 11.5,
          fontWeight: 700,
          background: `${MATERIAL_COLORS[mat]}18`,
          color: MATERIAL_COLORS[mat],
          letterSpacing: "0.02em",
        }}>
          {mat}
        </span>
      );
    },
  },
  { key: "supplier",  header: "공급사",  width: 90  },
  { key: "qty",       header: "수량(kg)", width: 90, align: "right",
    render: (v) => <span style={{ fontVariantNumeric: "tabular-nums" }}>{(v as number).toLocaleString()}</span> },
  { key: "unitPrice", header: "단가(원)", width: 110, align: "right",
    render: (v) => <span style={{ fontVariantNumeric: "tabular-nums" }}>{(v as number).toLocaleString()}</span> },
  { key: "total",     header: "합계(원)", width: 130, align: "right",
    render: (v) => <strong style={{ fontVariantNumeric: "tabular-nums", color: "#161B26" }}>{(v as number).toLocaleString()}</strong> },
  { key: "inspector", header: "검수자",   width: 90  },
];

// ─── Page ─────────────────────────────────────────────────────────────────────

const MATERIALS_FILTER = ["전체", "SN", "AG", "CU", "PB"];
const SUPPLIERS_FILTER = ["전체", "SUP_A", "SUP_B", "SUP_C", "SUP_D"];

const selectStyle: React.CSSProperties = {
  padding: "6px 10px", fontSize: 12.5, border: "1px solid #E4E7EC",
  borderRadius: 7, background: "#fff", color: "#161B26", cursor: "pointer", outline: "none",
};

export default function ReceivingDataPage() {
  const [materialFilter, setMaterialFilter] = useState("전체");
  const [supplierFilter, setSupplierFilter] = useState("전체");

  const filtered = MOCK_RECEIVING.filter((r) => {
    if (materialFilter !== "전체" && r.material !== materialFilter) return false;
    if (supplierFilter !== "전체" && r.supplier !== supplierFilter) return false;
    return true;
  });

  const totalAmount = filtered.reduce((a, r) => a + r.total, 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* Header */}
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: "#161B26", margin: 0 }}>입고 데이터 관리</h1>
        <p style={{ fontSize: 12.5, color: "#687182", margin: "4px 0 0" }}>원자재 재고 현황 및 입고 이력 관리</p>
      </div>

      {/* Stock cards */}
      <div>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#161B26", marginBottom: 12 }}>원자재 재고 현황</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
          {STOCK.map((item) => <StockProgressBar key={item.code} item={item} />)}
        </div>
      </div>

      {/* Bar chart */}
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "14px 16px", borderBottom: "1px solid #E4E7EC" }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: "#161B26" }}>원자재별 월별 입고량</span>
          <span style={{ fontSize: 11.5, color: "#9AA4B2", marginLeft: 8 }}>2026년 1~6월 · 단위: kg (SN 기준 스케일)</span>
        </div>
        <div style={{ padding: "16px", height: 200 }}>
          <MonthlyBarChart />
        </div>
      </div>

      {/* Table */}
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "14px 16px", borderBottom: "1px solid #E4E7EC", flexWrap: "wrap",
        }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: "#161B26", flex: 1, minWidth: 100 }}>
            입고 이력 <span style={{ fontWeight: 400, color: "#9AA4B2", fontSize: 12 }}>({filtered.length}건)</span>
          </span>
          <label style={{ fontSize: 12, color: "#687182", display: "flex", alignItems: "center", gap: 6 }}>
            원자재
            <select style={selectStyle} value={materialFilter} onChange={(e) => setMaterialFilter(e.target.value)}>
              {MATERIALS_FILTER.map((m) => <option key={m}>{m}</option>)}
            </select>
          </label>
          <label style={{ fontSize: 12, color: "#687182", display: "flex", alignItems: "center", gap: 6 }}>
            공급사
            <select style={selectStyle} value={supplierFilter} onChange={(e) => setSupplierFilter(e.target.value)}>
              {SUPPLIERS_FILTER.map((s) => <option key={s}>{s}</option>)}
            </select>
          </label>
          <button style={{
            padding: "5px 14px", fontSize: 12, fontWeight: 600, borderRadius: 6,
            border: "1px solid #E4E7EC", background: "#F8F9FB", color: "#687182", cursor: "pointer",
          }}>
            CSV 내보내기
          </button>
        </div>
        <DataTable columns={COLUMNS} data={filtered} rowKey={(r) => r.id} stickyHeader />
        <div style={{
          padding: "10px 16px", borderTop: "1px solid #F2F4F7",
          display: "flex", alignItems: "center", gap: 20,
        }}>
          <span style={{ fontSize: 11.5, color: "#687182" }}>
            총 입고금액 <strong style={{ color: "#3A5BD9", fontVariantNumeric: "tabular-nums" }}>
              {totalAmount.toLocaleString()}원
            </strong>
          </span>
        </div>
      </div>
    </div>
  );
}
