"use client";

import { useEffect, useRef } from "react";
import { KpiCard } from "@/components/ui/KpiCard";
import { StatusBadge } from "@/components/ui/StatusBadge";

interface MonthlyQuality {
  month: string;
  defectRate: number;
  claimRate: number;
  passRate: number;
  qualityScore: number;
}

const MONTHLY_Q: MonthlyQuality[] = [
  { month: "1월", defectRate: 3.2, claimRate: 0.8, passRate: 96.8, qualityScore: 84.2 },
  { month: "2월", defectRate: 2.9, claimRate: 0.7, passRate: 97.1, qualityScore: 85.1 },
  { month: "3월", defectRate: 2.4, claimRate: 0.5, passRate: 97.6, qualityScore: 87.3 },
  { month: "4월", defectRate: 2.7, claimRate: 0.6, passRate: 97.3, qualityScore: 86.0 },
  { month: "5월", defectRate: 2.3, claimRate: 0.4, passRate: 97.7, qualityScore: 88.1 },
  { month: "6월", defectRate: 2.8, claimRate: 0.7, passRate: 97.2, qualityScore: 85.8 },
];

const CUSTOMER_SCORES = [
  { customer: "삼성전자",  score: 92, claims: 2, trend: "up" as const },
  { customer: "LG이노텍",  score: 89, claims: 1, trend: "up" as const },
  { customer: "현대모비스", score: 81, claims: 3, trend: "down" as const },
  { customer: "SK하이닉스", score: 94, claims: 1, trend: "up" as const },
  { customer: "삼성SDI",   score: 88, claims: 1, trend: "neutral" as const },
  { customer: "한화에어로", score: 86, claims: 2, trend: "neutral" as const },
];

function TrendChart({ data, valueKey, color, target }: {
  data: MonthlyQuality[];
  valueKey: keyof MonthlyQuality;
  color: string;
  target?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.offsetWidth, H = canvas.offsetHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.scale(dpr, dpr);

    const values = data.map((d) => d[valueKey] as number);
    const padL = 36, padR = 12, padT = 12, padB = 24;
    const cW = W - padL - padR, cH = H - padT - padB;
    const allVals = target ? [...values, target] : values;
    const min = Math.min(...allVals) * 0.95;
    const max = Math.max(...allVals) * 1.05;

    const px = (i: number) => padL + (i / (data.length - 1)) * cW;
    const py = (v: number) => padT + cH - ((v - min) / (max - min)) * cH;

    // Grid
    [0, 1, 2, 3].forEach((t) => {
      const v = min + (t / 3) * (max - min);
      const y = py(v);
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(W - padR, y);
      ctx.strokeStyle = "#F2F4F7";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = "#9AA4B2";
      ctx.font = "500 9px system-ui";
      ctx.textAlign = "right";
      ctx.fillText(v.toFixed(1), padL - 4, y + 3);
    });

    // Target line
    if (target !== undefined) {
      const ty = py(target);
      ctx.beginPath();
      ctx.moveTo(padL, ty);
      ctx.lineTo(W - padR, ty);
      ctx.strokeStyle = "#E4E7EC";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Area
    const grad = ctx.createLinearGradient(0, padT, 0, padT + cH);
    grad.addColorStop(0, color + "30");
    grad.addColorStop(1, color + "00");
    ctx.beginPath();
    ctx.moveTo(px(0), py(values[0]));
    for (let i = 1; i < values.length; i++) {
      const xc = (px(i - 1) + px(i)) / 2;
      ctx.quadraticCurveTo(px(i - 1), py(values[i - 1]), xc, (py(values[i - 1]) + py(values[i])) / 2);
    }
    ctx.lineTo(px(values.length - 1), py(values[values.length - 1]));
    ctx.lineTo(px(values.length - 1), padT + cH);
    ctx.lineTo(px(0), padT + cH);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // Line
    ctx.beginPath();
    ctx.moveTo(px(0), py(values[0]));
    for (let i = 1; i < values.length; i++) {
      const xc = (px(i - 1) + px(i)) / 2;
      ctx.quadraticCurveTo(px(i - 1), py(values[i - 1]), xc, (py(values[i - 1]) + py(values[i])) / 2);
    }
    ctx.lineTo(px(values.length - 1), py(values[values.length - 1]));
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.stroke();

    // Dots + labels
    data.forEach((d, i) => {
      const v = d[valueKey] as number;
      ctx.beginPath();
      ctx.arc(px(i), py(v), 3.5, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(px(i), py(v), 3.5, 0, Math.PI * 2);
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Month label
      ctx.fillStyle = "#9AA4B2";
      ctx.font = "500 9px system-ui";
      ctx.textAlign = "center";
      ctx.fillText(d.month, px(i), H - padB + 14);
    });
  }, [data, valueKey, color, target]);

  return <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />;
}

export default function QualityKpiPage() {
  const current = MONTHLY_Q[MONTHLY_Q.length - 1];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: "#161B26", margin: 0 }}>품질 KPI</h1>
        <p style={{ fontSize: 12.5, color: "#687182", margin: "4px 0 0" }}>
          불량률·클레임률 추이 및 고객사별 품질 점수
        </p>
      </div>

      {/* KPI cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
        <KpiCard label="6월 불량률"     value={current.defectRate}   unit="%" trend="down" trendValue="+0.5%p" sparkline={MONTHLY_Q.map(m => ({ value: m.defectRate }))}   accentColor="#DC2626" />
        <KpiCard label="클레임률"       value={current.claimRate}    unit="%" trend="down" trendValue="+0.3%p" sparkline={MONTHLY_Q.map(m => ({ value: m.claimRate }))}    accentColor="#F59E0B" />
        <KpiCard label="출하 합격률"    value={current.passRate}     unit="%" trend="neutral" trendValue="-0.5%p" sparkline={MONTHLY_Q.map(m => ({ value: m.passRate }))}   accentColor="#16A34A" />
        <KpiCard label="평균 품질점수"  value={current.qualityScore} unit="점" trend="down" trendValue="-2.3점"  sparkline={MONTHLY_Q.map(m => ({ value: m.qualityScore }))} accentColor="#3A5BD9" />
      </div>

      {/* Charts */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        <div className="card">
          <div style={{ fontSize: 13, fontWeight: 700, color: "#161B26", marginBottom: 4 }}>불량률 추이</div>
          <div style={{ display: "flex", gap: 14, fontSize: 11.5, color: "#9AA4B2", marginBottom: 14 }}>
            <span>목표: 3.0% 이하</span>
            <span style={{ color: current.defectRate <= 3.0 ? "#15803D" : "#B91C1C", fontWeight: 600 }}>
              현재 {current.defectRate}% {current.defectRate <= 3.0 ? "달성" : "초과"}
            </span>
          </div>
          <div style={{ height: 180 }}><TrendChart data={MONTHLY_Q} valueKey="defectRate" color="#DC2626" target={3.0} /></div>
        </div>
        <div className="card">
          <div style={{ fontSize: 13, fontWeight: 700, color: "#161B26", marginBottom: 4 }}>클레임률 추이</div>
          <div style={{ display: "flex", gap: 14, fontSize: 11.5, color: "#9AA4B2", marginBottom: 14 }}>
            <span>목표: 0.5% 이하</span>
            <span style={{ color: current.claimRate <= 0.5 ? "#15803D" : "#B91C1C", fontWeight: 600 }}>
              현재 {current.claimRate}% {current.claimRate <= 0.5 ? "달성" : "초과"}
            </span>
          </div>
          <div style={{ height: 180 }}><TrendChart data={MONTHLY_Q} valueKey="claimRate" color="#F59E0B" target={0.5} /></div>
        </div>
      </div>

      {/* Customer quality scores */}
      <div className="card">
        <div style={{ fontSize: 13, fontWeight: 700, color: "#161B26", marginBottom: 16 }}>고객사별 품질 점수</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
          {CUSTOMER_SCORES.map((c) => {
            const scoreColor = c.score >= 90 ? "#15803D" : c.score >= 85 ? "#3A5BD9" : c.score >= 80 ? "#B45309" : "#B91C1C";
            const scoreBg   = c.score >= 90 ? "#ECFDF3" : c.score >= 85 ? "#EEF1FD" : c.score >= 80 ? "#FEF6E7" : "#FEF1F2";
            const trendArrow = c.trend === "up" ? "↑" : c.trend === "down" ? "↓" : "→";
            const trendColor = c.trend === "up" ? "#15803D" : c.trend === "down" ? "#B91C1C" : "#9AA4B2";
            return (
              <div key={c.customer} style={{ padding: "14px 16px", borderRadius: 10, background: scoreBg, border: `1px solid ${scoreColor}20` }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#161B26" }}>{c.customer}</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: trendColor }}>{trendArrow}</span>
                </div>
                <div style={{ display: "flex", alignItems: "flex-end", gap: 4, marginBottom: 8 }}>
                  <span style={{ fontSize: 28, fontWeight: 900, color: scoreColor, fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>{c.score}</span>
                  <span style={{ fontSize: 12, color: "#9AA4B2", marginBottom: 2 }}>점</span>
                </div>
                {/* Score bar */}
                <div style={{ height: 5, borderRadius: 3, background: "#fff", overflow: "hidden", marginBottom: 8 }}>
                  <div style={{ height: "100%", width: `${c.score}%`, borderRadius: 3, background: scoreColor }} />
                </div>
                <div style={{ fontSize: 11.5, color: "#687182" }}>
                  클레임 {c.claims}건
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Monthly quality table */}
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "12px 16px", borderBottom: "1px solid #E4E7EC" }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: "#161B26" }}>월별 품질 KPI 상세</span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, fontVariantNumeric: "tabular-nums" }}>
            <thead>
              <tr style={{ background: "#F8F9FB" }}>
                {["월", "불량률(%)", "클레임률(%)", "합격률(%)", "품질점수", "평가"].map((h) => (
                  <th key={h} style={{ padding: "9px 14px", textAlign: h === "월" ? "left" : "right", fontSize: 11.5, fontWeight: 600, color: "#687182", borderBottom: "1px solid #E4E7EC", letterSpacing: "0.03em", textTransform: "uppercase" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {MONTHLY_Q.map((m, i) => {
                const isCurrent = i === MONTHLY_Q.length - 1;
                const grade = m.qualityScore >= 88 ? "우수" : m.qualityScore >= 85 ? "양호" : "개선필요";
                const gv = grade === "우수" ? "green" : grade === "양호" ? "blue" : "amber";
                return (
                  <tr key={m.month} style={{ borderBottom: i < MONTHLY_Q.length - 1 ? "1px solid #F2F4F7" : "none", background: isCurrent ? "#F8F9FB" : "transparent" }}>
                    <td style={{ padding: "9px 14px", fontWeight: isCurrent ? 700 : 400, color: "#161B26" }}>
                      {m.month}{isCurrent && <span style={{ fontSize: 10.5, color: "#3A5BD9", marginLeft: 6, fontWeight: 700 }}>현재</span>}
                    </td>
                    <td style={{ padding: "9px 14px", textAlign: "right", color: m.defectRate <= 3 ? "#15803D" : "#B91C1C", fontWeight: 600 }}>{m.defectRate}</td>
                    <td style={{ padding: "9px 14px", textAlign: "right", color: m.claimRate <= 0.5 ? "#15803D" : "#B91C1C", fontWeight: 600 }}>{m.claimRate}</td>
                    <td style={{ padding: "9px 14px", textAlign: "right", color: "#161B26" }}>{m.passRate}</td>
                    <td style={{ padding: "9px 14px", textAlign: "right", fontWeight: 700, color: "#161B26" }}>{m.qualityScore}</td>
                    <td style={{ padding: "9px 14px", textAlign: "right" }}><StatusBadge variant={gv as "green" | "blue" | "amber"} label={grade} /></td>
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
