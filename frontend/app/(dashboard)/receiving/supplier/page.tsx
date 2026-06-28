"use client";

import { useEffect, useRef } from "react";
import { StatusBadge } from "@/components/ui/StatusBadge";

// ─── Mock Data ────────────────────────────────────────────────────────────────

interface SupplierStat {
  id: string;
  name: string;
  material: string;
  totalLots: number;
  passCount: number;
  failCount: number;
  avgSnDev: number;
  avgAgDev: number;
  avgCuDev: number;
  claims: number;
  grade: "A" | "B" | "C" | "D";
}

const MOCK_SUPPLIERS: SupplierStat[] = [
  { id: "SUP_A", name: "한국금속(주)", material: "Sn / Ag / Pb", totalLots: 142, passCount: 139, failCount: 3,  avgSnDev: 0.08, avgAgDev: 0.04, avgCuDev: 0.01, claims: 1, grade: "A" },
  { id: "SUP_B", name: "동양금속(주)", material: "Sn / Pb",      totalLots: 98,  passCount: 93,  failCount: 5,  avgSnDev: 0.15, avgAgDev: 0.07, avgCuDev: 0.02, claims: 2, grade: "B" },
  { id: "SUP_C", name: "대성소재(주)", material: "Sn / Cu",      totalLots: 76,  passCount: 69,  failCount: 7,  avgSnDev: 0.22, avgAgDev: 0.09, avgCuDev: 0.03, claims: 4, grade: "C" },
  { id: "SUP_D", name: "글로벌메탈",   material: "Ag",           totalLots: 54,  passCount: 44,  failCount: 10, avgSnDev: 0.38, avgAgDev: 0.18, avgCuDev: 0.06, claims: 7, grade: "D" },
];

const GRADE_MAP: Record<"A"|"B"|"C"|"D", { variant: "green"|"blue"|"amber"|"red"; label: string }> = {
  A: { variant: "green", label: "A등급" },
  B: { variant: "blue",  label: "B등급" },
  C: { variant: "amber", label: "C등급" },
  D: { variant: "red",   label: "D등급" },
};

// ─── Bar Chart ────────────────────────────────────────────────────────────────

function SupplierBarChart() {
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

    const suppliers = MOCK_SUPPLIERS.map((s) => s.id);
    const snDevs  = MOCK_SUPPLIERS.map((s) => s.avgSnDev);
    const agDevs  = MOCK_SUPPLIERS.map((s) => s.avgAgDev);
    const cuDevs  = MOCK_SUPPLIERS.map((s) => s.avgCuDev);

    const maxVal = 0.45;
    const padL = 48, padR = 20, padT = 20, padB = 36;
    const chartW = W - padL - padR;
    const chartH = H - padT - padB;
    const groupW = chartW / suppliers.length;
    const barW   = groupW * 0.22;
    const gap    = barW * 0.3;

    // Grid lines
    ctx.strokeStyle = "#F2F4F7";
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = padT + chartH - (i / 4) * chartH;
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(padL + chartW, y);
      ctx.stroke();
      ctx.fillStyle = "#9AA4B2";
      ctx.font = "10px sans-serif";
      ctx.textAlign = "right";
      ctx.fillText(((i / 4) * maxVal).toFixed(2), padL - 4, y + 3.5);
    }

    const series = [
      { devs: snDevs, color: "#3A5BD9", label: "SN편차" },
      { devs: agDevs, color: "#16A34A", label: "AG편차" },
      { devs: cuDevs, color: "#F59E0B", label: "CU편차" },
    ];

    suppliers.forEach((sup, si) => {
      const groupX = padL + si * groupW + groupW / 2 - (3 * barW + 2 * gap) / 2;
      series.forEach(({ devs, color }, bi) => {
        const val = devs[si];
        const barH = (val / maxVal) * chartH;
        const x = groupX + bi * (barW + gap);
        const y = padT + chartH - barH;
        ctx.fillStyle = color + "CC";
        ctx.beginPath();
        ctx.roundRect(x, y, barW, barH, [3, 3, 0, 0]);
        ctx.fill();
      });

      // X label
      ctx.fillStyle = "#687182";
      ctx.font = "11px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(sup, padL + si * groupW + groupW / 2, H - padB + 16);
    });

    // Legend
    const legendX = padL;
    series.forEach(({ color, label }, i) => {
      const lx = legendX + i * 80;
      ctx.fillStyle = color;
      ctx.fillRect(lx, padT - 14, 10, 10);
      ctx.fillStyle = "#687182";
      ctx.font = "10px sans-serif";
      ctx.textAlign = "left";
      ctx.fillText(label, lx + 14, padT - 5);
    });
  }, []);

  return <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />;
}

// ─── Pass Rate Donut ──────────────────────────────────────────────────────────

function PassRateDonut({ rate, grade }: { rate: number; grade: "A"|"B"|"C"|"D" }) {
  const colors: Record<"A"|"B"|"C"|"D", string> = { A: "#16A34A", B: "#2563EB", C: "#D97706", D: "#DC2626" };
  const color = colors[grade];
  const r = 22, cx = 30, cy = 30, stroke = 6;
  const circ = 2 * Math.PI * r;
  const dashArr = (rate / 100) * circ;

  return (
    <svg width="60" height="60" viewBox="0 0 60 60">
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#F2F4F7" strokeWidth={stroke} />
      <circle
        cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth={stroke}
        strokeDasharray={`${dashArr} ${circ}`}
        strokeLinecap="round"
        transform="rotate(-90 30 30)"
      />
      <text x={cx} y={cy + 4} textAnchor="middle" fontSize="10" fontWeight="700" fill={color}>
        {rate}%
      </text>
    </svg>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SupplierPage() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* Header */}
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: "#161B26", margin: 0 }}>공급처 품질분석</h1>
        <p style={{ fontSize: 12.5, color: "#687182", margin: "4px 0 0" }}>공급사별 성분 편차·합격률·등급 분석</p>
      </div>

      {/* Supplier Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 16 }}>
        {MOCK_SUPPLIERS.map((s) => {
          const passRate = Math.round((s.passCount / s.totalLots) * 100);
          const gm = GRADE_MAP[s.grade];
          return (
            <div key={s.id} className="card" style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
              <PassRateDonut rate={passRate} grade={s.grade} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: "#161B26" }}>{s.name}</span>
                  <StatusBadge variant={gm.variant} label={gm.label} />
                </div>
                <div style={{ fontSize: 11.5, color: "#687182", marginBottom: 8 }}>
                  {s.id} · 공급 원자재: {s.material}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
                  {[
                    { label: "총 LOT",  value: `${s.totalLots}건` },
                    { label: "합격",    value: `${s.passCount}건`, color: "#15803D" },
                    { label: "불합격",  value: `${s.failCount}건`, color: s.failCount > 5 ? "#B91C1C" : "#161B26" },
                    { label: "클레임",  value: `${s.claims}건`,    color: s.claims > 3 ? "#B91C1C" : "#161B26" },
                  ].map((m) => (
                    <div key={m.label} style={{ background: "#F8F9FB", borderRadius: 6, padding: "6px 8px" }}>
                      <div style={{ fontSize: 10, color: "#9AA4B2", fontWeight: 600, letterSpacing: "0.03em", textTransform: "uppercase" as const }}>{m.label}</div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: m.color ?? "#161B26", fontVariantNumeric: "tabular-nums" }}>{m.value}</div>
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: 10, display: "flex", gap: 12, fontSize: 11.5, color: "#687182" }}>
                  <span>SN편차 <strong style={{ color: "#161B26" }}>{s.avgSnDev.toFixed(2)}</strong></span>
                  <span>AG편차 <strong style={{ color: "#161B26" }}>{s.avgAgDev.toFixed(2)}</strong></span>
                  <span>CU편차 <strong style={{ color: "#161B26" }}>{s.avgCuDev.toFixed(2)}</strong></span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Comparison chart */}
      <div className="card">
        <div style={{ fontSize: 13, fontWeight: 700, color: "#161B26", marginBottom: 4 }}>성분별 공급사 편차 비교</div>
        <div style={{ fontSize: 11.5, color: "#687182", marginBottom: 16 }}>평균 성분 편차 (목표값 대비) — 낮을수록 우수</div>
        <div style={{ height: 220 }}>
          <SupplierBarChart />
        </div>
      </div>

      {/* Grade guide */}
      <div className="card">
        <div style={{ fontSize: 13, fontWeight: 700, color: "#161B26", marginBottom: 12 }}>등급 기준</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
          {[
            { grade: "A", label: "A등급", desc: "합격률 ≥ 97%, 클레임 ≤ 1건",   variant: "green" as const },
            { grade: "B", label: "B등급", desc: "합격률 ≥ 93%, 클레임 ≤ 3건",   variant: "blue"  as const },
            { grade: "C", label: "C등급", desc: "합격률 ≥ 88%, 클레임 ≤ 5건",   variant: "amber" as const },
            { grade: "D", label: "D등급", desc: "합격률 < 88% 또는 클레임 > 5건", variant: "red"   as const },
          ].map((g) => (
            <div key={g.grade} style={{ background: "#F8F9FB", borderRadius: 8, padding: "10px 12px" }}>
              <div style={{ marginBottom: 6 }}><StatusBadge variant={g.variant} label={g.label} /></div>
              <div style={{ fontSize: 11.5, color: "#687182" }}>{g.desc}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
