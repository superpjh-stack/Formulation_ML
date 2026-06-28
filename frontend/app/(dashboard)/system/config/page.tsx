"use client";

import { useState } from "react";
import { StatusBadge } from "@/components/ui/StatusBadge";

interface ModelConfig {
  name: string;
  version: string;
  rmse: number;
  r2: number;
  active: boolean;
  lastTrained: string;
}

const MODELS: ModelConfig[] = [
  { name: "GradientBoosting", version: "v3.2", rmse: 3.05, r2: 0.627, active: true,  lastTrained: "2026-06-25" },
  { name: "RandomForest",     version: "v2.1", rmse: 3.21, r2: 0.588, active: false, lastTrained: "2026-06-20" },
  { name: "XGBoost",          version: "v1.4", rmse: 3.18, r2: 0.601, active: false, lastTrained: "2026-06-18" },
  { name: "Ridge",            version: "v1.0", rmse: 4.52, r2: 0.421, active: false, lastTrained: "2026-06-10" },
];

interface ThresholdItem {
  id: string;
  label: string;
  description: string;
  value: number;
  unit: string;
  min: number;
  max: number;
  step: number;
}

const INITIAL_THRESHOLDS: ThresholdItem[] = [
  { id: "sn_dev",     label: "Sn 편차 경보 임계치",    description: "목표값 대비 Sn 함량 허용 편차",        value: 1.5,  unit: "%",  min: 0.5, max: 5.0,  step: 0.1 },
  { id: "ag_dev",     label: "Ag 편차 경보 임계치",    description: "목표값 대비 Ag 함량 허용 편차",        value: 0.1,  unit: "%",  min: 0.05, max: 0.5, step: 0.05 },
  { id: "cu_dev",     label: "Cu 편차 경보 임계치",    description: "목표값 대비 Cu 함량 허용 편차",        value: 0.05, unit: "%",  min: 0.01, max: 0.2, step: 0.01 },
  { id: "r2_min",     label: "모델 R² 최소 임계치",    description: "R²가 이 값 미만이면 재학습 권장",      value: 0.75, unit: "",   min: 0.5,  max: 0.99, step: 0.01 },
  { id: "retrain_d",  label: "자동 재학습 주기",       description: "주기적 모델 재학습 간격",              value: 7,    unit: "일", min: 1,    max: 30,   step: 1 },
  { id: "batch_h",    label: "배치 예측 주기",         description: "ML 배치 예측 실행 간격",               value: 6,    unit: "시간", min: 1,  max: 24,   step: 1 },
];

export default function ConfigPage() {
  const [activeModel, setActiveModel] = useState("GradientBoosting");
  const [thresholds, setThresholds] = useState(INITIAL_THRESHOLDS);
  const [saved, setSaved] = useState(false);

  function updateThreshold(id: string, val: number) {
    setThresholds((p) => p.map((t) => t.id === id ? { ...t, value: val } : t));
    setSaved(false);
  }

  function handleSave() {
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: "#161B26", margin: 0 }}>시스템 설정</h1>
          <p style={{ fontSize: 12.5, color: "#687182", margin: "4px 0 0" }}>ML 모델 및 알림 임계치 설정</p>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {saved && <StatusBadge variant="green" label="저장 완료" dot />}
          <button
            onClick={handleSave}
            style={{ padding: "8px 20px", fontSize: 13, fontWeight: 600, borderRadius: 8, border: "none", background: "#3A5BD9", color: "#fff", cursor: "pointer" }}
          >
            설정 저장
          </button>
        </div>
      </div>

      {/* Model selection */}
      <div className="card">
        <div style={{ fontSize: 13, fontWeight: 700, color: "#161B26", marginBottom: 16 }}>활성 ML 모델 설정</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12 }}>
          {MODELS.map((m) => (
            <div
              key={m.name}
              onClick={() => setActiveModel(m.name)}
              style={{
                padding: "14px 16px", borderRadius: 10, cursor: "pointer",
                border: `2px solid ${activeModel === m.name ? "#3A5BD9" : "#E4E7EC"}`,
                background: activeModel === m.name ? "#EEF1FD" : "#fff",
                transition: "all 0.15s",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: "#161B26" }}>{m.name}</span>
                <div style={{ display: "flex", gap: 6 }}>
                  <StatusBadge variant="gray" label={m.version} />
                  {activeModel === m.name && <StatusBadge variant="blue" label="활성" dot />}
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {[
                  { label: "RMSE", value: m.rmse.toFixed(2), good: m.rmse < 3.2 },
                  { label: "R²",   value: m.r2.toFixed(3),   good: m.r2 > 0.6 },
                ].map((s) => (
                  <div key={s.label} style={{ background: "#F8F9FB", borderRadius: 6, padding: "6px 10px" }}>
                    <div style={{ fontSize: 10.5, color: "#9AA4B2", fontWeight: 600 }}>{s.label}</div>
                    <div style={{ fontSize: 14, fontWeight: 800, fontVariantNumeric: "tabular-nums", color: s.good ? "#15803D" : "#B91C1C" }}>{s.value}</div>
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 11, color: "#9AA4B2", marginTop: 8 }}>마지막 학습: {m.lastTrained}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Thresholds */}
      <div className="card">
        <div style={{ fontSize: 13, fontWeight: 700, color: "#161B26", marginBottom: 16 }}>임계치 설정</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {thresholds.map((t) => (
            <div key={t.id}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
                <div>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "#161B26" }}>{t.label}</span>
                  <span style={{ fontSize: 11.5, color: "#9AA4B2", marginLeft: 8 }}>{t.description}</span>
                </div>
                <span style={{ fontSize: 14, fontWeight: 800, color: "#3A5BD9", fontVariantNumeric: "tabular-nums", minWidth: 60, textAlign: "right" }}>
                  {t.value}{t.unit}
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 11, color: "#9AA4B2", width: 36, textAlign: "right" }}>{t.min}</span>
                <input
                  type="range"
                  min={t.min} max={t.max} step={t.step}
                  value={t.value}
                  onChange={(e) => updateThreshold(t.id, parseFloat(e.target.value))}
                  style={{ flex: 1, accentColor: "#3A5BD9", height: 4 }}
                />
                <span style={{ fontSize: 11, color: "#9AA4B2", width: 36 }}>{t.max}</span>
                <input
                  type="number"
                  min={t.min} max={t.max} step={t.step}
                  value={t.value}
                  onChange={(e) => updateThreshold(t.id, parseFloat(e.target.value))}
                  style={{ width: 72, height: 32, padding: "0 8px", border: "1px solid #E4E7EC", borderRadius: 6, fontSize: 12.5, fontFamily: "inherit", textAlign: "right", outline: "none" }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* System info */}
      <div className="card">
        <div style={{ fontSize: 13, fontWeight: 700, color: "#161B26", marginBottom: 14 }}>시스템 정보</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
          {[
            { label: "앱 버전",        value: "v2.4.1" },
            { label: "Python 버전",    value: "3.10.14" },
            { label: "scikit-learn",   value: "1.4.2" },
            { label: "XGBoost",        value: "2.0.3" },
            { label: "DB 크기",        value: "4.2 GB" },
            { label: "마지막 배포",    value: "2026-06-20" },
          ].map((s) => (
            <div key={s.label} style={{ background: "#F8F9FB", borderRadius: 8, padding: "10px 14px" }}>
              <div style={{ fontSize: 11.5, color: "#9AA4B2", fontWeight: 600 }}>{s.label}</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#161B26", marginTop: 2, fontFamily: "monospace" }}>{s.value}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
