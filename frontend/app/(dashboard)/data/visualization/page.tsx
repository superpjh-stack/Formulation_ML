"use client";

import { useEffect, useRef, useState } from "react";

// ─── Mock Data ────────────────────────────────────────────────────────────────

type MetricKey = "quality" | "snDev" | "agDev" | "cuDev" | "efficiency" | "output";
type DimKey    = "date" | "supplier" | "product" | "shift";

const METRIC_LABELS: Record<MetricKey, string> = {
  quality:    "품질점수",
  snDev:      "SN 편차",
  agDev:      "AG 편차",
  cuDev:      "CU 편차",
  efficiency: "공정 효율(%)",
  output:     "생산량(kg)",
};

const DIM_LABELS: Record<DimKey, string> = {
  date:     "날짜",
  supplier: "공급사",
  product:  "제품",
  shift:    "교대조",
};

// Generate 30 days of mock data
const DATES = Array.from({ length: 30 }, (_, i) => {
  const d = new Date("2026-06-01");
  d.setDate(d.getDate() + i);
  return d.toISOString().slice(5, 10);
});

const SUPPLIERS = ["SUP_A", "SUP_B", "SUP_C", "SUP_D"];
const PRODUCTS  = ["Sn63Pb37", "Sn96.5Ag3Cu0.5", "Sn60Pb40"];
const SHIFTS    = ["주간", "야간"];

type Row = { date: string; supplier: string; product: string; shift: string } & Record<MetricKey, number>;

const DATA: Row[] = DATES.flatMap((date, di) =>
  SUPPLIERS.map((supplier, si) => ({
    date,
    supplier,
    product:  PRODUCTS[(di + si) % PRODUCTS.length],
    shift:    SHIFTS[si % 2],
    quality:    80 + Math.sin(di * 0.3 + si) * 6 + Math.random() * 2,
    snDev:      0.05 + Math.abs(Math.sin(di * 0.2 + si * 0.5)) * 0.3,
    agDev:      0.02 + Math.abs(Math.cos(di * 0.25 + si)) * 0.15,
    cuDev:      0.005 + Math.abs(Math.sin(di * 0.4)) * 0.05,
    efficiency: 88 + Math.sin(di * 0.2 + si * 0.3) * 8 + Math.random() * 3,
    output:     400 + Math.sin(di * 0.15) * 150 + si * 30 + Math.random() * 50,
  }))
);

// Aggregate by dimension
function aggregate(dim: DimKey, metric: MetricKey): { label: string; value: number }[] {
  const groups: Record<string, number[]> = {};
  DATA.forEach((row) => {
    const key = row[dim];
    if (!groups[key]) groups[key] = [];
    groups[key].push(row[metric]);
  });
  return Object.entries(groups).map(([label, vals]) => ({
    label,
    value: Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100,
  }));
}

// ─── Bar / Line Chart ─────────────────────────────────────────────────────────

type ChartType = "bar" | "line";

function DynamicChart({ data, metric, chartType }: { data: { label: string; value: number }[]; metric: MetricKey; chartType: ChartType }) {
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

    const values = data.map((d) => d.value);
    const minV = Math.min(...values) * 0.92;
    const maxV = Math.max(...values) * 1.06;
    const padL = 56, padR = 20, padT = 20, padB = 48;
    const cW = W - padL - padR;
    const cH = H - padT - padB;

    const px = (i: number) => padL + (i / (data.length - 1 || 1)) * cW;
    const py = (v: number) => padT + cH - ((v - minV) / (maxV - minV || 1)) * cH;

    // Grid
    for (let i = 0; i <= 4; i++) {
      const gy = padT + (i / 4) * cH;
      ctx.strokeStyle = "#F2F4F7";
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(padL, gy); ctx.lineTo(padL + cW, gy); ctx.stroke();
      const val = maxV - (i / 4) * (maxV - minV);
      ctx.fillStyle = "#9AA4B2";
      ctx.font = "10px sans-serif";
      ctx.textAlign = "right";
      ctx.fillText(val.toFixed(1), padL - 6, gy + 3.5);
    }

    const COLORS = ["#3A5BD9", "#16A34A", "#F59E0B", "#DC2626", "#7C3AED", "#0891B2"];
    const n = data.length;

    if (chartType === "bar") {
      const barW = Math.max(8, Math.min(40, cW / n * 0.6));
      data.forEach((d, i) => {
        const x = padL + (i / (n - 1 || 1)) * cW - barW / 2;
        if (n <= 6) {
          // use per-item color for small sets
          const bH = ((d.value - minV) / (maxV - minV || 1)) * cH;
          ctx.fillStyle = (COLORS[i % COLORS.length]) + "CC";
          ctx.beginPath();
          ctx.roundRect(x, padT + cH - bH, barW, bH, [3, 3, 0, 0]);
          ctx.fill();
        } else {
          const bH = ((d.value - minV) / (maxV - minV || 1)) * cH;
          ctx.fillStyle = "#3A5BD9CC";
          ctx.beginPath();
          ctx.roundRect(x, padT + cH - bH, barW, bH, [2, 2, 0, 0]);
          ctx.fill();
        }
      });
    } else {
      // Line + area
      const grad = ctx.createLinearGradient(0, padT, 0, padT + cH);
      grad.addColorStop(0, "#3A5BD930");
      grad.addColorStop(1, "#3A5BD900");
      ctx.beginPath();
      ctx.moveTo(px(0), py(values[0]));
      for (let i = 1; i < data.length; i++) {
        const xc = (px(i - 1) + px(i)) / 2;
        ctx.quadraticCurveTo(px(i - 1), py(values[i - 1]), xc, (py(values[i - 1]) + py(values[i])) / 2);
      }
      ctx.lineTo(px(n - 1), py(values[n - 1]));
      ctx.lineTo(px(n - 1), padT + cH);
      ctx.lineTo(px(0), padT + cH);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(px(0), py(values[0]));
      for (let i = 1; i < data.length; i++) {
        const xc = (px(i - 1) + px(i)) / 2;
        ctx.quadraticCurveTo(px(i - 1), py(values[i - 1]), xc, (py(values[i - 1]) + py(values[i])) / 2);
      }
      ctx.lineTo(px(n - 1), py(values[n - 1]));
      ctx.strokeStyle = "#3A5BD9";
      ctx.lineWidth = 2;
      ctx.stroke();

      // Dots every ~5 items
      data.forEach((d, i) => {
        if (i % Math.max(1, Math.floor(n / 8)) === 0 || i === n - 1) {
          ctx.beginPath();
          ctx.arc(px(i), py(d.value), 3.5, 0, Math.PI * 2);
          ctx.fillStyle = "#3A5BD9";
          ctx.fill();
          ctx.strokeStyle = "#fff";
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
      });
    }

    // X labels
    const step = Math.max(1, Math.floor(n / 8));
    data.forEach((d, i) => {
      if (i % step === 0 || i === n - 1) {
        ctx.fillStyle = "#9AA4B2";
        ctx.font = "10px sans-serif";
        ctx.textAlign = "center";
        const label = d.label.length > 10 ? d.label.slice(0, 9) + "…" : d.label;
        ctx.fillText(label, px(i), H - padB + 14);
      }
    });
  }, [data, metric, chartType]);

  return <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />;
}

// ─── Preset Templates ─────────────────────────────────────────────────────────

const TEMPLATES: { label: string; dim: DimKey; metric: MetricKey; chartType: ChartType; desc: string }[] = [
  { label: "공급사별 품질점수",   dim: "supplier", metric: "quality",    chartType: "bar",  desc: "공급사별 평균 품질점수 비교" },
  { label: "일별 생산량 추이",    dim: "date",     metric: "output",     chartType: "line", desc: "30일간 일별 생산량 변화" },
  { label: "제품별 공정 효율",    dim: "product",  metric: "efficiency", chartType: "bar",  desc: "제품별 평균 공정 효율 비교" },
  { label: "교대조별 SN편차",     dim: "shift",    metric: "snDev",      chartType: "bar",  desc: "주간/야간 교대별 SN 성분 편차" },
  { label: "일별 AG편차 추이",    dim: "date",     metric: "agDev",      chartType: "line", desc: "30일간 AG 성분 편차 변화" },
];

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DataVisualizationPage() {
  const [dim,       setDim]       = useState<DimKey>("date");
  const [metric,    setMetric]    = useState<MetricKey>("quality");
  const [chartType, setChartType] = useState<ChartType>("line");

  const chartData = aggregate(dim, metric);

  function applyTemplate(t: typeof TEMPLATES[0]) {
    setDim(t.dim);
    setMetric(t.metric);
    setChartType(t.chartType);
  }

  const avg = chartData.length ? (chartData.reduce((s, d) => s + d.value, 0) / chartData.length) : 0;
  const max = chartData.length ? Math.max(...chartData.map((d) => d.value)) : 0;
  const min = chartData.length ? Math.min(...chartData.map((d) => d.value)) : 0;

  const selectStyle = {
    padding: "7px 10px", fontSize: 13, border: "1px solid #E4E7EC",
    borderRadius: 7, background: "#fff", color: "#161B26", outline: "none", cursor: "pointer",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: "#161B26", margin: 0 }}>데이터 시각화</h1>
        <p style={{ fontSize: 12.5, color: "#687182", margin: "4px 0 0" }}>동적 차트 빌더 · 축과 지표를 자유롭게 조합</p>
      </div>

      {/* Preset templates */}
      <div className="card">
        <div style={{ fontSize: 12, fontWeight: 700, color: "#687182", letterSpacing: "0.03em", textTransform: "uppercase" as const, marginBottom: 10 }}>
          사전 정의 템플릿
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" as const }}>
          {TEMPLATES.map((t) => (
            <button
              key={t.label}
              onClick={() => applyTemplate(t)}
              title={t.desc}
              style={{
                padding: "6px 14px", fontSize: 12.5, fontWeight: 600, borderRadius: 8,
                border: "1px solid #C7D2F8", background: "#EEF1FD", color: "#1D4ED8", cursor: "pointer",
                transition: "all 0.1s",
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Builder + Chart */}
      <div style={{ display: "grid", gridTemplateColumns: "240px 1fr", gap: 20 }}>
        {/* Controls */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="card" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#161B26" }}>차트 설정</div>
            <div style={{ display: "flex", flexDirection: "column" as const, gap: 4 }}>
              <label style={{ fontSize: 11.5, fontWeight: 600, color: "#687182" }}>X축 (구분 기준)</label>
              <select style={selectStyle} value={dim} onChange={(e) => setDim(e.target.value as DimKey)}>
                {(Object.keys(DIM_LABELS) as DimKey[]).map((k) => (
                  <option key={k} value={k}>{DIM_LABELS[k]}</option>
                ))}
              </select>
            </div>
            <div style={{ display: "flex", flexDirection: "column" as const, gap: 4 }}>
              <label style={{ fontSize: 11.5, fontWeight: 600, color: "#687182" }}>Y축 (지표)</label>
              <select style={selectStyle} value={metric} onChange={(e) => setMetric(e.target.value as MetricKey)}>
                {(Object.keys(METRIC_LABELS) as MetricKey[]).map((k) => (
                  <option key={k} value={k}>{METRIC_LABELS[k]}</option>
                ))}
              </select>
            </div>
            <div style={{ display: "flex", flexDirection: "column" as const, gap: 4 }}>
              <label style={{ fontSize: 11.5, fontWeight: 600, color: "#687182" }}>차트 유형</label>
              <div style={{ display: "flex", gap: 8 }}>
                {(["bar", "line"] as ChartType[]).map((t) => (
                  <button
                    key={t}
                    onClick={() => setChartType(t)}
                    style={{
                      flex: 1, padding: "7px 0", fontSize: 12.5, fontWeight: 600, borderRadius: 7,
                      border: "1px solid", cursor: "pointer",
                      borderColor: chartType === t ? "#3A5BD9" : "#E4E7EC",
                      background: chartType === t ? "#3A5BD9" : "#fff",
                      color: chartType === t ? "#fff" : "#687182",
                    }}
                  >
                    {t === "bar" ? "막대" : "선형"}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Stats */}
          <div className="card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#161B26" }}>요약 통계</div>
            {[
              { label: "평균", value: avg },
              { label: "최대", value: max },
              { label: "최소", value: min },
            ].map((s) => (
              <div key={s.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 12, color: "#687182" }}>{s.label}</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: "#161B26", fontVariantNumeric: "tabular-nums" }}>
                  {s.value.toFixed(2)}
                </span>
              </div>
            ))}
            <div style={{ fontSize: 11, color: "#9AA4B2", borderTop: "1px solid #F2F4F7", paddingTop: 8, marginTop: 2 }}>
              데이터 포인트: {chartData.length}개
            </div>
          </div>
        </div>

        {/* Chart area */}
        <div className="card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#161B26" }}>
                {DIM_LABELS[dim]}별 {METRIC_LABELS[metric]}
              </div>
              <div style={{ fontSize: 11.5, color: "#687182", marginTop: 2 }}>
                평균 집계 · 전체 기간
              </div>
            </div>
            <button style={{ padding: "5px 14px", fontSize: 12, fontWeight: 600, borderRadius: 6, border: "1px solid #E4E7EC", background: "#F8F9FB", color: "#687182", cursor: "pointer" }}>
              PNG 저장
            </button>
          </div>
          <div style={{ flex: 1, height: 360 }}>
            <DynamicChart data={chartData} metric={metric} chartType={chartType} />
          </div>
        </div>
      </div>
    </div>
  );
}
