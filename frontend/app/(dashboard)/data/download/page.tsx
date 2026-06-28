"use client";

import { useState } from "react";
import { DataTable, Column } from "@/components/ui/DataTable";

// ─── Mock Data ────────────────────────────────────────────────────────────────

type FileFormat = "CSV" | "Excel" | "ZIP";
type DownloadStatus = "대기" | "다운로드중" | "완료";

interface Dataset {
  id: string;
  title: string;
  description: string;
  period: string;
  recordCount: number;
  formats: FileFormat[];
  updatedAt: string;
  sizeMap: Record<FileFormat, string>;
  icon: string;
  color: string;
}

const DATASETS: Dataset[] = [
  {
    id: "ds-component",
    title: "성분분석 이력",
    description: "ICP-OES 성분분석 전체 이력. SN/AG/CU/PB 실측치, 판정 결과, 공급사 정보 포함.",
    period: "2023-01-01 ~ 2026-06-27",
    recordCount: 12480,
    formats: ["CSV", "Excel"],
    updatedAt: "2026-06-27 09:00",
    sizeMap: { CSV: "2.3 MB", Excel: "3.1 MB", ZIP: "" },
    icon: "A",
    color: "#3A5BD9",
  },
  {
    id: "ds-purchase",
    title: "입고 이력 전체",
    description: "원자재 입고 이력. 원자재별 입고량, 공급사, 단가, 합계 정보 포함.",
    period: "2023-01-01 ~ 2026-06-27",
    recordCount: 4830,
    formats: ["CSV"],
    updatedAt: "2026-06-27 08:30",
    sizeMap: { CSV: "1.1 MB", Excel: "", ZIP: "" },
    icon: "I",
    color: "#7C3AED",
  },
  {
    id: "ds-quality",
    title: "품질 검사 결과",
    description: "LOT별 품질 검사 결과. 품질점수, 검수자, 불량 유형, 판정 데이터.",
    period: "2023-06-01 ~ 2026-06-27",
    recordCount: 8210,
    formats: ["Excel"],
    updatedAt: "2026-06-27 10:15",
    sizeMap: { CSV: "", Excel: "890 KB", ZIP: "" },
    icon: "Q",
    color: "#16A34A",
  },
  {
    id: "ds-process",
    title: "공정 실적 데이터",
    description: "라인별 생산 실적. 계획/실적 수량, 공정 온도, 용융 시간, 달성률 포함.",
    period: "2024-01-01 ~ 2026-06-27",
    recordCount: 23150,
    formats: ["CSV"],
    updatedAt: "2026-06-27 07:45",
    sizeMap: { CSV: "3.2 MB", Excel: "", ZIP: "" },
    icon: "P",
    color: "#D97706",
  },
  {
    id: "ds-ai-train",
    title: "AI 학습용 데이터셋",
    description: "ML 모델 학습에 최적화된 전처리 완료 데이터. 피처 엔지니어링, 정규화, 결측치 처리 적용.",
    period: "2023-01-01 ~ 2026-05-31",
    recordCount: 48320,
    formats: ["ZIP"],
    updatedAt: "2026-06-01 06:00",
    sizeMap: { CSV: "", Excel: "", ZIP: "8.5 MB" },
    icon: "ML",
    color: "#0E7490",
  },
];

interface DownloadLog {
  id: string;
  user: string;
  filename: string;
  format: FileFormat;
  datetime: string;
  size: string;
}

const MOCK_LOGS: DownloadLog[] = [
  { id: "DL-001", user: "김민준",  filename: "성분분석_이력_2026-06-27.csv",        format: "CSV",   datetime: "2026-06-27 14:30", size: "2.3 MB" },
  { id: "DL-002", user: "이서연",  filename: "품질검사_결과_2026-06-27.xlsx",        format: "Excel", datetime: "2026-06-27 13:15", size: "890 KB" },
  { id: "DL-003", user: "박지훈",  filename: "AI학습용_데이터셋_2026-06-01.zip",    format: "ZIP",   datetime: "2026-06-27 11:00", size: "8.5 MB" },
  { id: "DL-004", user: "김민준",  filename: "공정실적_데이터_2026-06-27.csv",       format: "CSV",   datetime: "2026-06-27 09:22", size: "3.2 MB" },
  { id: "DL-005", user: "이서연",  filename: "입고이력_전체_2026-06-27.csv",         format: "CSV",   datetime: "2026-06-26 16:40", size: "1.1 MB" },
  { id: "DL-006", user: "최영수",  filename: "성분분석_이력_2026-06-26.xlsx",        format: "Excel", datetime: "2026-06-26 14:05", size: "3.1 MB" },
  { id: "DL-007", user: "박지훈",  filename: "품질검사_결과_2026-06-26.xlsx",        format: "Excel", datetime: "2026-06-26 10:30", size: "890 KB" },
];

const FORMAT_STYLES: Record<FileFormat, { color: string; bg: string }> = {
  CSV:   { color: "#16A34A", bg: "#ECFDF3" },
  Excel: { color: "#1D4ED8", bg: "#EEF4FF" },
  ZIP:   { color: "#7C3AED", bg: "#F5F3FF" },
};

const LOG_COLUMNS: Column<DownloadLog>[] = [
  { key: "datetime", header: "다운로드 시각",  width: 150, render: (v) => <span style={{ fontVariantNumeric: "tabular-nums", fontSize: 12.5 }}>{v as string}</span> },
  { key: "user",     header: "사용자",         width: 90  },
  { key: "filename", header: "파일명",         render: (v) => <span style={{ fontSize: 12.5, color: "#161B26" }}>{v as string}</span> },
  { key: "format",   header: "형식",           width: 70, align: "center",
    render: (v) => {
      const fmt = v as FileFormat;
      const s = FORMAT_STYLES[fmt];
      return <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 20, color: s.color, background: s.bg }}>{fmt}</span>;
    } },
  { key: "size", header: "크기", width: 80, align: "right",
    render: (v) => <span style={{ fontSize: 12.5, fontVariantNumeric: "tabular-nums" }}>{v as string}</span> },
];

// ─── Dataset Card ─────────────────────────────────────────────────────────────

function DatasetCard({ dataset }: { dataset: Dataset }) {
  const [selectedFormat, setSelectedFormat] = useState<FileFormat>(dataset.formats[0]);
  const [dlStatus, setDlStatus] = useState<DownloadStatus>("대기");

  function handleDownload() {
    setDlStatus("다운로드중");
    setTimeout(() => setDlStatus("완료"), 1800);
    setTimeout(() => setDlStatus("대기"), 4000);
  }

  const size = dataset.sizeMap[selectedFormat];

  return (
    <div className="card" style={{
      display: "flex", flexDirection: "column", gap: 14,
      borderTop: `3px solid ${dataset.color}`,
    }}>
      {/* Icon + title */}
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
        <div style={{
          width: 42, height: 42, borderRadius: 10, flexShrink: 0,
          background: `${dataset.color}18`,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: dataset.icon.length > 1 ? 11 : 16, fontWeight: 800, color: dataset.color,
        }}>
          {dataset.icon}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#161B26", marginBottom: 3 }}>{dataset.title}</div>
          <div style={{ fontSize: 12, color: "#687182", lineHeight: 1.5 }}>{dataset.description}</div>
        </div>
      </div>

      {/* Meta */}
      <div style={{ display: "flex", gap: 16, fontSize: 11.5, color: "#9AA4B2" }}>
        <span>기간: <strong style={{ color: "#687182" }}>{dataset.period}</strong></span>
        <span>건수: <strong style={{ color: "#687182", fontVariantNumeric: "tabular-nums" }}>{dataset.recordCount.toLocaleString()}건</strong></span>
        <span>업데이트: <strong style={{ color: "#687182" }}>{dataset.updatedAt}</strong></span>
      </div>

      {/* Format + download */}
      <div style={{ display: "flex", gap: 10, alignItems: "center", paddingTop: 4, borderTop: "1px solid #F2F4F7" }}>
        <div style={{ display: "flex", gap: 6 }}>
          {dataset.formats.map((f) => {
            const active = selectedFormat === f;
            const fs = FORMAT_STYLES[f];
            return (
              <button
                key={f}
                onClick={() => setSelectedFormat(f)}
                style={{
                  padding: "4px 12px", fontSize: 11.5, fontWeight: 700, borderRadius: 20,
                  border: active ? "none" : "1px solid #E4E7EC",
                  background: active ? fs.color : "#F8F9FB",
                  color: active ? "#fff" : "#687182",
                  cursor: "pointer", transition: "all 0.15s",
                }}
              >
                {f}
              </button>
            );
          })}
        </div>
        <span style={{ fontSize: 11.5, color: "#9AA4B2", flex: 1 }}>{size}</span>
        <button
          onClick={handleDownload}
          disabled={dlStatus === "다운로드중"}
          style={{
            padding: "6px 18px", fontSize: 12.5, fontWeight: 700, borderRadius: 8,
            border: "none",
            background: dlStatus === "완료" ? "#16A34A" : dlStatus === "다운로드중" ? "#9AA4B2" : dataset.color,
            color: "#fff", cursor: dlStatus === "다운로드중" ? "not-allowed" : "pointer",
            display: "flex", alignItems: "center", gap: 6, transition: "background 0.2s",
          }}
        >
          {dlStatus === "다운로드중" ? (
            <>
              <span style={{
                width: 11, height: 11, border: "2px solid rgba(255,255,255,0.4)",
                borderTopColor: "#fff", borderRadius: "50%", animation: "spin 0.7s linear infinite",
                display: "inline-block",
              }} />
              다운로드 중...
            </>
          ) : dlStatus === "완료" ? (
            <>✓ 완료</>
          ) : (
            <>↓ 다운로드</>
          )}
        </button>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DataDownloadPage() {
  const totalDownloads = MOCK_LOGS.length;
  const todayDownloads = MOCK_LOGS.filter((l) => l.datetime.startsWith("2026-06-27")).length;
  const totalSize      = "16.9 MB";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* Header */}
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: "#161B26", margin: 0 }}>데이터 다운로드</h1>
        <p style={{ fontSize: 12.5, color: "#687182", margin: "4px 0 0" }}>데이터셋 선택 및 파일 다운로드</p>
      </div>

      {/* Summary */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
        {[
          { label: "다운로드 가능 데이터셋", value: DATASETS.length, unit: "개",  color: "#3A5BD9" },
          { label: "오늘 다운로드",           value: todayDownloads,  unit: "건",  color: "#16A34A" },
          { label: "누적 다운로드",           value: totalDownloads,  unit: "건",  color: "#7C3AED" },
        ].map((s) => (
          <div key={s.label} className="card" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: "#687182", letterSpacing: "0.03em", textTransform: "uppercase" as const }}>{s.label}</span>
            <span style={{ fontSize: 26, fontWeight: 800, color: s.color, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
              {s.value}<span style={{ fontSize: 13, fontWeight: 500, color: "#9AA4B2", marginLeft: 3 }}>{s.unit}</span>
            </span>
          </div>
        ))}
      </div>

      {/* Notice */}
      <div style={{
        padding: "12px 16px", background: "#EEF4FF", border: "1px solid #BFDBFE",
        borderRadius: 10, display: "flex", gap: 10, alignItems: "center",
      }}>
        <span style={{ fontSize: 13, color: "#1D4ED8" }}>
          <strong>총 {totalSize}</strong>의 데이터를 다운로드할 수 있습니다. 민감 데이터는 접근 권한에 따라 제한될 수 있습니다.
        </span>
      </div>

      {/* Dataset grid */}
      <div>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#161B26", marginBottom: 14 }}>다운로드 가능 데이터셋</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 16 }}>
          {DATASETS.map((ds) => <DatasetCard key={ds.id} dataset={ds} />)}
        </div>
      </div>

      {/* Download history */}
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "14px 16px", borderBottom: "1px solid #E4E7EC" }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: "#161B26" }}>다운로드 이력</span>
          <span style={{ fontSize: 12, color: "#9AA4B2", marginLeft: 8 }}>최근 {MOCK_LOGS.length}건</span>
        </div>
        <DataTable
          columns={LOG_COLUMNS}
          data={MOCK_LOGS}
          rowKey={(r) => r.id}
          stickyHeader
        />
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
