"use client";

import { useEffect, useRef } from "react";

interface SparklinePoint {
  value: number;
}

interface KpiCardProps {
  label: string;
  value: string | number;
  unit?: string;
  trend?: "up" | "down" | "neutral";
  trendValue?: string;
  sparkline?: SparklinePoint[];
  accentColor?: string;
}

function Sparkline({
  data,
  color,
}: {
  data: SparklinePoint[];
  color: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || data.length < 2) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const W = canvas.offsetWidth;
    const H = canvas.offsetHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.scale(dpr, dpr);

    const values = data.map((d) => d.value);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;

    const px = (i: number) => (i / (data.length - 1)) * W;
    const py = (v: number) => H - 4 - ((v - min) / range) * (H - 8);

    // Area fill
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, color + "40");
    grad.addColorStop(1, color + "00");

    ctx.beginPath();
    ctx.moveTo(px(0), py(values[0]));
    for (let i = 1; i < values.length; i++) {
      const xc = (px(i - 1) + px(i)) / 2;
      const yc = (py(values[i - 1]) + py(values[i])) / 2;
      ctx.quadraticCurveTo(px(i - 1), py(values[i - 1]), xc, yc);
    }
    ctx.lineTo(px(values.length - 1), py(values[values.length - 1]));
    ctx.lineTo(px(values.length - 1), H);
    ctx.lineTo(px(0), H);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // Line
    ctx.beginPath();
    ctx.moveTo(px(0), py(values[0]));
    for (let i = 1; i < values.length; i++) {
      const xc = (px(i - 1) + px(i)) / 2;
      const yc = (py(values[i - 1]) + py(values[i])) / 2;
      ctx.quadraticCurveTo(px(i - 1), py(values[i - 1]), xc, yc);
    }
    ctx.lineTo(px(values.length - 1), py(values[values.length - 1]));
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Endpoint dot
    const lastX = px(values.length - 1);
    const lastY = py(values[values.length - 1]);
    ctx.beginPath();
    ctx.arc(lastX, lastY, 3, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(lastX, lastY, 3, 0, Math.PI * 2);
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }, [data, color]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: "100%", height: "100%", display: "block" }}
    />
  );
}

const TREND_CONFIG = {
  up:      { color: "#15803D", bg: "#ECFDF3", arrow: "↑" },
  down:    { color: "#B91C1C", bg: "#FEF1F2", arrow: "↓" },
  neutral: { color: "#5B6573", bg: "#F2F4F7", arrow: "→" },
};

export function KpiCard({
  label,
  value,
  unit,
  trend,
  trendValue,
  sparkline,
  accentColor = "#3A5BD9",
}: KpiCardProps) {
  const tc = trend ? TREND_CONFIG[trend] : null;

  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
      {/* Label row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <span
          style={{
            fontSize: 11.5,
            fontWeight: 600,
            color: "#687182",
            letterSpacing: "0.03em",
            textTransform: "uppercase",
          }}
        >
          {label}
        </span>
        {tc && trendValue && (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 3,
              padding: "2px 7px",
              borderRadius: 20,
              fontSize: 11,
              fontWeight: 700,
              color: tc.color,
              background: tc.bg,
            }}
          >
            {tc.arrow} {trendValue}
          </span>
        )}
      </div>

      {/* Value row */}
      <div style={{ display: "flex", alignItems: "flex-end", gap: 4 }}>
        <span
          style={{
            fontSize: 26,
            fontWeight: 800,
            color: "#161B26",
            lineHeight: 1,
            fontVariantNumeric: "tabular-nums",
            letterSpacing: "-0.02em",
          }}
        >
          {value}
        </span>
        {unit && (
          <span style={{ fontSize: 13, fontWeight: 500, color: "#9AA4B2", marginBottom: 2 }}>
            {unit}
          </span>
        )}
      </div>

      {/* Sparkline */}
      {sparkline && sparkline.length > 1 && (
        <div style={{ height: 40, marginTop: 4 }}>
          <Sparkline data={sparkline} color={accentColor} />
        </div>
      )}
    </div>
  );
}
