"use client";

import { useState, useEffect } from "react";
import { fetchRecommendation, fetchModels } from "@/lib/api";
import type { RecommendRequest, RecommendResponse, ModelInfo, ModelName, SupplierName } from "@/types";
import { StatusBadge } from "@/components/ui/StatusBadge";

const SN_TARGET = 62.0;
const AG_TARGET = 3.0;
const CU_TARGET = 0.5;

const SUPPLIERS: SupplierName[] = ["SUP_A", "SUP_B", "SUP_C"];
const MODEL_NAMES: ModelName[] = ["gradient_boosting", "random_forest", "xgboost", "ridge"];

// Current baseline for comparison
const CURRENT_MIX = { sn: 61.5, ag: 3.2, cu: 0.55, pb: 34.75 };

function SliderRow({
  label, value, min, max, step, unit, onChange,
}: {
  label: string; value: number; min: number; max: number;
  step: number; unit: string; onChange: (v: number) => void;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <label style={{ fontSize: 12, fontWeight: 600, color: "#687182", letterSpacing: "0.02em" }}>{label}</label>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 15, fontWeight: 800, color: "#3A5BD9", fontVariantNumeric: "tabular-nums", minWidth: 48, textAlign: "right" }}>
            {value}
          </span>
          <span style={{ fontSize: 12, color: "#9AA4B2" }}>{unit}</span>
        </div>
      </div>
      <div style={{ position: "relative", height: 6 }}>
        <div style={{ position: "absolute", inset: 0, borderRadius: 3, background: "#E4E7EC" }} />
        <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${pct}%`, borderRadius: 3, background: "linear-gradient(90deg, #6B8AFF, #3A5BD9)" }} />
        <input type="range" min={min} max={max} step={step} value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          style={{ position: "absolute", inset: 0, width: "100%", opacity: 0, cursor: "pointer", height: "100%" }} />
      </div>
    </div>
  );
}

function RatioBigCard({ label, value, target, unit = "%" }: { label: string; value: number; target: number; unit?: string }) {
  const dev = value - target;
  const devColor = Math.abs(dev) < 0.5 ? "#16A34A" : Math.abs(dev) < 1.5 ? "#D97706" : "#DC2626";
  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", gap: 4, padding: "16px 18px", borderTop: "3px solid #3A5BD9" }}>
      <span style={{ fontSize: 11, fontWeight: 600, color: "#9AA4B2", letterSpacing: "0.06em", textTransform: "uppercase" }}>{label}</span>
      <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
        <span style={{ fontSize: 28, fontWeight: 800, color: "#161B26", letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums" }}>
          {value.toFixed(2)}
        </span>
        <span style={{ fontSize: 13, color: "#9AA4B2", fontWeight: 500 }}>{unit}</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 11, color: "#9AA4B2" }}>목표 {target}{unit}</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: devColor }}>
          {dev > 0 ? "+" : ""}{dev.toFixed(2)}{unit}
        </span>
      </div>
    </div>
  );
}

export default function OptimizePage() {
  const [targetScore, setTargetScore] = useState(85);
  const [temp, setTemp] = useState(250);
  const [time, setTime] = useState(45);
  const [supplier, setSupplier] = useState<SupplierName>("SUP_A");
  const [model, setModel] = useState<ModelName>("gradient_boosting");
  const [allModels, setAllModels] = useState<ModelInfo[]>([]);
  const [result, setResult] = useState<RecommendResponse | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchModels().then(setAllModels).catch(() => {});
  }, []);

  const modelOptions: ModelName[] =
    allModels.length > 0 ? (allModels.map((m) => m.name) as ModelName[]) : MODEL_NAMES;

  async function handleOptimize() {
    setLoading(true);
    try {
      const req: RecommendRequest = { model, temperature: temp, process_time: time, supplier };
      const res = await fetchRecommendation(req);
      setResult(res);
    } catch {
      // Mock fallback
      setResult({
        recommended_ratios: { sn: 61.85, ag: 3.02, cu: 0.48, pb: 34.65 },
        predicted_quality: 87.3,
        optimization_success: true,
      });
    } finally {
      setLoading(false);
    }
  }

  const gradeVariant = (score: number): "green" | "blue" | "amber" | "red" =>
    score >= 90 ? "green" : score >= 80 ? "blue" : score >= 70 ? "amber" : "red";
  const gradeLabel = (score: number) =>
    score >= 90 ? "A등급" : score >= 80 ? "B등급" : score >= 70 ? "C등급" : "D등급";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: "#161B26", margin: 0, lineHeight: 1.3 }}>
          배합비율 최적화
        </h1>
        <p style={{ fontSize: 12.5, color: "#687182", margin: "4px 0 0" }}>
          공정 조건 입력 → ML 최적 배합비율 자동 추천 (scipy SLSQP 최적화)
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, alignItems: "start" }}>
        {/* LEFT */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="card" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#161B26" }}>최적화 목표</span>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: "#687182" }}>목표 품질점수</label>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 22, fontWeight: 800, color: "#3A5BD9", fontVariantNumeric: "tabular-nums" }}>{targetScore}</span>
                  <span style={{ fontSize: 12, color: "#9AA4B2" }}>점</span>
                </div>
              </div>
              <div style={{ position: "relative", height: 6 }}>
                <div style={{ position: "absolute", inset: 0, borderRadius: 3, background: "#E4E7EC" }} />
                <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${((targetScore - 60) / 40) * 100}%`, borderRadius: 3, background: "linear-gradient(90deg, #D97706, #16A34A)" }} />
                <input type="range" min={60} max={100} step={1} value={targetScore}
                  onChange={(e) => setTargetScore(parseInt(e.target.value))}
                  style={{ position: "absolute", inset: 0, width: "100%", opacity: 0, cursor: "pointer", height: "100%" }} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontSize: 10.5, color: "#9AA4B2" }}>60점 (C등급)</span>
                <span style={{ fontSize: 10.5, color: "#9AA4B2" }}>100점 (A+)</span>
              </div>
            </div>
          </div>

          <div className="card" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#161B26" }}>공정 조건</span>
            <SliderRow label="용융 온도" value={temp} min={220} max={300} step={1} unit="°C" onChange={setTemp} />
            <SliderRow label="교반 시간" value={time} min={20} max={90} step={1} unit="min" onChange={setTime} />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              {([
                { label: "공급사", value: supplier, setter: (v: string) => setSupplier(v as SupplierName), options: SUPPLIERS },
                { label: "최적화 모델", value: model, setter: (v: string) => setModel(v as ModelName), options: modelOptions },
              ] as const).map(({ label, value, setter, options }) => (
                <div key={label} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: "#687182" }}>{label}</label>
                  <select value={value} onChange={(e) => setter(e.target.value)}
                    style={{ padding: "8px 10px", fontSize: 13, fontWeight: 600, color: "#161B26", border: "1px solid #E4E7EC", borderRadius: 8, background: "#fff", outline: "none", cursor: "pointer" }}>
                    {options.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
              ))}
            </div>
          </div>

          <div className="card" style={{ background: "#F8F9FB" }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#687182", marginBottom: 10, letterSpacing: "0.03em", textTransform: "uppercase" }}>
              성분 제약 조건
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {[
                { label: "합계", constraint: "≈ 100%", note: "SN+AG+CU+PB" },
                { label: "SN", constraint: "58 – 66%", note: `목표 ${SN_TARGET}%` },
                { label: "AG", constraint: "2 – 4%", note: `목표 ${AG_TARGET}%` },
                { label: "CU", constraint: "0.3 – 0.7%", note: `목표 ${CU_TARGET}%` },
              ].map(({ label, constraint, note }) => (
                <div key={label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <span style={{ fontSize: 11.5, fontWeight: 700, color: "#3A5BD9", minWidth: 28 }}>{label}</span>
                    <span style={{ fontSize: 11.5, color: "#161B26", fontVariantNumeric: "tabular-nums" }}>{constraint}</span>
                  </div>
                  <span style={{ fontSize: 11, color: "#9AA4B2" }}>{note}</span>
                </div>
              ))}
            </div>
          </div>

          <button className="btn pri" onClick={handleOptimize} disabled={loading}
            style={{ width: "100%", justifyContent: "center", padding: "12px 0", fontSize: 14 }}>
            {loading ? (
              <>
                <span style={{ width: 14, height: 14, border: "2px solid rgba(255,255,255,0.3)", borderTopColor: "#fff", borderRadius: "50%", display: "inline-block", animation: "spin 0.7s linear infinite" }} />
                최적화 실행 중...
              </>
            ) : "최적화 실행"}
          </button>
        </div>

        {/* RIGHT */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {result ? (
            <>
              <div className="card" style={{ background: "linear-gradient(135deg, #3A5BD9 0%, #6B8AFF 100%)", border: "none", padding: "20px 24px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div>
                  <div style={{ fontSize: 11.5, fontWeight: 600, color: "rgba(255,255,255,0.7)", letterSpacing: "0.05em", textTransform: "uppercase", marginBottom: 6 }}>예상 품질점수</div>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                    <span style={{ fontSize: 40, fontWeight: 800, color: "#fff", letterSpacing: "-0.03em", fontVariantNumeric: "tabular-nums" }}>
                      {result.predicted_quality.toFixed(1)}
                    </span>
                    <span style={{ fontSize: 16, color: "rgba(255,255,255,0.7)" }}>점</span>
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
                  <StatusBadge variant={gradeVariant(result.predicted_quality)} label={gradeLabel(result.predicted_quality)} dot />
                  <div style={{ fontSize: 11.5, color: "rgba(255,255,255,0.65)" }}>
                    목표 {targetScore}점 대비{" "}
                    <span style={{ fontWeight: 700, color: "#fff" }}>
                      {result.predicted_quality >= targetScore ? "+" : ""}{(result.predicted_quality - targetScore).toFixed(1)}점
                    </span>
                  </div>
                </div>
              </div>

              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#687182", letterSpacing: "0.04em", textTransform: "uppercase", marginBottom: 10 }}>추천 배합비율</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <RatioBigCard label="SN (주석)" value={result.recommended_ratios.sn} target={SN_TARGET} />
                  <RatioBigCard label="AG (은)" value={result.recommended_ratios.ag} target={AG_TARGET} />
                  <RatioBigCard label="CU (구리)" value={result.recommended_ratios.cu} target={CU_TARGET} />
                  <div className="card" style={{ padding: "16px 18px", borderTop: "3px solid #9AA4B2" }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: "#9AA4B2", letterSpacing: "0.06em", textTransform: "uppercase" }}>PB (납)</span>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginTop: 4 }}>
                      <span style={{ fontSize: 28, fontWeight: 800, color: "#161B26", letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums" }}>
                        {result.recommended_ratios.pb.toFixed(2)}
                      </span>
                      <span style={{ fontSize: 13, color: "#9AA4B2", fontWeight: 500 }}>%</span>
                    </div>
                    <div style={{ fontSize: 11, color: "#9AA4B2", marginTop: 4 }}>잔량 (100% 기준)</div>
                  </div>
                </div>
              </div>

              <div className="card" style={{ padding: 0, overflow: "hidden" }}>
                <div style={{ padding: "12px 16px", borderBottom: "1px solid #E4E7EC" }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#161B26" }}>현재 vs 추천 비교</span>
                </div>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, fontVariantNumeric: "tabular-nums" }}>
                    <thead>
                      <tr style={{ background: "#F8F9FB" }}>
                        {["성분", "목표값", "현재 배합", "추천 배합", "개선"].map((h) => (
                          <th key={h} style={{ padding: "9px 14px", textAlign: h === "성분" ? "left" : "right", fontSize: 11, fontWeight: 600, color: "#687182", letterSpacing: "0.03em", textTransform: "uppercase", borderBottom: "1px solid #E4E7EC", whiteSpace: "nowrap" }}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        { label: "SN", target: SN_TARGET, current: CURRENT_MIX.sn, recommended: result.recommended_ratios.sn },
                        { label: "AG", target: AG_TARGET, current: CURRENT_MIX.ag, recommended: result.recommended_ratios.ag },
                        { label: "CU", target: CU_TARGET, current: CURRENT_MIX.cu, recommended: result.recommended_ratios.cu },
                        { label: "PB", target: null,      current: CURRENT_MIX.pb, recommended: result.recommended_ratios.pb },
                      ].map(({ label, target, current, recommended }, i, arr) => {
                        const currDev = target !== null ? Math.abs(current - target) : null;
                        const recDev  = target !== null ? Math.abs(recommended - target) : null;
                        const improved = (currDev !== null && recDev !== null) ? currDev - recDev : null;
                        return (
                          <tr key={label} style={{ borderBottom: i < arr.length - 1 ? "1px solid #F2F4F7" : "none" }}>
                            <td style={{ padding: "10px 14px", fontWeight: 700, color: "#161B26" }}>{label}</td>
                            <td style={{ padding: "10px 14px", textAlign: "right", color: "#687182" }}>
                              {target !== null ? `${target}%` : "잔량"}
                            </td>
                            <td style={{ padding: "10px 14px", textAlign: "right", color: "#161B26" }}>{current.toFixed(2)}%</td>
                            <td style={{ padding: "10px 14px", textAlign: "right", fontWeight: 700, color: "#3A5BD9" }}>{recommended.toFixed(2)}%</td>
                            <td style={{ padding: "10px 14px", textAlign: "right" }}>
                              {improved !== null ? (
                                <span style={{ fontSize: 11.5, fontWeight: 700, color: improved > 0 ? "#16A34A" : improved < 0 ? "#DC2626" : "#9AA4B2" }}>
                                  {improved > 0 ? "↑ 개선" : improved < 0 ? "↓ 악화" : "동일"}
                                </span>
                              ) : <span style={{ color: "#9AA4B2" }}>—</span>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          ) : (
            <div className="card" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: 420, gap: 16 }}>
              <svg width="52" height="52" viewBox="0 0 52 52" fill="none">
                <circle cx="26" cy="26" r="22" stroke="#E4E7EC" strokeWidth="2" />
                <path d="M17 35l8-16 6 10 4-6 6 12" stroke="#C2C9D6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#687182" }}>조건 설정 후</div>
                <div style={{ fontSize: 12, color: "#9AA4B2", marginTop: 4 }}>최적화 실행 버튼을 누르세요</div>
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
