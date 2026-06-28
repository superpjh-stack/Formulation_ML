"use client";

import { useState, useRef, useEffect } from "react";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { DataTable, Column } from "@/components/ui/DataTable";

const SN_TARGET = 62.0;
const AG_TARGET = 3.0;
const CU_TARGET = 0.5;
const WARN_PCT = 5;
const CAUTION_PCT = 3;

// ── Mock data ──────────────────────────────────────────────────────────────

interface LotRow {
  lot: string;
  date: string;
  sn_actual: number;
  sn_dev: number;
  ag_actual: number;
  ag_dev: number;
  cu_actual: number;
  cu_dev: number;
  verdict: "정상" | "주의" | "경고";
}

const MOCK_LOTS: LotRow[] = [
  { lot: "LOT-2026-0601", date: "2026-06-01", sn_actual: 62.3, sn_dev: 0.3, ag_actual: 2.95, ag_dev: -0.05, cu_actual: 0.51, cu_dev: 0.01, verdict: "정상" },
  { lot: "LOT-2026-0602", date: "2026-06-02", sn_actual: 61.8, sn_dev: -0.2, ag_actual: 3.05, ag_dev: 0.05, cu_actual: 0.50, cu_dev: 0.00, verdict: "정상" },
  { lot: "LOT-2026-0603", date: "2026-06-03", sn_actual: 63.1, sn_dev: 1.1, ag_actual: 2.88, ag_dev: -0.12, cu_actual: 0.52, cu_dev: 0.02, verdict: "정상" },
  { lot: "LOT-2026-0604", date: "2026-06-04", sn_actual: 63.8, sn_dev: 1.8, ag_actual: 2.80, ag_dev: -0.20, cu_actual: 0.53, cu_dev: 0.03, verdict: "주의" },
  { lot: "LOT-2026-0605", date: "2026-06-05", sn_actual: 62.1, sn_dev: 0.1, ag_actual: 3.10, ag_dev: 0.10, cu_actual: 0.49, cu_dev: -0.01, verdict: "정상" },
  { lot: "LOT-2026-0606", date: "2026-06-06", sn_actual: 61.5, sn_dev: -0.5, ag_actual: 3.20, ag_dev: 0.20, cu_actual: 0.50, cu_dev: 0.00, verdict: "정상" },
  { lot: "LOT-2026-0607", date: "2026-06-07", sn_actual: 64.1, sn_dev: 2.1, ag_actual: 2.75, ag_dev: -0.25, cu_actual: 0.55, cu_dev: 0.05, verdict: "주의" },
  { lot: "LOT-2026-0608", date: "2026-06-08", sn_actual: 62.5, sn_dev: 0.5, ag_actual: 3.00, ag_dev: 0.00, cu_actual: 0.50, cu_dev: 0.00, verdict: "정상" },
  { lot: "LOT-2026-0609", date: "2026-06-09", sn_actual: 65.1, sn_dev: 3.1, ag_actual: 2.65, ag_dev: -0.35, cu_actual: 0.58, cu_dev: 0.08, verdict: "경고" },
  { lot: "LOT-2026-0610", date: "2026-06-10", sn_actual: 61.9, sn_dev: -0.1, ag_actual: 3.08, ag_dev: 0.08, cu_actual: 0.50, cu_dev: 0.00, verdict: "정상" },
  { lot: "LOT-2026-0611", date: "2026-06-11", sn_actual: 62.8, sn_dev: 0.8, ag_actual: 2.92, ag_dev: -0.08, cu_actual: 0.51, cu_dev: 0.01, verdict: "정상" },
  { lot: "LOT-2026-0612", date: "2026-06-12", sn_actual: 62.0, sn_dev: 0.0, ag_actual: 3.02, ag_dev: 0.02, cu_actual: 0.50, cu_dev: 0.00, verdict: "정상" },
  { lot: "LOT-2026-0613", date: "2026-06-13", sn_actual: 63.4, sn_dev: 1.4, ag_actual: 2.82, ag_dev: -0.18, cu_actual: 0.52, cu_dev: 0.02, verdict: "정상" },
  { lot: "LOT-2026-0614", date: "2026-06-14", sn_actual: 61.6, sn_dev: -0.4, ag_actual: 3.15, ag_dev: 0.15, cu_actual: 0.49, cu_dev: -0.01, verdict: "정상" },
  { lot: "LOT-2026-0615", date: "2026-06-15", sn_actual: 62.2, sn_dev: 0.2, ag_actual: 2.98, ag_dev: -0.02, cu_actual: 0.50, cu_dev: 0.00, verdict: "정상" },
];

// 30-day sparkline data for each element
const TREND_DATA = {
  sn: [0.3, -0.2, 1.1, 1.8, 0.1, -0.5, 2.1, 0.5, 3.1, -0.1, 0.8, 0.0, 1.4, -0.4, 0.2, 0.6, -0.3, 1.2, 0.9, -0.6, 1.5, 0.4, -0.8, 1.1, 0.7, -0.2, 0.5, 1.8, 0.3, 0.1],
  ag: [-0.05, 0.05, -0.12, -0.20, 0.10, 0.20, -0.25, 0.00, -0.35, 0.08, -0.08, 0.02, -0.18, 0.15, -0.02, 0.12, -0.10, 0.05, -0.22, 0.18, -0.08, 0.03, 0.22, -0.15, 0.07, -0.03, 0.10, -0.20, 0.05, -0.01],
  cu: [0.01, 0.00, 0.02, 0.03, -0.01, 0.00, 0.05, 0.00, 0.08, 0.00, 0.01, 0.00, 0.02, -0.01, 0.00, 0.01, -0.02, 0.03, 0.00, -0.01, 0.04, 0.01, -0.02, 0.02, 0.00, 0.01, -0.01, 0.03, 0.01, 0.00],
};

function TrendChart({
  snData,
  agData,
  cuData,
}: {
  snData: number[];
  agData: number[];
  cuData: number[];
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const W = canvas.offsetWidth || 600;
    const H = 200;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.scale(dpr, dpr);

    const padL = 40;
    const padR = 20;
    const padT = 20;
    const padB = 30;
    const chartW = W - padL - padR;
    const chartH = H - padT - padB;

    const allVals = [...snData, ...agData];
    const minV = Math.min(...allVals) - 0.5;
    const maxV = Math.max(...allVals) + 0.5;
    const range = maxV - minV || 1;

    const px = (i: number) => padL + (i / (snData.length - 1)) * chartW;
    const py = (v: number) => padT + chartH - ((v - minV) / range) * chartH;

    // Grid lines
    for (let g = 0; g <= 4; g++) {
      const y = padT + (g / 4) * chartH;
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(padL + chartW, y);
      ctx.strokeStyle = "#F2F4F7";
      ctx.lineWidth = 1;
      ctx.stroke();
      const val = maxV - (g / 4) * range;
      ctx.fillStyle = "#9AA4B2";
      ctx.font = "10px -apple-system, sans-serif";
      ctx.textAlign = "right";
      ctx.fillText(val.toFixed(1), padL - 6, y + 3);
    }

    // Warning threshold lines ±5%
    const warnY5pos = py(0.15); // ~5% of 3.0 SN scale
    const warnY5neg = py(-0.15);
    [warnY5pos, warnY5neg].forEach((wy) => {
      ctx.save();
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(padL, wy);
      ctx.lineTo(padL + chartW, wy);
      ctx.strokeStyle = "#FCA5A5";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
    });
    ctx.fillStyle = "#FCA5A5";
    ctx.font = "9px -apple-system, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText("경고 ±5%", padL + 4, warnY5pos - 3);

    // Draw lines
    const series = [
      { data: snData, color: "#3A5BD9", label: "SN" },
      { data: agData, color: "#16A34A", label: "AG" },
      { data: cuData.map((v) => v * 10), color: "#D97706", label: "CU×10" },
    ];

    series.forEach(({ data, color }) => {
      ctx.beginPath();
      data.forEach((v, i) => {
        const x = px(i);
        const y = py(v);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Last point dot
      const lastX = px(data.length - 1);
      const lastY = py(data[data.length - 1]);
      ctx.beginPath();
      ctx.arc(lastX, lastY, 3, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    });

    // X axis labels (every 5 days)
    ctx.fillStyle = "#9AA4B2";
    ctx.font = "10px -apple-system, sans-serif";
    ctx.textAlign = "center";
    for (let i = 0; i < snData.length; i += 5) {
      ctx.fillText(`${i + 1}일`, px(i), H - 8);
    }
  }, [snData, agData, cuData]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: "100%", height: 200, display: "block" }}
    />
  );
}

interface StatCard {
  label: string;
  element: string;
  avgDev: number;
  maxDev: number;
  warnCount: number;
  unit: string;
  color: string;
}

const STAT_CARDS: StatCard[] = [
  { label: "SN (주석)", element: "SN", avgDev: 0.3, maxDev: 1.8, warnCount: 2, unit: "%", color: "#3A5BD9" },
  { label: "AG (은)", element: "AG", avgDev: -0.1, maxDev: -0.8, warnCount: 0, unit: "%", color: "#16A34A" },
  { label: "CU (구리)", element: "CU", avgDev: 0.05, maxDev: 0.2, warnCount: 0, unit: "%", color: "#D97706" },
];

function DevCell({ value, target }: { value: number; target: number }) {
  const dev = value - target;
  const pctDev = (dev / target) * 100;
  const isWarn = Math.abs(pctDev) >= WARN_PCT;
  const isCaution = !isWarn && Math.abs(pctDev) >= CAUTION_PCT;
  const color = isWarn ? "#DC2626" : isCaution ? "#D97706" : "#161B26";
  return (
    <span style={{ color, fontWeight: isWarn || isCaution ? 700 : 400, fontVariantNumeric: "tabular-nums" }}>
      {dev > 0 ? "+" : ""}{dev.toFixed(3)}%
    </span>
  );
}

const COLUMNS: Column<LotRow>[] = [
  { key: "lot",       header: "LOT번호",    width: 160 },
  { key: "date",      header: "측정일",      width: 110 },
  { key: "sn_actual", header: "SN 실측",    width: 90,  align: "right",
    render: (_, r) => <span style={{ fontVariantNumeric: "tabular-nums" }}>{r.sn_actual.toFixed(2)}%</span> },
  { key: "sn_dev",    header: "SN 편차",    width: 90,  align: "right",
    render: (_, r) => <DevCell value={r.sn_actual} target={SN_TARGET} /> },
  { key: "ag_actual", header: "AG 실측",    width: 90,  align: "right",
    render: (_, r) => <span style={{ fontVariantNumeric: "tabular-nums" }}>{r.ag_actual.toFixed(3)}%</span> },
  { key: "ag_dev",    header: "AG 편차",    width: 90,  align: "right",
    render: (_, r) => <DevCell value={r.ag_actual} target={AG_TARGET} /> },
  { key: "cu_actual", header: "CU 실측",    width: 90,  align: "right",
    render: (_, r) => <span style={{ fontVariantNumeric: "tabular-nums" }}>{r.cu_actual.toFixed(3)}%</span> },
  { key: "cu_dev",    header: "CU 편차",    width: 90,  align: "right",
    render: (_, r) => <DevCell value={r.cu_actual} target={CU_TARGET} /> },
  { key: "verdict",   header: "판정",        width: 80,  align: "center",
    render: (_, r) => (
      <StatusBadge
        variant={r.verdict === "정상" ? "green" : r.verdict === "주의" ? "amber" : "red"}
        label={r.verdict}
        dot
      />
    ),
  },
];

export default function DeviationPage() {
  const [period, setPeriod] = useState("30일");
  const [supplier, setSupplier] = useState("전체");
  const [element, setElement] = useState("전체");

  const filtered = MOCK_LOTS.filter((r) => {
    if (element === "전체") return true;
    if (element === "SN") return Math.abs(r.sn_dev / SN_TARGET * 100) >= CAUTION_PCT;
    if (element === "AG") return Math.abs(r.ag_dev / AG_TARGET * 100) >= CAUTION_PCT;
    if (element === "CU") return Math.abs(r.cu_dev / CU_TARGET * 100) >= CAUTION_PCT;
    return true;
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* Header */}
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: "#161B26", margin: 0, lineHeight: 1.3 }}>
          성분편차 분석
        </h1>
        <p style={{ fontSize: 12.5, color: "#687182", margin: "4px 0 0" }}>
          목표값 대비 실측 성분 편차 추이 및 LOT별 상세 현황
        </p>
      </div>

      {/* Filters */}
      <div className="card" style={{ padding: "12px 16px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: "#687182" }}>필터</span>
          {[
            { label: "기간", value: period, setter: setPeriod, options: ["7일", "30일", "90일"] },
            { label: "공급사", value: supplier, setter: setSupplier, options: ["전체", "SUP_A", "SUP_B", "SUP_C", "SUP_D"] },
            { label: "성분", value: element, setter: setElement, options: ["전체", "SN", "AG", "CU"] },
          ].map(({ label, value, setter, options }) => (
            <div key={label} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 12, color: "#9AA4B2" }}>{label}</span>
              <select
                value={value}
                onChange={(e) => setter(e.target.value)}
                style={{
                  padding: "5px 10px",
                  fontSize: 12.5,
                  fontWeight: 600,
                  color: "#161B26",
                  border: "1px solid #E4E7EC",
                  borderRadius: 7,
                  background: "#fff",
                  outline: "none",
                  cursor: "pointer",
                }}
              >
                {options.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
          ))}
          <div style={{ marginLeft: "auto", fontSize: 11.5, color: "#9AA4B2" }}>
            기준: SN {SN_TARGET}% / AG {AG_TARGET}% / CU {CU_TARGET}%
          </div>
        </div>
      </div>

      {/* Stat cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
        {STAT_CARDS.map((s) => (
          <div
            key={s.element}
            className="card"
            style={{ borderTop: `3px solid ${s.color}`, display: "flex", flexDirection: "column", gap: 12 }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: "#9AA4B2", letterSpacing: "0.05em", textTransform: "uppercase", marginBottom: 4 }}>
                  {s.label}
                </div>
                <div style={{ fontSize: 10.5, color: "#9AA4B2" }}>목표값 기준</div>
              </div>
              {s.warnCount > 0 && (
                <StatusBadge variant="red" label={`경고 ${s.warnCount}건`} dot />
              )}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div>
                <div style={{ fontSize: 10.5, color: "#9AA4B2", marginBottom: 2 }}>평균편차</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: s.avgDev >= 0 ? "#3A5BD9" : "#DC2626", fontVariantNumeric: "tabular-nums" }}>
                  {s.avgDev > 0 ? "+" : ""}{s.avgDev.toFixed(2)}%
                </div>
              </div>
              <div>
                <div style={{ fontSize: 10.5, color: "#9AA4B2", marginBottom: 2 }}>최대편차</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: Math.abs(s.maxDev) > 1 ? "#D97706" : "#161B26", fontVariantNumeric: "tabular-nums" }}>
                  {s.maxDev > 0 ? "+" : ""}{s.maxDev.toFixed(2)}%
                </div>
              </div>
            </div>
            {/* Mini progress bar showing deviation magnitude */}
            <div style={{ height: 4, background: "#F2F4F7", borderRadius: 2, overflow: "hidden" }}>
              <div
                style={{
                  height: "100%",
                  width: `${Math.min(Math.abs(s.avgDev) / 5 * 100, 100)}%`,
                  background: s.color,
                  borderRadius: 2,
                  transition: "width 0.4s",
                }}
              />
            </div>
          </div>
        ))}
      </div>

      {/* Trend chart */}
      <div className="card" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: "#161B26" }}>편차 추이 ({period})</span>
          <div style={{ display: "flex", gap: 16 }}>
            {[
              { label: "SN", color: "#3A5BD9" },
              { label: "AG", color: "#16A34A" },
              { label: "CU×10", color: "#D97706" },
            ].map(({ label, color }) => (
              <div key={label} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <div style={{ width: 20, height: 2, background: color, borderRadius: 1 }} />
                <span style={{ fontSize: 11.5, color: "#687182" }}>{label}</span>
              </div>
            ))}
            <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <div style={{ width: 20, height: 2, background: "#FCA5A5", borderRadius: 1, borderTop: "1px dashed #FCA5A5" }} />
              <span style={{ fontSize: 11.5, color: "#687182" }}>경고 ±5%</span>
            </div>
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <TrendChart
            snData={TREND_DATA.sn}
            agData={TREND_DATA.ag}
            cuData={TREND_DATA.cu}
          />
        </div>
      </div>

      {/* LOT table */}
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "14px 16px",
            borderBottom: "1px solid #E4E7EC",
          }}
        >
          <span style={{ fontSize: 13, fontWeight: 700, color: "#161B26" }}>
            LOT별 편차 상세
          </span>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ fontSize: 11.5, color: "#9AA4B2" }}>
              <span style={{ color: "#DC2626", fontWeight: 700 }}>빨강</span>: ±{WARN_PCT}% 초과&nbsp;&nbsp;
              <span style={{ color: "#D97706", fontWeight: 700 }}>주황</span>: ±{CAUTION_PCT}% 초과
            </span>
            <button className="btn" style={{ fontSize: 11.5, padding: "5px 12px" }}>
              내보내기
            </button>
          </div>
        </div>
        <DataTable
          columns={COLUMNS}
          data={filtered}
          rowKey={(r) => r.lot}
          stickyHeader
        />
      </div>
    </div>
  );
}
