"use client";

import { useState } from "react";
import { DataTable, Column } from "@/components/ui/DataTable";
import { StatusBadge } from "@/components/ui/StatusBadge";

// ─── Mock Data ────────────────────────────────────────────────────────────────

interface Dataset {
  id: string;
  name: string;
  createdAt: string;
  size: number;        // rows
  features: number;
  usedModel: string;
  accuracy: number;   // R²
  rmse: number;
  labeledCount: number;
  totalCount: number;
  status: "완료" | "학습중" | "대기" | "오류";
}

const MOCK_DATASETS: Dataset[] = [
  { id: "DS-001", name: "배합이력 전체 (2025-2026)",    createdAt: "2026-06-20", size: 4820,  features: 18, usedModel: "GradientBoosting", accuracy: 0.892, rmse: 2.14, labeledCount: 4820,  totalCount: 4820,  status: "완료"   },
  { id: "DS-002", name: "SUP_A 특화 데이터",             createdAt: "2026-06-15", size: 1240,  features: 18, usedModel: "XGBoost",          accuracy: 0.921, rmse: 1.87, labeledCount: 1240,  totalCount: 1240,  status: "완료"   },
  { id: "DS-003", name: "무연솔더 품질 데이터",          createdAt: "2026-06-10", size: 890,   features: 16, usedModel: "RandomForest",     accuracy: 0.856, rmse: 2.68, labeledCount: 890,   totalCount: 890,   status: "완료"   },
  { id: "DS-004", name: "2026 Q2 배합 데이터",           createdAt: "2026-06-27", size: 320,   features: 18, usedModel: "GradientBoosting", accuracy: 0.000, rmse: 0.00, labeledCount: 195,   totalCount: 320,   status: "학습중"  },
  { id: "DS-005", name: "공급사 편차 보정 데이터",       createdAt: "2026-06-25", size: 2100,  features: 22, usedModel: "XGBoost",          accuracy: 0.000, rmse: 0.00, labeledCount: 2100,  totalCount: 2100,  status: "대기"    },
  { id: "DS-006", name: "이상치 제거 정제 데이터",       createdAt: "2026-06-01", size: 3980,  features: 18, usedModel: "Ridge",            accuracy: 0.614, rmse: 4.21, labeledCount: 3980,  totalCount: 3980,  status: "오류"    },
];

const STATUS_MAP: Record<Dataset["status"], { variant: "green" | "blue" | "gray" | "red" }> = {
  완료:   { variant: "green" },
  학습중: { variant: "blue"  },
  대기:   { variant: "gray"  },
  오류:   { variant: "red"   },
};

// ─── Label Progress Bar ───────────────────────────────────────────────────────

function LabelProgress({ labeled, total }: { labeled: number; total: number }) {
  const pct = total === 0 ? 0 : Math.round((labeled / total) * 100);
  const color = pct === 100 ? "#16A34A" : pct >= 60 ? "#3A5BD9" : "#D97706";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 140 }}>
      <div style={{ flex: 1, height: 6, background: "#F2F4F7", borderRadius: 3, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 3, transition: "width 0.4s" }} />
      </div>
      <span style={{ fontSize: 11.5, fontVariantNumeric: "tabular-nums", color, fontWeight: 600, width: 36, textAlign: "right" as const }}>
        {pct}%
      </span>
    </div>
  );
}

// ─── Retrain modal ────────────────────────────────────────────────────────────

function RetrainModal({ dataset, onClose, onStart }: { dataset: Dataset; onClose: () => void; onStart: () => void }) {
  const [model, setModel] = useState(dataset.usedModel);
  const models = ["GradientBoosting", "XGBoost", "RandomForest", "Ridge"];

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(14,19,32,.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ background: "#fff", borderRadius: 14, width: 460, maxWidth: "90vw", overflow: "hidden", boxShadow: "0 20px 60px rgba(0,0,0,.18)" }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid #E4E7EC", display: "flex", alignItems: "center" }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#161B26" }}>모델 재학습 트리거</div>
            <div style={{ fontSize: 12, color: "#687182", marginTop: 2 }}>{dataset.name}</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "#9AA4B2", fontSize: 18 }}>×</button>
        </div>
        <div style={{ padding: "20px" }}>
          <div style={{ display: "flex", flexDirection: "column" as const, gap: 14 }}>
            <div style={{ background: "#F8F9FB", borderRadius: 8, padding: "12px 14px", fontSize: 12.5, color: "#687182", lineHeight: 1.6 }}>
              <strong style={{ color: "#161B26" }}>데이터셋:</strong> {dataset.size.toLocaleString()}행 · {dataset.features}개 피처 · 라벨링 {Math.round(dataset.labeledCount / dataset.totalCount * 100)}% 완료
            </div>
            <div style={{ display: "flex", flexDirection: "column" as const, gap: 4 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: "#687182" }}>사용 모델</label>
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                style={{ padding: "8px 10px", fontSize: 13, border: "1px solid #E4E7EC", borderRadius: 7, outline: "none", color: "#161B26" }}
              >
                {models.map((m) => <option key={m}>{m}</option>)}
              </select>
            </div>
            <div style={{ background: "#FEF6E7", border: "1px solid #FCD34D", borderRadius: 8, padding: "10px 14px", fontSize: 12, color: "#92400E" }}>
              ⚠ 재학습은 현재 배포된 모델을 교체합니다. 검증 지표를 확인 후 배포하세요.
            </div>
          </div>
        </div>
        <div style={{ padding: "12px 20px 20px", display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button onClick={onClose} style={{ padding: "8px 18px", fontSize: 13, fontWeight: 600, borderRadius: 8, border: "1px solid #E4E7EC", background: "#fff", color: "#687182", cursor: "pointer" }}>취소</button>
          <button
            onClick={() => { onStart(); onClose(); }}
            style={{ padding: "8px 18px", fontSize: 13, fontWeight: 600, borderRadius: 8, border: "none", background: "#3A5BD9", color: "#fff", cursor: "pointer" }}
          >
            학습 시작
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DataTrainingPage() {
  const [datasets, setDatasets] = useState(MOCK_DATASETS);
  const [retrainTarget, setRetrainTarget] = useState<Dataset | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }

  function handleRetrainStart() {
    if (!retrainTarget) return;
    setDatasets((prev) =>
      prev.map((d) => d.id === retrainTarget.id ? { ...d, status: "학습중" as const } : d)
    );
    showToast(`${retrainTarget.name} 재학습이 시작되었습니다.`);
  }

  const COLUMNS: Column<Dataset>[] = [
    { key: "id",       header: "ID",        width: 80 },
    { key: "name",     header: "데이터셋명", width: 220 },
    { key: "createdAt",header: "생성일",    width: 100 },
    { key: "size",     header: "데이터 수", width: 90,  align: "right", render: (v) => <span style={{ fontVariantNumeric: "tabular-nums" }}>{(v as number).toLocaleString()}</span> },
    { key: "features", header: "피처 수",   width: 80,  align: "right" },
    { key: "usedModel",header: "모델",      width: 140, render: (v) => <span style={{ fontSize: 12, fontWeight: 600, color: "#3A5BD9" }}>{v as string}</span> },
    {
      key: "accuracy",
      header: "R² 정확도",
      width: 100,
      align: "right",
      render: (v, row) => {
        if (row.status !== "완료") return <span style={{ color: "#9AA4B2" }}>—</span>;
        const val = v as number;
        const color = val >= 0.9 ? "#16A34A" : val >= 0.8 ? "#3A5BD9" : "#D97706";
        return <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 700, color }}>{val.toFixed(3)}</span>;
      },
    },
    {
      key: "rmse",
      header: "RMSE",
      width: 80,
      align: "right",
      render: (v, row) => {
        if (row.status !== "완료") return <span style={{ color: "#9AA4B2" }}>—</span>;
        return <span style={{ fontVariantNumeric: "tabular-nums" }}>{(v as number).toFixed(2)}</span>;
      },
    },
    {
      key: "labeledCount",
      header: "라벨링 현황",
      width: 180,
      render: (_, row) => <LabelProgress labeled={row.labeledCount} total={row.totalCount} />,
    },
    {
      key: "status",
      header: "상태",
      width: 90,
      align: "center",
      render: (_, row) => <StatusBadge variant={STATUS_MAP[row.status].variant} label={row.status} dot />,
    },
    {
      key: "id",
      header: "재학습",
      width: 90,
      align: "center",
      render: (_, row) => (
        <button
          onClick={() => setRetrainTarget(row)}
          disabled={row.status === "학습중"}
          style={{
            padding: "3px 10px", fontSize: 11.5, fontWeight: 600, borderRadius: 6, cursor: row.status === "학습중" ? "default" : "pointer",
            border: "1px solid", transition: "all 0.1s",
            borderColor: row.status === "학습중" ? "#E4E7EC" : "#3A5BD9",
            background: row.status === "학습중" ? "#F8F9FB" : "#EEF1FD",
            color: row.status === "학습중" ? "#9AA4B2" : "#1D4ED8",
            opacity: row.status === "학습중" ? 0.7 : 1,
          }}
        >
          {row.status === "학습중" ? "학습중…" : "재학습"}
        </button>
      ),
    },
  ];

  const totalRows    = datasets.reduce((s, d) => s + d.size, 0);
  const completedCnt = datasets.filter((d) => d.status === "완료").length;
  const trainingCnt  = datasets.filter((d) => d.status === "학습중").length;
  const bestAcc      = Math.max(...datasets.filter((d) => d.accuracy > 0).map((d) => d.accuracy));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: "#161B26", margin: 0 }}>AI 학습 데이터 관리</h1>
        <p style={{ fontSize: 12.5, color: "#687182", margin: "4px 0 0" }}>학습 데이터셋 현황 및 모델 재학습 관리</p>
      </div>

      {/* KPI strip */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
        {[
          { label: "전체 데이터셋", value: datasets.length,              unit: "개",  color: "#3A5BD9" },
          { label: "학습 완료",     value: completedCnt,                 unit: "개",  color: "#16A34A" },
          { label: "학습 중",       value: trainingCnt,                  unit: "개",  color: "#2563EB" },
          { label: "최고 R² 정확도",value: bestAcc.toFixed(3),           unit: "",    color: "#7C3AED" },
        ].map((s) => (
          <div key={s.label} className="card" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: "#687182", letterSpacing: "0.03em", textTransform: "uppercase" as const }}>{s.label}</span>
            <span style={{ fontSize: 24, fontWeight: 800, color: s.color, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
              {s.value}<span style={{ fontSize: 12, fontWeight: 500, color: "#9AA4B2", marginLeft: 3 }}>{s.unit}</span>
            </span>
          </div>
        ))}
      </div>

      {/* Labeling progress overview */}
      <div className="card">
        <div style={{ fontSize: 13, fontWeight: 700, color: "#161B26", marginBottom: 12 }}>전체 라벨링 현황</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {datasets.map((d) => (
            <div key={d.id} style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ width: 200, fontSize: 12.5, color: "#161B26", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>
                {d.name}
              </div>
              <LabelProgress labeled={d.labeledCount} total={d.totalCount} />
              <span style={{ fontSize: 11.5, color: "#9AA4B2", width: 80, flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>
                {d.labeledCount.toLocaleString()} / {d.totalCount.toLocaleString()}
              </span>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid #F2F4F7", fontSize: 12, color: "#687182" }}>
          총 학습 데이터: <strong style={{ color: "#161B26", fontVariantNumeric: "tabular-nums" }}>{totalRows.toLocaleString()}행</strong>
        </div>
      </div>

      {/* Table */}
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "14px 16px", borderBottom: "1px solid #E4E7EC", display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: "#161B26", flex: 1 }}>데이터셋 목록</span>
          <button style={{ padding: "5px 14px", fontSize: 12, fontWeight: 600, borderRadius: 6, border: "none", background: "#3A5BD9", color: "#fff", cursor: "pointer" }}>
            + 새 데이터셋 생성
          </button>
        </div>
        <div style={{ overflowX: "auto" }}>
          <DataTable columns={COLUMNS} data={datasets} rowKey={(r) => r.id} stickyHeader />
        </div>
      </div>

      {/* Retrain modal */}
      {retrainTarget && (
        <RetrainModal
          dataset={retrainTarget}
          onClose={() => setRetrainTarget(null)}
          onStart={handleRetrainStart}
        />
      )}

      {/* Toast */}
      {toast && (
        <div style={{
          position: "fixed", bottom: 28, right: 28, zIndex: 200,
          background: "#161B26", color: "#fff", padding: "12px 18px",
          borderRadius: 10, fontSize: 13, fontWeight: 500,
          boxShadow: "0 8px 24px rgba(0,0,0,.22)",
          animation: "slide-up 0.2s ease-out",
        }}>
          {toast}
        </div>
      )}

      <style>{`
        @keyframes slide-up {
          from { transform: translateY(12px); opacity: 0; }
          to   { transform: translateY(0);    opacity: 1; }
        }
      `}</style>
    </div>
  );
}
