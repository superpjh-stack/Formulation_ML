"use client";

import { useState, useEffect, useRef } from "react";

// ─── Mock Data ────────────────────────────────────────────────────────────────

interface SensorReading {
  id: string;
  name: string;
  unit: string;
  value: number;
  min: number;
  max: number;     // normal max
  critical: number; // alarm threshold
  low: number;     // low alarm
  category: "온도" | "속도" | "압력" | "유량";
  icon: string;
}

const INITIAL_SENSORS: SensorReading[] = [
  { id: "furnace_temp", name: "용광로 온도",   unit: "°C",   value: 312, min: 250, max: 330, critical: 340, low: 240, category: "온도",  icon: "🔥" },
  { id: "mixer_rpm",    name: "교반기 RPM",    unit: "rpm",  value: 248, min: 200, max: 280, critical: 300, low: 180, category: "속도",  icon: "⚙" },
  { id: "cool_temp",    name: "냉각 온도",     unit: "°C",   value: 42,  min: 20,  max: 50,  critical: 60,  low: 15,  category: "온도",  icon: "❄" },
  { id: "mold_press",   name: "몰드 압력",     unit: "MPa",  value: 8.2, min: 6.0, max: 9.5, critical: 11,  low: 5.0, category: "압력",  icon: "▣" },
  { id: "flow_sn",      name: "SN 유량",       unit: "L/min",value: 4.8, min: 3.5, max: 5.5, critical: 6.5, low: 3.0, category: "유량",  icon: "~" },
  { id: "furnace2_temp",name: "용해로2 온도",  unit: "°C",   value: 358, min: 300, max: 360, critical: 375, low: 280, category: "온도",  icon: "🔥" },
];

// simulate slight value drift on each tick
function driftValue(sensor: SensorReading): number {
  const delta = (Math.random() - 0.48) * (sensor.max - sensor.min) * 0.018;
  const next = Math.round((sensor.value + delta) * 10) / 10;
  return Math.max(sensor.low * 0.9, Math.min(sensor.critical * 1.05, next));
}

// ─── Gauge ────────────────────────────────────────────────────────────────────

function Gauge({ sensor }: { sensor: SensorReading }) {
  const ratio = Math.min(1, Math.max(0, (sensor.value - sensor.low * 0.9) / (sensor.critical * 1.05 - sensor.low * 0.9)));
  const isCritical = sensor.value >= sensor.critical || sensor.value <= sensor.low;
  const isWarning  = !isCritical && (sensor.value >= sensor.max * 0.92 || sensor.value <= sensor.min * 1.05);

  const arcColor = isCritical ? "#DC2626" : isWarning ? "#D97706" : "#3A5BD9";

  // SVG arc gauge
  const r = 36, cx = 50, cy = 54, strokeW = 7;
  const startAngle = -210; // degrees
  const sweep = 240;       // degrees
  const toRad = (d: number) => (d * Math.PI) / 180;
  const arcX = (angle: number) => cx + r * Math.cos(toRad(angle));
  const arcY = (angle: number) => cy + r * Math.sin(toRad(angle));

  const bgStart = startAngle;
  const bgEnd   = startAngle + sweep;
  const fillEnd = startAngle + sweep * ratio;

  const arcPath = (a1: number, a2: number) => {
    const large = Math.abs(a2 - a1) > 180 ? 1 : 0;
    return `M ${arcX(a1)} ${arcY(a1)} A ${r} ${r} 0 ${large} 1 ${arcX(a2)} ${arcY(a2)}`;
  };

  return (
    <div style={{ textAlign: "center" }}>
      <svg width="100" height="70" viewBox="0 0 100 70">
        {/* Track */}
        <path d={arcPath(bgStart, bgEnd)} fill="none" stroke="#F2F4F7" strokeWidth={strokeW} strokeLinecap="round" />
        {/* Fill */}
        {ratio > 0 && (
          <path d={arcPath(bgStart, fillEnd)} fill="none" stroke={arcColor} strokeWidth={strokeW} strokeLinecap="round" />
        )}
        {/* Value */}
        <text x={cx} y={cy - 4} textAnchor="middle" fontSize="13" fontWeight="800" fill={arcColor} style={{ fontVariantNumeric: "tabular-nums" }}>
          {sensor.value}
        </text>
        <text x={cx} y={cy + 10} textAnchor="middle" fontSize="9" fill="#9AA4B2">{sensor.unit}</text>
      </svg>
    </div>
  );
}

// ─── Sparkline (live) ─────────────────────────────────────────────────────────

function LiveSparkline({ history, critical, low, max }: { history: number[]; critical: number; low: number; max: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || history.length < 2) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const W = canvas.offsetWidth;
    const H = canvas.offsetHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.scale(dpr, dpr);

    const minV = low * 0.88;
    const maxV = critical * 1.06;
    const range = maxV - minV || 1;

    const px = (i: number) => (i / (history.length - 1)) * W;
    const py = (v: number) => H - 4 - ((v - minV) / range) * (H - 8);

    // Critical zone band
    const critY = py(critical);
    ctx.fillStyle = "rgba(220,38,38,0.06)";
    ctx.fillRect(0, 0, W, critY);

    // Area
    const last = history[history.length - 1];
    const isCrit = last >= critical || last <= low;
    const lineColor = isCrit ? "#DC2626" : "#3A5BD9";
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, lineColor + "30");
    grad.addColorStop(1, lineColor + "00");

    ctx.beginPath();
    ctx.moveTo(px(0), py(history[0]));
    for (let i = 1; i < history.length; i++) {
      const xc = (px(i - 1) + px(i)) / 2;
      const yc = (py(history[i - 1]) + py(history[i])) / 2;
      ctx.quadraticCurveTo(px(i - 1), py(history[i - 1]), xc, yc);
    }
    ctx.lineTo(px(history.length - 1), py(history[history.length - 1]));
    ctx.lineTo(W, H);
    ctx.lineTo(0, H);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // Line
    ctx.beginPath();
    ctx.moveTo(px(0), py(history[0]));
    for (let i = 1; i < history.length; i++) {
      const xc = (px(i - 1) + px(i)) / 2;
      const yc = (py(history[i - 1]) + py(history[i])) / 2;
      ctx.quadraticCurveTo(px(i - 1), py(history[i - 1]), xc, yc);
    }
    ctx.lineTo(px(history.length - 1), py(history[history.length - 1]));
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Max line
    const maxLineY = py(max);
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = "#D97706" + "80";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, maxLineY);
    ctx.lineTo(W, maxLineY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Endpoint dot
    const lx = px(history.length - 1);
    const ly = py(history[history.length - 1]);
    ctx.beginPath();
    ctx.arc(lx, ly, 3, 0, Math.PI * 2);
    ctx.fillStyle = lineColor;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(lx, ly, 3, 0, Math.PI * 2);
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }, [history, critical, low, max]);

  return <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />;
}

// ─── Sensor Card ──────────────────────────────────────────────────────────────

function SensorCard({ sensor, history }: { sensor: SensorReading; history: number[] }) {
  const isCritical = sensor.value >= sensor.critical || sensor.value <= sensor.low;
  const isWarning  = !isCritical && (sensor.value >= sensor.max * 0.92 || sensor.value <= sensor.min * 1.05);

  const borderColor = isCritical ? "#FCA5A5" : isWarning ? "#FCD34D" : "#E4E7EC";
  const bgColor     = isCritical ? "#FEF1F2" : isWarning ? "#FFFBEB" : "#fff";

  return (
    <div
      className="card"
      style={{
        background: bgColor,
        borderColor,
        position: "relative",
        overflow: "hidden",
      }}
    >
      {isCritical && (
        <div
          style={{
            position: "absolute",
            top: 0, left: 0, right: 0,
            height: 3,
            background: "#DC2626",
            animation: "pulse-bar 1s ease-in-out infinite alternate",
          }}
        />
      )}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
        <div>
          <div style={{ fontSize: 11.5, fontWeight: 600, color: "#687182", letterSpacing: "0.03em", textTransform: "uppercase" as const }}>
            {sensor.category}
          </div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#161B26", marginTop: 2 }}>{sensor.name}</div>
        </div>
        {isCritical && (
          <span style={{
            padding: "2px 8px", borderRadius: 20, fontSize: 11, fontWeight: 700,
            color: "#B91C1C", background: "#FEE2E2",
            animation: "pulse-opacity 1s ease-in-out infinite alternate",
          }}>
            ⚠ 경보
          </span>
        )}
        {isWarning && !isCritical && (
          <span style={{ padding: "2px 8px", borderRadius: 20, fontSize: 11, fontWeight: 700, color: "#92400E", background: "#FEF3C7" }}>
            주의
          </span>
        )}
      </div>

      <Gauge sensor={sensor} />

      <div style={{ height: 48, marginTop: 4 }}>
        <LiveSparkline history={history} critical={sensor.critical} low={sensor.low} max={sensor.max} />
      </div>

      <div style={{ marginTop: 8, display: "flex", justifyContent: "space-between", fontSize: 10.5, color: "#9AA4B2" }}>
        <span>하한 {sensor.low}</span>
        <span>정상 {sensor.min}–{sensor.max} {sensor.unit}</span>
        <span>상한 {sensor.critical}</span>
      </div>

      <style>{`
        @keyframes pulse-bar {
          from { opacity: 1; }
          to   { opacity: 0.4; }
        }
        @keyframes pulse-opacity {
          from { opacity: 1; }
          to   { opacity: 0.5; }
        }
      `}</style>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const HISTORY_LEN = 30;

export default function ProcessMonitorPage() {
  const [sensors, setSensors] = useState(INITIAL_SENSORS);
  const [histories, setHistories] = useState<Record<string, number[]>>(
    Object.fromEntries(INITIAL_SENSORS.map((s) => [s.id, [s.value]]))
  );
  const [lastUpdate, setLastUpdate] = useState("--:--:--");

  useEffect(() => {
    const tick = setInterval(() => {
      setSensors((prev) =>
        prev.map((s) => ({ ...s, value: driftValue(s) }))
      );
      setHistories((prev) => {
        const next: Record<string, number[]> = {};
        sensors.forEach((s) => {
          const h = [...(prev[s.id] ?? []), s.value].slice(-HISTORY_LEN);
          next[s.id] = h;
        });
        return next;
      });
      setLastUpdate(new Date().toLocaleTimeString("ko-KR"));
    }, 2000);
    return () => clearInterval(tick);
  }, [sensors]);

  const alarms = sensors.filter((s) => s.value >= s.critical || s.value <= s.low);
  const warnings = sensors.filter((s) => {
    const isCrit = s.value >= s.critical || s.value <= s.low;
    return !isCrit && (s.value >= s.max * 0.92 || s.value <= s.min * 1.05);
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: "#161B26", margin: 0 }}>공정 데이터 모니터링</h1>
          <p style={{ fontSize: 12.5, color: "#687182", margin: "4px 0 0" }}>실시간 설비 센서 현황 · 2초 갱신</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#687182" }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#16A34A", display: "inline-block", animation: "pulse-opacity 1.5s ease-in-out infinite alternate" }} />
          마지막 갱신: {lastUpdate}
        </div>
      </div>

      {/* Alarm banner */}
      {alarms.length > 0 && (
        <div style={{
          background: "#FEF1F2", border: "1px solid #FCA5A5", borderRadius: 10,
          padding: "12px 16px", display: "flex", gap: 12, alignItems: "flex-start",
        }}>
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" style={{ flexShrink: 0, marginTop: 1 }}>
            <path d="M9 1L17 16H1L9 1z" stroke="#DC2626" strokeWidth="1.5" strokeLinejoin="round" />
            <path d="M9 7v4M9 12.5v.5" stroke="#DC2626" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#B91C1C", marginBottom: 4 }}>
              임계치 초과 경보 {alarms.length}건
            </div>
            <div style={{ fontSize: 12, color: "#991B1B" }}>
              {alarms.map((s) => `${s.name} (현재 ${s.value}${s.unit})`).join(" · ")}
            </div>
          </div>
        </div>
      )}

      {warnings.length > 0 && alarms.length === 0 && (
        <div style={{
          background: "#FFFBEB", border: "1px solid #FCD34D", borderRadius: 10,
          padding: "12px 16px", display: "flex", gap: 10, alignItems: "center",
        }}>
          <span style={{ fontSize: 15 }}>⚠</span>
          <span style={{ fontSize: 12.5, color: "#92400E" }}>
            주의 구간 진입: {warnings.map((s) => s.name).join(", ")}
          </span>
        </div>
      )}

      {/* Summary strip */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
        {[
          { label: "모니터링 설비", value: sensors.length, unit: "대", color: "#3A5BD9" },
          { label: "정상",          value: sensors.length - alarms.length - warnings.length, unit: "대", color: "#16A34A" },
          { label: "주의",          value: warnings.length, unit: "대", color: "#D97706" },
          { label: "경보",          value: alarms.length,   unit: "대", color: "#DC2626" },
        ].map((s) => (
          <div key={s.label} className="card" style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 10, height: 10, borderRadius: "50%", background: s.color, flexShrink: 0 }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, color: "#687182", fontWeight: 600, letterSpacing: "0.03em", textTransform: "uppercase" as const }}>{s.label}</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: s.color, fontVariantNumeric: "tabular-nums", lineHeight: 1.2 }}>
                {s.value}<span style={{ fontSize: 12, fontWeight: 500, color: "#9AA4B2", marginLeft: 3 }}>{s.unit}</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Sensor grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
        {sensors.map((s) => (
          <SensorCard key={s.id} sensor={s} history={histories[s.id] ?? [s.value]} />
        ))}
      </div>
    </div>
  );
}
