"use client";

import { useState } from "react";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { DataTable, Column } from "@/components/ui/DataTable";

interface LotRecord {
  lot: string;
  product: string;
  created: string;
  qty: string;
  status: "출하완료" | "검사중" | "배합완료" | "입고완료";
  customer: string;
}

interface TimelineStep {
  step: string;
  label: string;
  time: string;
  note: string;
  done: boolean;
  active: boolean;
}

interface ComponentResult {
  element: string;
  target: number;
  actual: number;
  tolerance: number;
  pass: boolean;
}

const MOCK_LOTS: LotRecord[] = [
  { lot: "LOT-2026-0621", product: "Sn63Pb37",        created: "2026-06-27", qty: "500 kg", status: "출하완료", customer: "삼성전자" },
  { lot: "LOT-2026-0622", product: "Sn96.5Ag3Cu0.5",  created: "2026-06-27", qty: "300 kg", status: "출하완료", customer: "LG이노텍" },
  { lot: "LOT-2026-0623", product: "Sn60Pb40",         created: "2026-06-26", qty: "750 kg", status: "검사중",   customer: "현대모비스" },
  { lot: "LOT-2026-0624", product: "Sn63Pb37",        created: "2026-06-26", qty: "200 kg", status: "배합완료", customer: "SK하이닉스" },
  { lot: "LOT-2026-0625", product: "Sn96.5Ag3Cu0.5",  created: "2026-06-25", qty: "400 kg", status: "입고완료", customer: "삼성SDI" },
];

const STATUS_LOT: Record<string, { variant: "green" | "blue" | "amber" | "gray" }> = {
  출하완료: { variant: "green" },
  검사중:   { variant: "blue" },
  배합완료: { variant: "amber" },
  입고완료: { variant: "gray" },
};

function getTimeline(lot: string): TimelineStep[] {
  const isDone = lot === "LOT-2026-0621" || lot === "LOT-2026-0622";
  const isInspect = lot === "LOT-2026-0623";
  return [
    { step: "1", label: "원자재 입고",   time: "06-25 08:00", note: "공급사 SUP_A — Sn 순도 99.9%",       done: true,    active: false },
    { step: "2", label: "배합 공정",     time: "06-25 14:00", note: "배합 최적화 AI 추천 적용",             done: true,    active: false },
    { step: "3", label: "성분 검사",     time: isInspect ? "진행중" : "06-26 09:00", note: isInspect ? "검사 진행중..." : "Sn/Ag/Cu 성분 합격", done: !isInspect, active: isInspect },
    { step: "4", label: "포장",          time: isDone ? "06-26 15:00" : "—", note: isDone ? "25 kg 단위 드럼 포장" : "대기",                  done: isDone,  active: false },
    { step: "5", label: "출하",          time: isDone ? "06-27 10:00" : "—", note: isDone ? `${lot === "LOT-2026-0621" ? "삼성전자" : "LG이노텍"} 납품` : "대기",  done: isDone,  active: false },
  ];
}

function getComponents(lot: string): ComponentResult[] {
  const isAg = lot === "LOT-2026-0622" || lot === "LOT-2026-0625";
  if (isAg) {
    return [
      { element: "Sn", target: 96.5, actual: 96.48, tolerance: 0.3, pass: true },
      { element: "Ag", target: 3.0,  actual: 3.02,  tolerance: 0.1, pass: true },
      { element: "Cu", target: 0.5,  actual: 0.49,  tolerance: 0.05, pass: true },
      { element: "기타", target: 0.0, actual: 0.01, tolerance: 0.05, pass: true },
    ];
  }
  return [
    { element: "Sn", target: 63.0, actual: 62.97, tolerance: 0.5, pass: true },
    { element: "Pb", target: 37.0, actual: 37.03, tolerance: 0.5, pass: true },
    { element: "기타", target: 0.0, actual: 0.00, tolerance: 0.05, pass: true },
  ];
}

const LOT_COLUMNS: Column<LotRecord>[] = [
  { key: "lot",      header: "LOT번호",  width: 160 },
  { key: "product",  header: "제품",     width: 180 },
  { key: "customer", header: "고객사",   width: 120 },
  { key: "qty",      header: "수량",     width: 90, align: "right" },
  { key: "created",  header: "생성일",   width: 110 },
  {
    key: "status",
    header: "상태",
    align: "center",
    render: (_, row) => (
      <StatusBadge variant={STATUS_LOT[row.status]?.variant ?? "gray"} label={row.status} dot />
    ),
  },
];

export default function LotPage() {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>("LOT-2026-0621");

  const filtered = MOCK_LOTS.filter(
    (l) =>
      l.lot.includes(search) ||
      l.product.toLowerCase().includes(search.toLowerCase()) ||
      l.customer.includes(search)
  );

  const timeline = selected ? getTimeline(selected) : [];
  const components = selected ? getComponents(selected) : [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: "#161B26", margin: 0 }}>LOT 추적관리</h1>
        <p style={{ fontSize: 12.5, color: "#687182", margin: "4px 0 0" }}>
          원자재 입고부터 출하까지 LOT 전주기 이력 추적
        </p>
      </div>

      {/* Search */}
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <div style={{ position: "relative", width: 320 }}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none"
            style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)" }}>
            <circle cx="7" cy="7" r="5" stroke="#9AA4B2" strokeWidth="1.5" />
            <path d="M11 11l3 3" stroke="#9AA4B2" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <input
            type="text"
            placeholder="LOT번호, 제품명, 고객사 검색..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              width: "100%", height: 36, paddingLeft: 32, paddingRight: 12,
              border: "1px solid #E4E7EC", borderRadius: 8, fontSize: 12.5,
              color: "#161B26", background: "#F8F9FB", outline: "none", fontFamily: "inherit",
            }}
          />
        </div>
        <span style={{ fontSize: 12, color: "#9AA4B2" }}>{filtered.length}건</span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, alignItems: "start" }}>
        {/* LOT list */}
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "12px 16px", borderBottom: "1px solid #E4E7EC" }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#161B26" }}>LOT 목록</span>
          </div>
          <div>
            {filtered.map((lot) => (
              <div
                key={lot.lot}
                onClick={() => setSelected(lot.lot)}
                style={{
                  padding: "12px 16px",
                  cursor: "pointer",
                  borderBottom: "1px solid #F2F4F7",
                  background: selected === lot.lot ? "#EEF1FD" : "transparent",
                  borderLeft: selected === lot.lot ? "3px solid #3A5BD9" : "3px solid transparent",
                  transition: "background 0.12s",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: "#161B26" }}>{lot.lot}</span>
                  <StatusBadge variant={STATUS_LOT[lot.status]?.variant ?? "gray"} label={lot.status} dot />
                </div>
                <div style={{ fontSize: 11.5, color: "#687182" }}>
                  {lot.product} · {lot.customer} · {lot.qty}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Detail */}
        {selected && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {/* Timeline */}
            <div className="card">
              <div style={{ fontSize: 13, fontWeight: 700, color: "#161B26", marginBottom: 16 }}>
                공정 추적 타임라인
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                {timeline.map((t, i) => (
                  <div key={t.step} style={{ display: "flex", gap: 12, position: "relative" }}>
                    {/* connector */}
                    {i < timeline.length - 1 && (
                      <div style={{
                        position: "absolute", left: 15, top: 28, width: 2, height: "calc(100% - 4px)",
                        background: t.done ? "#3A5BD9" : "#E4E7EC", zIndex: 0,
                      }} />
                    )}
                    {/* dot */}
                    <div style={{
                      width: 30, height: 30, borderRadius: "50%", flexShrink: 0, zIndex: 1,
                      background: t.done ? "#3A5BD9" : t.active ? "#F59E0B" : "#E4E7EC",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 11, fontWeight: 700,
                      color: t.done || t.active ? "#fff" : "#9AA4B2",
                    }}>
                      {t.done ? "✓" : t.step}
                    </div>
                    <div style={{ paddingBottom: 20, flex: 1 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontSize: 12.5, fontWeight: 700, color: t.active ? "#B45309" : t.done ? "#161B26" : "#9AA4B2" }}>
                          {t.label}
                        </span>
                        <span style={{ fontSize: 11, color: "#9AA4B2", fontVariantNumeric: "tabular-nums" }}>{t.time}</span>
                      </div>
                      <div style={{ fontSize: 11.5, color: "#687182", marginTop: 2 }}>{t.note}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Component analysis */}
            <div className="card">
              <div style={{ fontSize: 13, fontWeight: 700, color: "#161B26", marginBottom: 14 }}>
                성분 분석 결과
              </div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, fontVariantNumeric: "tabular-nums" }}>
                  <thead>
                    <tr style={{ background: "#F8F9FB" }}>
                      {["성분", "목표(%)", "실측(%)", "허용오차", "판정"].map((h) => (
                        <th key={h} style={{ padding: "8px 12px", textAlign: "right", fontSize: 11.5, fontWeight: 600, color: "#687182", borderBottom: "1px solid #E4E7EC", whiteSpace: "nowrap" }}>
                          {h === "성분" ? <span style={{ textAlign: "left", display: "block" }}>{h}</span> : h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {components.map((c) => (
                      <tr key={c.element} style={{ borderBottom: "1px solid #F2F4F7" }}>
                        <td style={{ padding: "8px 12px", fontWeight: 700, color: "#161B26" }}>{c.element}</td>
                        <td style={{ padding: "8px 12px", textAlign: "right", color: "#687182" }}>{c.target.toFixed(1)}</td>
                        <td style={{ padding: "8px 12px", textAlign: "right", fontWeight: 600, color: "#161B26" }}>{c.actual.toFixed(2)}</td>
                        <td style={{ padding: "8px 12px", textAlign: "right", color: "#9AA4B2" }}>±{c.tolerance}</td>
                        <td style={{ padding: "8px 12px", textAlign: "right" }}>
                          <StatusBadge variant={c.pass ? "green" : "red"} label={c.pass ? "합격" : "불합격"} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
