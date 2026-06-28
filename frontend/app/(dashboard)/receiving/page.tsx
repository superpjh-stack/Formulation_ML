"use client";

import { useState } from "react";
import { KpiCard } from "@/components/ui/KpiCard";
import { DataTable, Column } from "@/components/ui/DataTable";
import { StatusBadge } from "@/components/ui/StatusBadge";

// ─── Mock Data ────────────────────────────────────────────────────────────────

interface ReceivingItem {
  id: string;
  supplier: string;
  material: string;
  qty: string;
  scheduledTime: string;
  status: "대기" | "검사중" | "합격" | "불합격" | "보류";
}

const MOCK_RECEIVING: ReceivingItem[] = [
  { id: "RC-2026-0601", supplier: "SUP_A (한국금속)", material: "Sn (주석 99.9%)", qty: "500 kg", scheduledTime: "08:00", status: "합격" },
  { id: "RC-2026-0602", supplier: "SUP_B (동양금속)", material: "Pb (납 99.5%)", qty: "300 kg", scheduledTime: "08:30", status: "합격" },
  { id: "RC-2026-0603", supplier: "SUP_A (한국금속)", material: "Ag (은 99.9%)", qty: "50 kg", scheduledTime: "09:00", status: "합격" },
  { id: "RC-2026-0604", supplier: "SUP_C (대성소재)", material: "Cu (구리 99.5%)", qty: "200 kg", scheduledTime: "09:30", status: "합격" },
  { id: "RC-2026-0605", supplier: "SUP_B (동양금속)", material: "Sn (주석 99.9%)", qty: "400 kg", scheduledTime: "10:00", status: "합격" },
  { id: "RC-2026-0606", supplier: "SUP_D (글로벌메탈)", material: "Ag (은 99.9%)", qty: "30 kg", scheduledTime: "10:30", status: "합격" },
  { id: "RC-2026-0607", supplier: "SUP_A (한국금속)", material: "Pb (납 99.5%)", qty: "150 kg", scheduledTime: "13:00", status: "검사중" },
  { id: "RC-2026-0608", supplier: "SUP_C (대성소재)", material: "Sn (주석 99.9%)", qty: "600 kg", scheduledTime: "14:00", status: "대기" },
];

const STATUS_MAP: Record<ReceivingItem["status"], { variant: "green" | "amber" | "red" | "blue" | "gray"; label: string }> = {
  합격:   { variant: "green", label: "합격" },
  불합격: { variant: "red",   label: "불합격" },
  보류:   { variant: "amber", label: "보류" },
  검사중: { variant: "blue",  label: "검사중" },
  대기:   { variant: "gray",  label: "대기" },
};

const COLUMNS: Column<ReceivingItem>[] = [
  { key: "id",            header: "입고번호",   width: 140 },
  { key: "supplier",      header: "공급사",     width: 180 },
  { key: "material",      header: "원자재",     width: 180 },
  { key: "qty",           header: "수량",       width: 90, align: "right" },
  { key: "scheduledTime", header: "예정시간",   width: 90, align: "center" },
  {
    key: "status",
    header: "상태",
    width: 90,
    align: "center",
    render: (_, row) => {
      const m = STATUS_MAP[row.status];
      return <StatusBadge variant={m.variant} label={m.label} dot />;
    },
  },
  {
    key: "id",
    header: "검사 결과 입력",
    width: 180,
    align: "center",
    render: (_, row) =>
      row.status === "검사중" || row.status === "대기" ? (
        <InspectButtons id={row.id} />
      ) : (
        <span style={{ color: "#C2C9D6", fontSize: 12 }}>—</span>
      ),
  },
];

function InspectButtons({ id }: { id: string }) {
  const [selected, setSelected] = useState<string | null>(null);
  const btns: { label: string; color: string; bg: string; border: string }[] = [
    { label: "합격", color: "#15803D", bg: "#ECFDF3", border: "#86EFAC" },
    { label: "불합격", color: "#B91C1C", bg: "#FEF1F2", border: "#FCA5A5" },
    { label: "보류", color: "#B45309", bg: "#FEF6E7", border: "#FCD34D" },
  ];
  return (
    <div style={{ display: "flex", gap: 4, justifyContent: "center" }}>
      {btns.map((b) => (
        <button
          key={b.label}
          onClick={() => setSelected(b.label)}
          style={{
            padding: "3px 8px",
            fontSize: 11,
            fontWeight: 600,
            borderRadius: 6,
            border: `1px solid ${selected === b.label ? b.border : "#E4E7EC"}`,
            background: selected === b.label ? b.bg : "#fff",
            color: selected === b.label ? b.color : "#687182",
            cursor: "pointer",
            transition: "all 0.1s",
          }}
        >
          {b.label}
        </button>
      ))}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ReceivingPage() {
  const counts = {
    total:   MOCK_RECEIVING.length,
    done:    MOCK_RECEIVING.filter((r) => r.status === "합격" || r.status === "불합격" || r.status === "보류").length,
    waiting: MOCK_RECEIVING.filter((r) => r.status === "대기" || r.status === "검사중").length,
    fail:    MOCK_RECEIVING.filter((r) => r.status === "불합격").length,
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* Header */}
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: "#161B26", margin: 0, lineHeight: 1.3 }}>
          입고관리
        </h1>
        <p style={{ fontSize: 12.5, color: "#687182", margin: "4px 0 0" }}>
          오늘 입고 현황 · 2026년 6월 27일
        </p>
      </div>

      {/* KPI Row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
        <KpiCard label="입고 건수" value={counts.total} unit="건" trend="neutral" trendValue="오늘" accentColor="#3A5BD9" />
        <KpiCard label="검사 완료" value={counts.done} unit="건" trend="up" trendValue="+1건" accentColor="#16A34A" />
        <KpiCard label="검사 대기" value={counts.waiting} unit="건" trend="neutral" trendValue="진행중" accentColor="#F59E0B" />
        <KpiCard label="불합격" value={counts.fail} unit="건" trend="neutral" trendValue="이상없음" accentColor="#DC2626" />
      </div>

      {/* Table */}
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "14px 16px", borderBottom: "1px solid #E4E7EC" }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: "#161B26", flex: 1 }}>입고 예정 목록</span>
          <span style={{ fontSize: 12, color: "#687182" }}>총 {MOCK_RECEIVING.length}건</span>
          <button
            style={{
              padding: "5px 14px", fontSize: 12, fontWeight: 600, borderRadius: 6,
              border: "1px solid #3A5BD9", background: "#3A5BD9", color: "#fff", cursor: "pointer",
            }}
          >
            일괄 저장
          </button>
        </div>
        <DataTable columns={COLUMNS} data={MOCK_RECEIVING} rowKey={(r) => r.id} stickyHeader />
      </div>

      {/* Info banner */}
      <div
        style={{
          background: "#EEF1FD",
          border: "1px solid #C7D2F8",
          borderRadius: 10,
          padding: "12px 16px",
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <circle cx="8" cy="8" r="7" stroke="#3A5BD9" strokeWidth="1.4" />
          <path d="M8 5v4M8 10.5v.5" stroke="#3A5BD9" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
        <span style={{ fontSize: 12.5, color: "#1D4ED8" }}>
          검사 대기 중인 항목 <strong>2건</strong>이 있습니다. 검사 결과를 입력하고 일괄 저장하세요.
        </span>
      </div>
    </div>
  );
}
