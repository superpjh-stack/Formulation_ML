"use client";

import { useEffect, useRef } from "react";
import { KpiCard } from "@/components/ui/KpiCard";

interface MonthlyData {
  month: string;
  production: number;
  target: number;
  utilization: number;
  efficiency: number;
}

const MONTHLY: MonthlyData[] = [
  { month: "1월",  production: 18200, target: 20000, utilization: 82, efficiency: 91 },
  { month: "2월",  production: 17500, target: 20000, utilization: 79, efficiency: 88 },
  { month: "3월",  production: 21300, target: 20000, utilization: 91, efficiency: 94 },
  { month: "4월",  production: 19800, target: 20000, utilization: 87, efficiency: 92 },
  { month: "5월",  production: 20500, target: 20000, utilization: 89, efficiency: 93 },
  { month: "6월",  production: 16800, target: 20000, utilization: 84, efficiency: 90 },
];

const SPARKLINE_PROD = MONTHLY.map((m) => ({ value: m.production }));
const SPARKLINE_UTIL = MONTHLY.map((m) => ({ value: m.utilization }));
const SPARKLINE_EFF  = MONTHLY.map((m) => ({ value: m.efficiency }));

// Gauge component
function GaugeArc({ value, max, color, label, sub }: { value: number; max: number; color: string; label: string; sub: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pct = Math.min(value / max, 1);

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

    const cx = W / 2, cy = H * 0.72, r = Math.min(W, H) * 0.42;
    const startA = Math.PI, endA = Math.PI * 2;
    const fillA = startA + pct * Math.PI;

    // Track
    ctx.beginPath();
    ctx.arc(cx, cy, r, startA, endA);
    ctx.strokeStyle = "#E4E7EC";
    ctx.lineWidth = 12;
    ctx.lineCap = "round";
    ctx.stroke();

    // Fill
    if (pct > 0) {
      ctx.beginPath();
      ctx.arc(cx, cy, r, startA, fillA);
      const grad = ctx.createLinearGradient(cx - r, 0, cx + r, 0);
      grad.addColorStop(0, color + "99");
      grad.addColorStop(1, color);
      ctx.strokeStyle = grad;
      ctx.lineWidth = 12;
      ctx.lineCap = "round";
      ctx.stroke();
    }

    // Value text
    ctx.fillStyle = "#161B26";
    ctx.font = `800 ${Math.round(W * 0.13)}px system-ui`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(`${Math.round(pct * 100)}%`, cx, cy - 6);

    ctx.fillStyle = "#9AA4B2";
    ctx.font = `600 ${Math.round(W * 0.07)}px system-ui`;
    ctx.fillText(sub, cx, cy + Math.round(W * 0.1));
  }, [value, max, color, pct, sub]);

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
      <canvas ref={canvasRef} style={{ width: 140, height: 90, display: "block" }} />
      <span style={{ fontSize: 12.5, fontWeight: 700, color: "#161B26" }}>{label}</span>
    </div>
  );
}

// Bar chart canvas
function BarChart({ data }: { data: MonthlyData[] }) {
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

    const padL = 52, padR = 16, padT = 16, padB = 28;
    const chartW = W - padL - padR;
    const chartH = H - padT - padB;
    const maxVal = 22000;
    const barCount = data.length;
    const groupW = chartW / barCount;
    const barW = groupW * 0.28;

    // Grid lines
    [0, 5000, 10000, 15000, 20000].forEach((v) => {
      const y = padT + chartH - (v / maxVal) * chartH;
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(W - padR, y);
      ctx.strokeStyle = "#F2F4F7";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = "#9AA4B2";
      ctx.font = "500 10px system-ui";
      ctx.textAlign = "right";
      ctx.fillText(`${v / 1000}k`, padL - 6, y + 4);
    });

    // Bars
    data.forEach((d, i) => {
      const x = padL + i * groupW;
      const cx = x + groupW / 2;

      // Target line marker
      const ty = padT + chartH - (d.target / maxVal) * chartH;
      ctx.beginPath();
      ctx.moveTo(cx - groupW * 0.35, ty);
      ctx.lineTo(cx + groupW * 0.35, ty);
      ctx.strokeStyle = "#E4E7EC";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 2]);
      ctx.stroke();
      ctx.setLineDash([]);

      // Production bar
      const barH = (d.production / maxVal) * chartH;
      const barX = cx - barW;
      const barY = padT + chartH - barH;
      const grad = ctx.createLinearGradient(0, barY, 0, padT + chartH);
      grad.addColorStop(0, "#3A5BD9");
      grad.addColorStop(1, "#6B8AFF");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.roundRect(barX, barY, barW, barH, [3, 3, 0, 0]);
      ctx.fill();

      // Month label
      ctx.fillStyle = "#9AA4B2";
      ctx.font = "600 10px system-ui";
      ctx.textAlign = "center";
      ctx.fillText(d.month, cx, H - padB + 14);
    });
  }, [data]);

  return <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />;
}

export default function ProductionKpiPage() {
  const currentMonth = MONTHLY[MONTHLY.length - 1];
  const achRate = Math.round((currentMonth.production / currentMonth.target) * 100);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: "#161B26", margin: 0 }}>생산성 KPI</h1>
        <p style={{ fontSize: 12.5, color: "#687182", margin: "4px 0 0" }}>
          월별 생산량·가동률·효율 추이 및 목표 대비 달성률
        </p>
      </div>

      {/* KPI cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
        <KpiCard label="6월 생산량" value="16,800" unit="kg" trend="down" trendValue="-18%" sparkline={SPARKLINE_PROD} accentColor="#3A5BD9" />
        <KpiCard label="목표 달성률" value={achRate} unit="%" trend="down" trendValue="-16%p" sparkline={[82, 79, 100, 99, 100, 84].map(v => ({ value: v }))} accentColor="#F59E0B" />
        <KpiCard label="평균 가동률" value={currentMonth.utilization} unit="%" trend="neutral" trendValue="전월대비" sparkline={SPARKLINE_UTIL} accentColor="#16A34A" />
        <KpiCard label="생산 효율" value={currentMonth.efficiency} unit="%" trend="up" trendValue="+2%p" sparkline={SPARKLINE_EFF} accentColor="#7C3AED" />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 20 }}>
        {/* Bar chart */}
        <div className="card">
          <div style={{ fontSize: 13, fontWeight: 700, color: "#161B26", marginBottom: 4 }}>월별 생산량 추이</div>
          <div style={{ fontSize: 12, color: "#9AA4B2", marginBottom: 16, display: "flex", gap: 16 }}>
            <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <span style={{ width: 10, height: 10, borderRadius: 2, background: "#3A5BD9", display: "inline-block" }} />실적
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <span style={{ width: 12, height: 2, background: "#E4E7EC", display: "inline-block" }} />목표(20,000 kg)
            </span>
          </div>
          <div style={{ height: 220 }}>
            <BarChart data={MONTHLY} />
          </div>
        </div>

        {/* Gauge panel */}
        <div className="card">
          <div style={{ fontSize: 13, fontWeight: 700, color: "#161B26", marginBottom: 20 }}>6월 목표 달성률</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 16, alignItems: "center" }}>
            <GaugeArc value={currentMonth.production} max={currentMonth.target} color="#3A5BD9" label="생산량 달성" sub={`${(currentMonth.production / 1000).toFixed(1)}k / 20k`} />
            <GaugeArc value={currentMonth.utilization} max={100} color="#16A34A" label="가동률" sub={`${currentMonth.utilization}%`} />
            <GaugeArc value={currentMonth.efficiency} max={100} color="#7C3AED" label="생산 효율" sub={`${currentMonth.efficiency}%`} />
          </div>
        </div>
      </div>

      {/* Monthly table */}
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "12px 16px", borderBottom: "1px solid #E4E7EC" }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: "#161B26" }}>월별 KPI 상세</span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, fontVariantNumeric: "tabular-nums" }}>
            <thead>
              <tr style={{ background: "#F8F9FB" }}>
                {["월", "생산량(kg)", "목표(kg)", "달성률", "가동률", "효율"].map((h) => (
                  <th key={h} style={{ padding: "9px 14px", textAlign: h === "월" ? "left" : "right", fontSize: 11.5, fontWeight: 600, color: "#687182", borderBottom: "1px solid #E4E7EC", letterSpacing: "0.03em", textTransform: "uppercase" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {MONTHLY.map((m, i) => {
                const rate = Math.round((m.production / m.target) * 100);
                const isCurrent = i === MONTHLY.length - 1;
                return (
                  <tr key={m.month} style={{ borderBottom: i < MONTHLY.length - 1 ? "1px solid #F2F4F7" : "none", background: isCurrent ? "#F8F9FB" : "transparent" }}>
                    <td style={{ padding: "9px 14px", fontWeight: isCurrent ? 700 : 400, color: "#161B26" }}>{m.month}{isCurrent && <span style={{ fontSize: 10.5, color: "#3A5BD9", marginLeft: 6, fontWeight: 700 }}>현재</span>}</td>
                    <td style={{ padding: "9px 14px", textAlign: "right", color: "#161B26" }}>{m.production.toLocaleString()}</td>
                    <td style={{ padding: "9px 14px", textAlign: "right", color: "#9AA4B2" }}>{m.target.toLocaleString()}</td>
                    <td style={{ padding: "9px 14px", textAlign: "right" }}>
                      <span style={{ fontWeight: 700, color: rate >= 100 ? "#15803D" : rate >= 90 ? "#B45309" : "#B91C1C" }}>{rate}%</span>
                    </td>
                    <td style={{ padding: "9px 14px", textAlign: "right", color: "#161B26" }}>{m.utilization}%</td>
                    <td style={{ padding: "9px 14px", textAlign: "right", color: "#161B26" }}>{m.efficiency}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
