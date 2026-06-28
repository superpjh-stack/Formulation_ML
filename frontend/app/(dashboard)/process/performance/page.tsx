"use client";

import { useEffect, useRef } from "react";
import { KpiCard } from "@/components/ui/KpiCard";
import { DataTable, Column } from "@/components/ui/DataTable";
import { StatusBadge } from "@/components/ui/StatusBadge";

// ─── Mock Data ────────────────────────────────────────────────────────────────

interface DailyPerf {
  date: string;
  target: number;
  actual: number;
  efficiency: number;
  avgTime: number;
  status: "달성" | "미달" | "초과";
}

const MOCK_PERF: DailyPerf[] = [
  { date: "06-21", target: 2000, actual: 2150, efficiency: 107.5, avgTime: 42, status: "초과" },
  { date: "06-22", target: 2000, actual: 1980, efficiency: 99.0,  avgTime: 44, status: "달성" },
  { date: "06-23", target: 2000, actual: 1840, efficiency: 92.0,  avgTime: 51, status: "미달" },
  { date: "06-24", target: 2000, actual: 2030, efficiency: 101.5, avgTime: 43, status: "달성" },
  { date: "06-25", target: 2000, actual: 2200, efficiency: 110.0, avgTime: 40, status: "초과" },
  { date: "06-26", target: 2000, actual: 1950, efficiency: 97.5,  avgTime: 46, status: "달성" },
  { date: "06-27", target: 2000, actual: 1720, efficiency: 86.0,  avgTime: 54, status: "미달" },
];

const STATUS_MAP: Record<DailyPerf["status"], { variant: "green" | "blue" | "amber" }> = {
  달성: { variant: "blue"  },
  초과: { variant: "green" },
  미달: { variant: "amber" },
};

const COLUMNS: Column<DailyPerf>[] = [
  { key: "date",       header: "날짜",       width: 90 },
  { key: "target",     header: "목표 (kg)",  width: 110, align: "right", render: (v) => <span style={{ fontVariantNumeric: "tabular-nums" }}>{(v as number).toLocaleString()}</span> },
  { key: "actual",     header: "실적 (kg)",  width: 110, align: "right", render: (v) => <span style={{ fontVariantNumeric: "tabular-nums" }}>{(v as number).toLocaleString()}</span> },
  { key: "efficiency", header: "달성률 (%)", width: 110, align: "right", render: (v) => {
    const val = v as number;
    const color = val >= 100 ? "#15803D" : val >= 95 ? "#1D4ED8" : "#B45309";
    return <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 600, color }}>{val.toFixed(1)}%</span>;
  }},
  { key: "avgTime", header: "평균 소요시간 (분)", width: 150, align: "right", render: (v) => <span style={{ fontVariantNumeric: "tabular-nums" }}>{v as number}분</span> },
  { key: "status",  header: "상태", width: 80, align: "center", render: (_, row) => <StatusBadge variant={STATUS_MAP[row.status].variant} label={row.status} dot /> },
];

// ─── Target vs Actual Bar Chart ───────────────────────────────────────────────

function PerformanceChart() {
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

    const padL = 52, padR = 20, padT = 24, padB = 40;
    const chartW = W - padL - padR;
    const chartH = H - padT - padB;
    const maxVal = 2400;
    const n = MOCK_PERF.length;
    const groupW = chartW / n;
    const barW = groupW * 0.3;

    // Grid
    for (let i = 0; i <= 4; i++) {
      const y = padT + chartH - (i / 4) * chartH;
      ctx.strokeStyle = "#F2F4F7";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(padL + chartW, y);
      ctx.stroke();
      ctx.fillStyle = "#9AA4B2";
      ctx.font = "10px sans-serif";
      ctx.textAlign = "right";
      ctx.fillText(`${Math.round((i / 4) * maxVal / 100) * 100}`, padL - 6, y + 3.5);
    }

    MOCK_PERF.forEach((d, i) => {
      const cx = padL + i * groupW + groupW / 2;
      // Target bar
      const th = (d.target / maxVal) * chartH;
      ctx.fillStyle = "#E4E7EC";
      ctx.beginPath();
      ctx.roundRect(cx - barW - 2, padT + chartH - th, barW, th, [3, 3, 0, 0]);
      ctx.fill();
      // Actual bar
      const ah = (d.actual / maxVal) * chartH;
      const color = d.actual >= d.target ? "#3A5BD9" : "#F59E0B";
      ctx.fillStyle = color + "DD";
      ctx.beginPath();
      ctx.roundRect(cx + 2, padT + chartH - ah, barW, ah, [3, 3, 0, 0]);
      ctx.fill();
      // X label
      ctx.fillStyle = "#687182";
      ctx.font = "10.5px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(d.date, cx, H - padB + 16);
    });

    // Legend
    const legendItems = [
      { color: "#E4E7EC", label: "목표" },
      { color: "#3A5BD9DD", label: "실적(달성/초과)" },
      { color: "#F59E0BDD", label: "실적(미달)" },
    ];
    legendItems.forEach(({ color, label }, i) => {
      const lx = padL + i * 130;
      ctx.fillStyle = color;
      ctx.fillRect(lx, padT - 16, 10, 10);
      ctx.fillStyle = "#687182";
      ctx.font = "10px sans-serif";
      ctx.textAlign = "left";
      ctx.fillText(label, lx + 14, padT - 7);
    });
  }, []);

  return <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ProcessPerformancePage() {
  const todayData = MOCK_PERF[MOCK_PERF.length - 1];
  const weekAvgEff = Math.round(MOCK_PERF.reduce((s, d) => s + d.efficiency, 0) / MOCK_PERF.length * 10) / 10;
  const totalActual = MOCK_PERF.reduce((s, d) => s + d.actual, 0);
  const achieveCount = MOCK_PERF.filter((d) => d.status !== "미달").length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: "#161B26", margin: 0 }}>공정실적관리</h1>
        <p style={{ fontSize: 12.5, color: "#687182", margin: "4px 0 0" }}>일별 목표 대비 실적 현황 · 최근 7일</p>
      </div>

      {/* KPI */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
        <KpiCard label="오늘 실적" value={todayData.actual.toLocaleString()} unit="kg" trend="down" trendValue={`${todayData.efficiency}%`} accentColor="#3A5BD9" />
        <KpiCard label="주간 평균 달성률" value={weekAvgEff} unit="%" trend={weekAvgEff >= 100 ? "up" : "down"} trendValue={weekAvgEff >= 100 ? "목표초과" : "목표미달"} accentColor="#16A34A" />
        <KpiCard label="주간 누적 생산" value={(totalActual / 1000).toFixed(1)} unit="톤" trend="up" trendValue="+8.5%전주比" accentColor="#7C3AED" />
        <KpiCard label="목표 달성일" value={achieveCount} unit="일 / 7일" trend="neutral" trendValue="이번주" accentColor="#F59E0B" />
      </div>

      {/* Chart */}
      <div className="card">
        <div style={{ fontSize: 13, fontWeight: 700, color: "#161B26", marginBottom: 4 }}>목표 vs 실적 (일별)</div>
        <div style={{ fontSize: 11.5, color: "#687182", marginBottom: 16 }}>단위: kg</div>
        <div style={{ height: 220 }}>
          <PerformanceChart />
        </div>
      </div>

      {/* Table */}
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "14px 16px", borderBottom: "1px solid #E4E7EC", display: "flex", alignItems: "center" }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: "#161B26", flex: 1 }}>일별 공정 실적 상세</span>
          <button style={{ padding: "5px 14px", fontSize: 12, fontWeight: 600, borderRadius: 6, border: "1px solid #E4E7EC", background: "#F8F9FB", color: "#687182", cursor: "pointer" }}>
            엑셀 내보내기
          </button>
        </div>
        <DataTable columns={COLUMNS} data={MOCK_PERF} rowKey={(r) => r.date} stickyHeader />
      </div>
    </div>
  );
}
