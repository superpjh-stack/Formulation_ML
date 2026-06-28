"use client";

import { useEffect, useRef, useState } from "react";

// ─── Mock Data ────────────────────────────────────────────────────────────────

interface DataPoint {
  temp: number;
  rpm: number;
  coolTemp: number;
  processTime: number;
  quality: number;
}

const MOCK_DATA: DataPoint[] = [
  { temp: 295, rpm: 228, coolTemp: 48, processTime: 56, quality: 78.2 },
  { temp: 298, rpm: 231, coolTemp: 46, processTime: 54, quality: 79.8 },
  { temp: 302, rpm: 235, coolTemp: 45, processTime: 52, quality: 81.4 },
  { temp: 305, rpm: 238, coolTemp: 44, processTime: 50, quality: 82.9 },
  { temp: 308, rpm: 241, coolTemp: 43, processTime: 48, quality: 84.1 },
  { temp: 310, rpm: 244, coolTemp: 42, processTime: 47, quality: 85.3 },
  { temp: 312, rpm: 246, coolTemp: 41, processTime: 46, quality: 86.2 },
  { temp: 315, rpm: 249, coolTemp: 40, processTime: 45, quality: 87.0 },
  { temp: 318, rpm: 252, coolTemp: 39, processTime: 44, quality: 87.8 },
  { temp: 320, rpm: 254, coolTemp: 38, processTime: 43, quality: 88.4 },
  { temp: 322, rpm: 256, coolTemp: 38, processTime: 43, quality: 88.9 },
  { temp: 325, rpm: 259, coolTemp: 37, processTime: 42, quality: 89.3 },
  { temp: 328, rpm: 261, coolTemp: 37, processTime: 42, quality: 89.5 },
  { temp: 330, rpm: 263, coolTemp: 36, processTime: 41, quality: 89.7 },
  { temp: 332, rpm: 265, coolTemp: 36, processTime: 41, quality: 89.6 },
  { temp: 335, rpm: 267, coolTemp: 35, processTime: 40, quality: 89.2 },
  { temp: 338, rpm: 269, coolTemp: 35, processTime: 40, quality: 88.5 },
  { temp: 340, rpm: 271, coolTemp: 34, processTime: 39, quality: 87.6 },
  { temp: 342, rpm: 273, coolTemp: 34, processTime: 39, quality: 86.4 },
  { temp: 345, rpm: 275, coolTemp: 33, processTime: 38, quality: 84.8 },
  { temp: 348, rpm: 277, coolTemp: 33, processTime: 38, quality: 82.9 },
  { temp: 350, rpm: 279, coolTemp: 32, processTime: 37, quality: 80.7 },
];

type XParam = "temp" | "rpm" | "coolTemp" | "processTime";

const PARAM_LABELS: Record<XParam, string> = {
  temp:        "용광로 온도 (°C)",
  rpm:         "교반기 RPM",
  coolTemp:    "냉각 온도 (°C)",
  processTime: "공정 시간 (분)",
};

// correlation helpers
function pearson(xs: number[], ys: number[]): number {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  const num = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0);
  const den = Math.sqrt(xs.reduce((s, x) => s + (x - mx) ** 2, 0) * ys.reduce((s, y) => s + (y - my) ** 2, 0));
  return den === 0 ? 0 : num / den;
}

// ─── Scatter Chart ────────────────────────────────────────────────────────────

function ScatterChart({ xKey }: { xKey: XParam }) {
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

    const xs = MOCK_DATA.map((d) => d[xKey]);
    const ys = MOCK_DATA.map((d) => d.quality);

    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = 76, maxY = 92;
    const padL = 48, padR = 20, padT = 20, padB = 38;
    const cW = W - padL - padR;
    const cH = H - padT - padB;

    const px = (x: number) => padL + ((x - minX) / (maxX - minX)) * cW;
    const py = (y: number) => padT + cH - ((y - minY) / (maxY - minY)) * cH;

    // Grid
    for (let i = 0; i <= 4; i++) {
      const gy = padT + (i / 4) * cH;
      ctx.strokeStyle = "#F2F4F7";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(padL, gy);
      ctx.lineTo(padL + cW, gy);
      ctx.stroke();
      const val = maxY - (i / 4) * (maxY - minY);
      ctx.fillStyle = "#9AA4B2";
      ctx.font = "10px sans-serif";
      ctx.textAlign = "right";
      ctx.fillText(val.toFixed(0), padL - 6, gy + 3.5);
    }

    // Trend line (linear regression)
    const n = xs.length;
    const mx = xs.reduce((a, b) => a + b, 0) / n;
    const my = ys.reduce((a, b) => a + b, 0) / n;
    const slope = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0) / xs.reduce((s, x) => s + (x - mx) ** 2, 0);
    const intercept = my - slope * mx;
    const trendY1 = slope * minX + intercept;
    const trendY2 = slope * maxX + intercept;
    ctx.strokeStyle = "#3A5BD9" + "50";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(px(minX), py(trendY1));
    ctx.lineTo(px(maxX), py(trendY2));
    ctx.stroke();
    ctx.setLineDash([]);

    // Dots — color by quality
    MOCK_DATA.forEach((d) => {
      const x = px(d[xKey]);
      const y = py(d.quality);
      const t = (d.quality - minY) / (maxY - minY);
      const r = Math.round(58 + (22 - 58) * t);
      const g = Math.round(91 + (163 - 91) * t);
      const b = Math.round(217 + (74 - 217) * t);
      ctx.beginPath();
      ctx.arc(x, y, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${r},${g},${b},0.85)`;
      ctx.fill();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1.2;
      ctx.stroke();
    });

    // Axes labels
    ctx.fillStyle = "#687182";
    ctx.font = "10.5px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(PARAM_LABELS[xKey], padL + cW / 2, H - 4);

    ctx.save();
    ctx.translate(12, padT + cH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText("품질점수", 0, 0);
    ctx.restore();
  }, [xKey]);

  return <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />;
}

// ─── Correlation Bar ──────────────────────────────────────────────────────────

function CorrelationBar({ label, corr }: { label: string; corr: number }) {
  const abs = Math.abs(corr);
  const positive = corr > 0;
  const color = abs >= 0.8 ? (positive ? "#16A34A" : "#DC2626") : abs >= 0.5 ? "#D97706" : "#9AA4B2";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <div style={{ width: 130, fontSize: 12, color: "#687182", flexShrink: 0 }}>{label}</div>
      <div style={{ flex: 1, height: 10, background: "#F2F4F7", borderRadius: 5, overflow: "hidden" }}>
        <div style={{ width: `${abs * 100}%`, height: "100%", background: color, borderRadius: 5, transition: "width 0.5s" }} />
      </div>
      <div style={{ width: 52, fontSize: 12, fontWeight: 700, color, textAlign: "right", fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>
        {corr >= 0 ? "+" : ""}{corr.toFixed(3)}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ProcessAnalysisPage() {
  const [xKey, setXKey] = useState<XParam>("temp");

  const qualities = MOCK_DATA.map((d) => d.quality);
  const correlations: { key: XParam; label: string; corr: number }[] = (
    Object.keys(PARAM_LABELS) as XParam[]
  ).map((k) => ({
    key: k,
    label: PARAM_LABELS[k],
    corr: pearson(MOCK_DATA.map((d) => d[k]), qualities),
  })).sort((a, b) => Math.abs(b.corr) - Math.abs(a.corr));

  const best = correlations[0];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: "#161B26", margin: 0 }}>공정데이터분석</h1>
        <p style={{ fontSize: 12.5, color: "#687182", margin: "4px 0 0" }}>공정 파라미터와 품질점수 상관관계 분석</p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 20 }}>
        {/* Scatter */}
        <div className="card" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#161B26" }}>파라미터 vs 품질점수</div>
              <div style={{ fontSize: 11.5, color: "#687182", marginTop: 2 }}>X축 파라미터를 선택하세요</div>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              {(Object.keys(PARAM_LABELS) as XParam[]).map((k) => (
                <button
                  key={k}
                  onClick={() => setXKey(k)}
                  style={{
                    padding: "4px 10px", fontSize: 11.5, fontWeight: 600, borderRadius: 6,
                    border: "1px solid", cursor: "pointer", transition: "all 0.1s",
                    borderColor: xKey === k ? "#3A5BD9" : "#E4E7EC",
                    background: xKey === k ? "#3A5BD9" : "#fff",
                    color: xKey === k ? "#fff" : "#687182",
                  }}
                >
                  {k === "temp" ? "온도" : k === "rpm" ? "RPM" : k === "coolTemp" ? "냉각" : "시간"}
                </button>
              ))}
            </div>
          </div>
          <div style={{ height: 300 }}>
            <ScatterChart xKey={xKey} />
          </div>
          <div style={{ fontSize: 11.5, color: "#9AA4B2", textAlign: "center" as const }}>
            점 색상: 파란색(낮은 품질) → 초록색(높은 품질) · 점선: 추세선
          </div>
        </div>

        {/* Correlation panel */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="card">
            <div style={{ fontSize: 13, fontWeight: 700, color: "#161B26", marginBottom: 14 }}>상관계수 순위</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {correlations.map((c) => (
                <CorrelationBar key={c.key} label={c.label} corr={c.corr} />
              ))}
            </div>
            <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid #F2F4F7", fontSize: 11, color: "#9AA4B2" }}>
              Pearson 상관계수 기준 · -1~+1 범위
            </div>
          </div>

          <div className="card" style={{ background: "#EEF1FD", borderColor: "#C7D2F8" }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#1D4ED8", marginBottom: 6 }}>AI 인사이트</div>
            <div style={{ fontSize: 12.5, color: "#1E3A8A", lineHeight: 1.6 }}>
              <strong>{best.label}</strong>이 품질점수와 가장 높은 상관관계({best.corr >= 0 ? "+" : ""}{best.corr.toFixed(3)})를 보입니다.
              {best.corr > 0
                ? ` ${best.label}을 최적 범위로 유지하면 품질 향상에 기여합니다.`
                : ` ${best.label}을 낮게 유지하면 품질 향상에 기여합니다.`}
            </div>
          </div>

          <div className="card">
            <div style={{ fontSize: 13, fontWeight: 700, color: "#161B26", marginBottom: 10 }}>최적 구간 추천</div>
            <div style={{ display: "flex", flexDirection: "column" as const, gap: 8 }}>
              {[
                { label: "용광로 온도", range: "325 – 332 °C",   score: "89.3~89.7" },
                { label: "교반기 RPM", range: "258 – 264 rpm",  score: "88.9~89.6" },
                { label: "냉각 온도",  range: "36 – 38 °C",     score: "88.4~89.7" },
                { label: "공정 시간",  range: "40 – 43 분",     score: "88.4~89.7" },
              ].map((r) => (
                <div key={r.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 8px", background: "#F8F9FB", borderRadius: 6 }}>
                  <span style={{ fontSize: 12, color: "#161B26", fontWeight: 500 }}>{r.label}</span>
                  <div style={{ textAlign: "right" as const }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#3A5BD9", fontVariantNumeric: "tabular-nums" }}>{r.range}</div>
                    <div style={{ fontSize: 10.5, color: "#9AA4B2" }}>품질 {r.score}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
