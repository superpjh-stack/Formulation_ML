"use client";

import { useState } from "react";
import { KpiCard } from "@/components/ui/KpiCard";
import { DataTable, Column } from "@/components/ui/DataTable";
import { StatusBadge } from "@/components/ui/StatusBadge";

interface ShipOrder {
  id: string;
  customer: string;
  product: string;
  lot: string;
  qty: string;
  datetime: string;
  status: "완료" | "진행중" | "대기" | "승인대기";
}

const MOCK_ORDERS: ShipOrder[] = [
  { id: "SH-001", customer: "삼성전자", product: "Sn63Pb37 솔더합금", lot: "LOT-2026-0621", qty: "500 kg", datetime: "2026-06-27 08:30", status: "완료" },
  { id: "SH-002", customer: "LG이노텍", product: "Sn96.5Ag3Cu0.5 솔더합금", lot: "LOT-2026-0622", qty: "300 kg", datetime: "2026-06-27 09:15", status: "완료" },
  { id: "SH-003", customer: "현대모비스", product: "Sn60Pb40 솔더합금", lot: "LOT-2026-0623", qty: "750 kg", datetime: "2026-06-27 10:00", status: "완료" },
  { id: "SH-004", customer: "SK하이닉스", product: "Sn63Pb37 솔더합금", lot: "LOT-2026-0624", qty: "200 kg", datetime: "2026-06-27 10:45", status: "완료" },
  { id: "SH-005", customer: "삼성SDI", product: "Sn96.5Ag3Cu0.5 솔더합금", lot: "LOT-2026-0625", qty: "400 kg", datetime: "2026-06-27 11:30", status: "완료" },
  { id: "SH-006", customer: "한화에어로", product: "Sn63Pb37 솔더합금", lot: "LOT-2026-0626", qty: "600 kg", datetime: "2026-06-27 12:00", status: "완료" },
  { id: "SH-007", customer: "두산전자", product: "Sn60Pb40 솔더합금", lot: "LOT-2026-0627", qty: "250 kg", datetime: "2026-06-27 12:30", status: "완료" },
  { id: "SH-008", customer: "LG전자", product: "Sn96.5Ag3Cu0.5 솔더합금", lot: "LOT-2026-0628", qty: "320 kg", datetime: "2026-06-27 13:00", status: "완료" },
  { id: "SH-009", customer: "삼성전자", product: "Sn63Pb37 솔더합금", lot: "LOT-2026-0629", qty: "450 kg", datetime: "2026-06-27 14:00", status: "진행중" },
  { id: "SH-010", customer: "현대전자", product: "Sn60Pb40 솔더합금", lot: "LOT-2026-0630", qty: "180 kg", datetime: "2026-06-27 14:30", status: "진행중" },
  { id: "SH-011", customer: "LG이노텍", product: "Sn96.5Ag3Cu0.5 솔더합금", lot: "LOT-2026-0631", qty: "560 kg", datetime: "2026-06-27 15:00", status: "진행중" },
  { id: "SH-012", customer: "SK하이닉스", product: "Sn63Pb37 솔더합금", lot: "LOT-2026-0632", qty: "290 kg", datetime: "2026-06-27 15:30", status: "진행중" },
  { id: "SH-013", customer: "LS산전", product: "Sn60Pb40 솔더합금", lot: "LOT-2026-0633", qty: "700 kg", datetime: "2026-06-27 16:00", status: "승인대기" },
  { id: "SH-014", customer: "한국단자", product: "Sn96.5Ag3Cu0.5 솔더합금", lot: "LOT-2026-0634", qty: "210 kg", datetime: "2026-06-27 16:30", status: "대기" },
  { id: "SH-015", customer: "KEC", product: "Sn63Pb37 솔더합금", lot: "LOT-2026-0635", qty: "380 kg", datetime: "2026-06-27 17:00", status: "대기" },
];

const STATUS_MAP: Record<ShipOrder["status"], { variant: "green" | "blue" | "amber" | "gray"; label: string }> = {
  완료:   { variant: "green", label: "완료" },
  진행중: { variant: "blue",  label: "진행중" },
  대기:   { variant: "gray",  label: "대기" },
  승인대기: { variant: "amber", label: "승인대기" },
};

const SPARKLINE = [10, 12, 9, 15, 13, 8, 14, 11, 15];

const COLUMNS: Column<ShipOrder>[] = [
  { key: "id",       header: "출하번호",  width: 100 },
  { key: "customer", header: "고객사",    width: 120 },
  { key: "product",  header: "제품",      width: 200 },
  { key: "lot",      header: "LOT번호",   width: 150 },
  { key: "qty",      header: "수량",      width: 90,  align: "right" },
  { key: "datetime", header: "출하일시",  width: 140 },
  {
    key: "status",
    header: "상태",
    width: 100,
    align: "center",
    render: (_, row) => {
      const m = STATUS_MAP[row.status];
      return <StatusBadge variant={m.variant} label={m.label} dot />;
    },
  },
  {
    key: "id",
    header: "액션",
    width: 90,
    align: "center",
    render: (_, row) =>
      row.status === "승인대기" ? (
        <button
          style={{
            padding: "3px 10px",
            fontSize: 11.5,
            fontWeight: 600,
            color: "#fff",
            background: "#3A5BD9",
            border: "none",
            borderRadius: 6,
            cursor: "pointer",
          }}
        >
          승인
        </button>
      ) : (
        <span style={{ color: "#C2C9D6", fontSize: 12 }}>—</span>
      ),
  },
];

export default function ShippingMainPage() {
  const [filter, setFilter] = useState<"전체" | ShipOrder["status"]>("전체");

  const filtered =
    filter === "전체" ? MOCK_ORDERS : MOCK_ORDERS.filter((o) => o.status === filter);

  const counts = {
    total:  MOCK_ORDERS.length,
    done:   MOCK_ORDERS.filter((o) => o.status === "완료").length,
    active: MOCK_ORDERS.filter((o) => o.status === "진행중").length,
    wait:   MOCK_ORDERS.filter((o) => o.status === "대기" || o.status === "승인대기").length,
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* Page header */}
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: "#161B26", margin: 0, lineHeight: 1.3 }}>
          출하관리
        </h1>
        <p style={{ fontSize: 12.5, color: "#687182", margin: "4px 0 0" }}>
          오늘 출하 현황 · 2026년 6월 27일
        </p>
      </div>

      {/* KPI row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
        <KpiCard
          label="출하 예정"
          value={counts.total}
          unit="건"
          trend="neutral"
          trendValue="오늘"
          sparkline={SPARKLINE.map((v) => ({ value: v }))}
          accentColor="#3A5BD9"
        />
        <KpiCard
          label="완료"
          value={counts.done}
          unit="건"
          trend="up"
          trendValue="+2건"
          sparkline={[5, 6, 7, 6, 8, 7, 8].map((v) => ({ value: v }))}
          accentColor="#16A34A"
        />
        <KpiCard
          label="진행중"
          value={counts.active}
          unit="건"
          trend="neutral"
          trendValue="현재"
          sparkline={[3, 4, 3, 4, 4, 3, 4].map((v) => ({ value: v }))}
          accentColor="#2563EB"
        />
        <KpiCard
          label="대기"
          value={counts.wait}
          unit="건"
          trend="down"
          trendValue="-1건"
          sparkline={[5, 4, 4, 3, 4, 3, 3].map((v) => ({ value: v }))}
          accentColor="#F59E0B"
        />
      </div>

      {/* Table section */}
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        {/* Toolbar */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "14px 16px",
            borderBottom: "1px solid #E4E7EC",
          }}
        >
          <span style={{ fontSize: 13, fontWeight: 700, color: "#161B26", flex: 1 }}>
            출하 목록
          </span>
          {(["전체", "완료", "진행중", "대기", "승인대기"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{
                padding: "4px 12px",
                fontSize: 12,
                fontWeight: 600,
                borderRadius: 20,
                border: "1px solid",
                cursor: "pointer",
                transition: "all 0.12s",
                borderColor: filter === f ? "#3A5BD9" : "#E4E7EC",
                background: filter === f ? "#3A5BD9" : "#fff",
                color: filter === f ? "#fff" : "#687182",
              }}
            >
              {f}
            </button>
          ))}
          <button
            style={{
              padding: "4px 14px",
              fontSize: 12,
              fontWeight: 600,
              borderRadius: 6,
              border: "1px solid #E4E7EC",
              background: "#F8F9FB",
              color: "#687182",
              cursor: "pointer",
              marginLeft: 8,
            }}
          >
            내보내기
          </button>
        </div>
        <DataTable
          columns={COLUMNS}
          data={filtered}
          rowKey={(r) => r.id}
          stickyHeader
        />
      </div>
    </div>
  );
}
