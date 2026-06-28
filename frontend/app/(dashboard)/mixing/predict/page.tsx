"use client";

import { useState, useEffect, useRef } from "react";
import { fetchPrediction, fetchModels } from "@/lib/api";
import type { PredictRequest, PredictResponse, ModelInfo, ModelName, SupplierName } from "@/types";
import { KpiCard } from "@/components/ui/KpiCard";
import { StatusBadge } from "@/components/ui/StatusBadge";

const SN_TARGET = 62.0;
const AG_TARGET = 3.0;
const CU_TARGET = 0.5;

const SUPPLIERS: SupplierName[] = ["SUP_A", "SUP_B", "SUP_C"];
const MODEL_NAMES: ModelName[] = ["gradient_boosting", "random_forest", "xgboost", "ridge"];

// ── Gauge ──────────────────────────────────────────────────────────────────

function QualityGauge({ score }: { score: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const W = 200;
    const H = 120;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.scale(dpr, dpr);
    const cx = W / 2;
    const cy = H - 10;
    const r = 80;

    ctx.beginPath();
    ctx.arc(cx, cy, r, Math.PI, 2 * Math.PI);
    ctx.lineWidth = 14;
    ctx.strokeStyle = "#E4E7EC";
    ctx.lineCap = "round";
    ctx.stroke();

    const pct = Math.min(score / 100, 1);
    const scoreAngle = Math.PI + pct * Math.PI;
    const color =
      score >= 90 ? "#16A34A" : score >= 80 ? "#3A5BD9" : score >= 70 ? "#D97706" : "#DC2626";
    const grad = ctx.createLinearGradient(cx - r, cy, cx + r, cy);
    grad.addColorStop(0, color + "99");
    grad.addColorStop(1, color);
    ctx.beginPath();
    ctx.arc(cx, cy, r, Math.PI, scoreAngle);
    ctx.lineWidth = 14;
    ctx.strokeStyle = grad;
    ctx.lineCap = "round";
    ctx.stroke();

    const nx = cx + (r - 7) * Math.cos(scoreAngle);
    const ny = cy + (r - 7) * Math.sin(scoreAngle);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(nx, ny);
    ctx.strokeStyle = "#161B26";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, 5, 0, Math.PI * 2);
    ctx.fillStyle = "#161B26";
    ctx.fill();
  }, [score]);

  const grade = score >= 90 ? "A" : score >= 80 ? "B" : score >= 70 ? "C" : "D";
  const gradeVariant: "green" | "blue" | "amber" | "red" =
    score >= 90 ? "green" : score >= 80 ? "blue" : score >= 70 ? "amber" : "red";

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
      <canvas ref={canvasRef} style={{ width: 200, height: 120, display: "block" }} />
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: -12 }}>
        <span style={{ fontSize: 36, fontWeight: 800, color: "#161B26", letterSpacing: "-0.03em", fontVariantNumeric: "tabular-nums" }}>
          {score.toFixed(1)}
        </span>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <StatusBadge variant={gradeVariant} label={`등급 ${grade}`} dot />
          <span style={{ fontSize: 11, color: "#9AA4B2" }}>/ 100점</span>
        </div>
      </div>
    </div>
  );
}

// ── Slider input ───────────────────────────────────────────────────────────

function SliderInput({
  label, value, min, max, step, unit, target, onChange,
}: {
  label: string; value: number; min: number; max: number; step: number;
  unit: string; target?: number; onChange: (v: number) => void;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  const deviation = target !== undefined ? value - target : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <label style={{ fontSize: 12, fontWeight: 600, color: "#687182", letterSpacing: "0.02em" }}>
          {label}
        </label>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {deviation !== null && (
            <span style={{ fontSize: 11, fontWeight: 600, color: Math.abs(deviation) > 2 ? "#DC2626" : Math.abs(deviation) > 1 ? "#D97706" : "#16A34A" }}>
              {deviation > 0 ? "+" : ""}{deviation.toFixed(1)}%
            </span>
          )}
          <input
            type="number" value={value} min={min} max={max} step={step}
            onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
            style={{ width: 64, padding: "3px 8px", fontSize: 13, fontWeight: 700, color: "#161B26", border: "1px solid #E4E7EC", borderRadius: 6, textAlign: "right", fontVariantNumeric: "tabular-nums", outline: "none" }}
          />
          <span style={{ fontSize: 12, color: "#9AA4B2", minWidth: 20 }}>{unit}</span>
        </div>
      </div>
      <div style={{ position: "relative", height: 6 }}>
        <div style={{ position: "absolute", inset: 0, borderRadius: 3, background: "#E4E7EC" }} />
        <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${pct}%`, borderRadius: 3, background: "linear-gradient(90deg, #6B8AFF, #3A5BD9)" }} />
        <input type="range" min={min} max={max} step={step} value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          style={{ position: "absolute", inset: 0, width: "100%", opacity: 0, cursor: "pointer", height: "100%" }} />
      </div>
      {target !== undefined && (
        <div style={{ fontSize: 10.5, color: "#9AA4B2" }}>목표값: {target}{unit}</div>
      )}
    </div>
  );
}

// ── Radar canvas ───────────────────────────────────────────────────────────

function RadarCanvas({ sn, ag, cu, pb }: { sn: number; ag: number; cu: number; pb: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const W = 220; const H = 220;
    canvas.width = W * dpr; canvas.height = H * dpr;
    ctx.scale(dpr, dpr);
    const cx = W / 2; const cy = H / 2; const r = 80;
    const labels = ["SN", "AG", "CU", "PB"];
    const norms = [Math.min(sn / 70, 1), Math.min(ag / 5, 1), Math.min(cu / 1, 1), Math.min(pb / 40, 1)];
    const angles = labels.map((_, i) => (i * 2 * Math.PI) / labels.length - Math.PI / 2);

    for (let level = 1; level <= 4; level++) {
      ctx.beginPath();
      angles.forEach((a, i) => {
        const x = cx + (r * level) / 4 * Math.cos(a);
        const y = cy + (r * level) / 4 * Math.sin(a);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.closePath(); ctx.strokeStyle = "#E4E7EC"; ctx.lineWidth = 1; ctx.stroke();
    }
    angles.forEach((a) => {
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + r * Math.cos(a), cy + r * Math.sin(a));
      ctx.strokeStyle = "#E4E7EC"; ctx.lineWidth = 1; ctx.stroke();
    });
    ctx.beginPath();
    angles.forEach((a, i) => {
      const x = cx + r * norms[i] * Math.cos(a); const y = cy + r * norms[i] * Math.sin(a);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.closePath(); ctx.fillStyle = "#3A5BD940"; ctx.fill();
    ctx.strokeStyle = "#3A5BD9"; ctx.lineWidth = 2; ctx.stroke();

    angles.forEach((a, i) => {
      const x = cx + r * norms[i] * Math.cos(a); const y = cy + r * norms[i] * Math.sin(a);
      ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fillStyle = "#3A5BD9"; ctx.fill();
      ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.5; ctx.stroke();
      const lx = cx + (r + 16) * Math.cos(a); const ly = cy + (r + 16) * Math.sin(a);
      ctx.fillStyle = "#687182"; ctx.font = `600 11px -apple-system, sans-serif`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(labels[i], lx, ly);
    });
  }, [sn, ag, cu, pb]);

  return <canvas ref={canvasRef} style={{ width: 220, height: 220, display: "block" }} />;
}

// ── Page ───────────────────────────────────────────────────────────────────

export default function PredictPage() {
  const [sn, setSn] = useState(62.0);
  const [ag, setAg] = useState(3.0);
  const [cu, setCu] = useState(0.5);
  const [pb, setPb] = useState(34.5);
  const [temp, setTemp] = useState(250);
  const [time, setTime] = useState(45);
  const [supplier, setSupplier] = useState<SupplierName>("SUP_A");
  const [model, setModel] = useState<ModelName>("gradient_boosting");
  const [allModels, setAllModels] = useState<ModelInfo[]>([]);
  const [result, setResult] = useState<PredictResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const total = sn + ag + cu + pb;

  useEffect(() => {
    fetchModels().then(setAllModels).catch(() => {});
  }, []);

  const modelOptions: ModelName[] =
    allModels.length > 0
      ? (allModels.map((m) => m.name) as ModelName[])
      : MODEL_NAMES;

  async function handlePredict() {
    setLoading(true);
    try {
      const req: PredictRequest = {
        model,
        sn_ratio: sn,
        ag_ratio: ag,
        cu_ratio: cu,
        pb_ratio: pb,
        temperature: temp,
        process_time: time,
        supplier,
      };
      const res = await fetchPrediction(req);
      setResult(res);
    } catch {
      // Mock result for demo when API is unavailable
      setResult({ predicted_quality: 83.4, model_used: model });
    } finally {
      setLoading(false);
    }
  }

  const totalColor =
    Math.abs(total - 100) < 0.5 ? "#16A34A" : Math.abs(total - 100) < 2 ? "#D97706" : "#DC2626";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: "#161B26", margin: 0, lineHeight: 1.3 }}>
          품질예측 분석
        </h1>
        <p style={{ fontSize: 12.5, color: "#687182", margin: "4px 0 0" }}>
          성분 비율 및 공정 조건 입력 → ML 품질점수 예측
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, alignItems: "start" }}>
        {/* LEFT */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="card" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: "#161B26" }}>성분 비율</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: totalColor, background: totalColor + "14", padding: "2px 10px", borderRadius: 20 }}>
                합계 {total.toFixed(1)}%
              </span>
            </div>
            <SliderInput label="SN (주석)" value={sn} min={55} max={70} step={0.1} unit="%" target={SN_TARGET} onChange={setSn} />
            <SliderInput label="AG (은)" value={ag} min={0} max={6} step={0.1} unit="%" target={AG_TARGET} onChange={setAg} />
            <SliderInput label="CU (구리)" value={cu} min={0} max={2} step={0.05} unit="%" target={CU_TARGET} onChange={setCu} />
            <SliderInput label="PB (납)" value={pb} min={25} max={45} step={0.1} unit="%" onChange={setPb} />
          </div>

          <div className="card" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#161B26" }}>공정 조건</span>
            <SliderInput label="용융 온도" value={temp} min={220} max={300} step={1} unit="°C" onChange={setTemp} />
            <SliderInput label="교반 시간" value={time} min={20} max={90} step={1} unit="min" onChange={setTime} />

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              {([
                { label: "공급사", value: supplier, setter: (v: string) => setSupplier(v as SupplierName), options: SUPPLIERS },
                { label: "예측 모델", value: model, setter: (v: string) => setModel(v as ModelName), options: modelOptions },
              ] as const).map(({ label, value, setter, options }) => (
                <div key={label} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: "#687182", letterSpacing: "0.02em" }}>{label}</label>
                  <select value={value} onChange={(e) => setter(e.target.value)}
                    style={{ padding: "8px 10px", fontSize: 13, fontWeight: 600, color: "#161B26", border: "1px solid #E4E7EC", borderRadius: 8, background: "#fff", outline: "none", cursor: "pointer" }}>
                    {options.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
              ))}
            </div>
          </div>

          <button className="btn pri" onClick={handlePredict} disabled={loading}
            style={{ width: "100%", justifyContent: "center", padding: "12px 0", fontSize: 14 }}>
            {loading ? (
              <>
                <span style={{ width: 14, height: 14, border: "2px solid rgba(255,255,255,0.3)", borderTopColor: "#fff", borderRadius: "50%", display: "inline-block", animation: "spin 0.7s linear infinite" }} />
                예측 중...
              </>
            ) : "품질 예측 실행"}
          </button>
        </div>

        {/* RIGHT */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {result ? (
            <>
              <div className="card" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16, padding: "24px 20px" }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: "#161B26", alignSelf: "flex-start" }}>품질점수 예측 결과</span>
                <QualityGauge score={result.predicted_quality} />
                <div style={{ fontSize: 11.5, color: "#9AA4B2" }}>
                  모델: <strong style={{ color: "#687182" }}>{result.model_used}</strong>
                </div>
              </div>

              <div className="card" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: "#161B26" }}>성분 편차 분석</span>
                {[
                  { label: "SN (주석)", actual: sn, target: SN_TARGET },
                  { label: "AG (은)", actual: ag, target: AG_TARGET },
                  { label: "CU (구리)", actual: cu, target: CU_TARGET },
                ].map(({ label, actual, target }) => {
                  const dev = actual - target;
                  const pctDev = (dev / target) * 100;
                  const isOk = Math.abs(pctDev) < 3;
                  const isWarn = Math.abs(pctDev) >= 3 && Math.abs(pctDev) < 5;
                  const color = isOk ? "#16A34A" : isWarn ? "#D97706" : "#DC2626";
                  const bg = isOk ? "#ECFDF3" : isWarn ? "#FEF6E7" : "#FEF1F2";
                  return (
                    <div key={label} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", background: bg, borderRadius: 8 }}>
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 600, color: "#161B26" }}>{label}</div>
                        <div style={{ fontSize: 11, color: "#687182", marginTop: 2 }}>측정값 {actual.toFixed(1)}% / 목표 {target}%</div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontSize: 16, fontWeight: 800, color, fontVariantNumeric: "tabular-nums" }}>
                          {dev > 0 ? "+" : ""}{dev.toFixed(2)}%
                        </div>
                        <div style={{ fontSize: 10.5, color, fontWeight: 600 }}>
                          ({pctDev > 0 ? "+" : ""}{pctDev.toFixed(1)}%)
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="card" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: "#161B26", alignSelf: "flex-start" }}>성분 구성 레이더</span>
                <RadarCanvas sn={sn} ag={ag} cu={cu} pb={pb} />
              </div>
            </>
          ) : (
            <div className="card" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: 400, gap: 16, color: "#9AA4B2" }}>
              <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
                <circle cx="24" cy="24" r="20" stroke="#E4E7EC" strokeWidth="2" />
                <path d="M16 24h16M24 16v16" stroke="#C2C9D6" strokeWidth="2" strokeLinecap="round" />
              </svg>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#687182" }}>성분 조건 입력 후</div>
                <div style={{ fontSize: 12, color: "#9AA4B2", marginTop: 4 }}>품질 예측 실행 버튼을 누르세요</div>
              </div>
            </div>
          )}
        </div>
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        input[type=range]:focus { outline: none; }
      `}</style>
    </div>
  );
}
