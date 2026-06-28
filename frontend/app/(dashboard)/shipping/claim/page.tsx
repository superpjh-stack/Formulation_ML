"use client";

import { useState } from "react";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { DataTable, Column } from "@/components/ui/DataTable";

interface ClaimRecord {
  id: string;
  customer: string;
  product: string;
  type: string;
  content: string;
  received: string;
  status: "접수" | "분석중" | "조치완료" | "종결";
  severity: "높음" | "중간" | "낮음";
}

const MOCK_CLAIMS: ClaimRecord[] = [
  { id: "CLM-001", customer: "삼성전자",  product: "Sn63Pb37",       type: "성분불량", content: "Sn 함량 규격 초과 (64.2%)",           received: "2026-06-20", status: "조치완료", severity: "높음" },
  { id: "CLM-002", customer: "LG이노텍",  product: "Sn96.5Ag3Cu0.5", type: "외관불량", content: "표면 산화 흔적 발견",                  received: "2026-06-18", status: "종결",   severity: "낮음" },
  { id: "CLM-003", customer: "현대모비스", product: "Sn60Pb40",       type: "중량불량", content: "드럼 중량 표시 오차 (±1.5 kg)",       received: "2026-06-15", status: "조치완료", severity: "중간" },
  { id: "CLM-004", customer: "SK하이닉스", product: "Sn63Pb37",      type: "성분불량", content: "Pb 함량 편차 (38.1%, 규격 37±0.5%)", received: "2026-06-12", status: "분석중",  severity: "높음" },
  { id: "CLM-005", customer: "삼성SDI",   product: "Sn96.5Ag3Cu0.5", type: "포장불량", content: "드럼 라벨 인쇄 오류",                  received: "2026-06-10", status: "종결",   severity: "낮음" },
  { id: "CLM-006", customer: "한화에어로", product: "Sn63Pb37",      type: "성분불량", content: "Ag 미량 혼입 검출",                   received: "2026-06-08", status: "조치완료", severity: "높음" },
  { id: "CLM-007", customer: "두산전자",  product: "Sn60Pb40",       type: "납기불량", content: "출하 지연 (약속 일정 3일 초과)",        received: "2026-06-05", status: "종결",   severity: "중간" },
  { id: "CLM-008", customer: "LG전자",    product: "Sn96.5Ag3Cu0.5", type: "외관불량", content: "표면 거칠기 불량",                    received: "2026-06-03", status: "접수",   severity: "낮음" },
  { id: "CLM-009", customer: "삼성전자",  product: "Sn63Pb37",       type: "성분불량", content: "Cu 미량 혼입 (0.02% 검출)",           received: "2026-05-28", status: "분석중",  severity: "높음" },
  { id: "CLM-010", customer: "현대전자",  product: "Sn60Pb40",       type: "중량불량", content: "순 중량 미달 (24.7 kg, 규격 25 kg)", received: "2026-05-25", status: "종결",   severity: "중간" },
];

const STATUS_MAP: Record<ClaimRecord["status"], "gray" | "amber" | "blue" | "green"> = {
  접수:    "gray",
  분석중:  "amber",
  조치완료: "blue",
  종결:    "green",
};

const SEV_MAP: Record<ClaimRecord["severity"], "red" | "amber" | "gray"> = {
  높음: "red",
  중간: "amber",
  낮음: "gray",
};

// Pareto data
const TYPE_COUNTS = [
  { type: "성분불량", count: 4, color: "#3A5BD9" },
  { type: "외관불량", count: 2, color: "#6B8AFF" },
  { type: "중량불량", count: 2, color: "#F59E0B" },
  { type: "납기불량", count: 1, color: "#16A34A" },
  { type: "포장불량", count: 1, color: "#9AA4B2" },
];
const MAX_COUNT = Math.max(...TYPE_COUNTS.map((t) => t.count));

const COLUMNS: Column<ClaimRecord>[] = [
  { key: "id",       header: "클레임번호", width: 100 },
  { key: "customer", header: "고객사",     width: 110 },
  { key: "product",  header: "제품",       width: 170 },
  { key: "type",     header: "불량유형",   width: 90 },
  { key: "content",  header: "불량내용",   width: 250 },
  { key: "received", header: "접수일",     width: 100 },
  {
    key: "severity",
    header: "심각도",
    width: 75,
    align: "center",
    render: (_, row) => <StatusBadge variant={SEV_MAP[row.severity]} label={row.severity} />,
  },
  {
    key: "status",
    header: "처리상태",
    width: 90,
    align: "center",
    render: (_, row) => <StatusBadge variant={STATUS_MAP[row.status]} label={row.status} dot />,
  },
];

export default function ClaimPage() {
  const [filter, setFilter] = useState<"전체" | ClaimRecord["status"]>("전체");
  const filtered = filter === "전체" ? MOCK_CLAIMS : MOCK_CLAIMS.filter((c) => c.status === filter);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: "#161B26", margin: 0 }}>클레임 분석</h1>
        <p style={{ fontSize: 12.5, color: "#687182", margin: "4px 0 0" }}>
          고객 클레임 접수·분석·대응 이력 및 유형별 통계
        </p>
      </div>

      {/* Top row */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        {/* Status summary */}
        <div className="card">
          <div style={{ fontSize: 13, fontWeight: 700, color: "#161B26", marginBottom: 14 }}>처리 현황</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {(["접수", "분석중", "조치완료", "종결"] as const).map((s) => {
              const cnt = MOCK_CLAIMS.filter((c) => c.status === s).length;
              const variant = STATUS_MAP[s];
              return (
                <div key={s} style={{
                  padding: "12px 14px", borderRadius: 8,
                  background: variant === "gray" ? "#F2F4F7" : variant === "amber" ? "#FEF6E7" : variant === "blue" ? "#EEF1FD" : "#ECFDF3",
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: "#687182" }}>{s}</span>
                  <span style={{ fontSize: 22, fontWeight: 800, fontVariantNumeric: "tabular-nums",
                    color: variant === "gray" ? "#5B6573" : variant === "amber" ? "#B45309" : variant === "blue" ? "#1D4ED8" : "#15803D" }}>
                    {cnt}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Pareto chart */}
        <div className="card">
          <div style={{ fontSize: 13, fontWeight: 700, color: "#161B26", marginBottom: 14 }}>
            유형별 클레임 파레토
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {TYPE_COUNTS.map((t, i) => {
              const cumulPct = Math.round(
                (TYPE_COUNTS.slice(0, i + 1).reduce((s, x) => s + x.count, 0) / MOCK_CLAIMS.length) * 100
              );
              return (
                <div key={t.type} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 12, color: "#687182", width: 64, flexShrink: 0 }}>{t.type}</span>
                  <div style={{ flex: 1, height: 20, background: "#F2F4F7", borderRadius: 3, overflow: "hidden" }}>
                    <div style={{
                      width: `${(t.count / MAX_COUNT) * 100}%`, height: "100%",
                      background: t.color, borderRadius: 3,
                      display: "flex", alignItems: "center", paddingLeft: 6,
                    }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: "#fff" }}>{t.count}</span>
                    </div>
                  </div>
                  <span style={{ fontSize: 11, color: "#9AA4B2", width: 40, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                    {cumulPct}%
                  </span>
                </div>
              );
            })}
          </div>
          <div style={{ marginTop: 10, fontSize: 11, color: "#9AA4B2" }}>
            * 누적 비율 기준 — 성분불량이 전체 40% 차지
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "14px 16px", borderBottom: "1px solid #E4E7EC" }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: "#161B26", flex: 1 }}>클레임 목록</span>
          {(["전체", "접수", "분석중", "조치완료", "종결"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{
                padding: "4px 12px", fontSize: 12, fontWeight: 600, borderRadius: 20,
                border: "1px solid", cursor: "pointer",
                borderColor: filter === f ? "#3A5BD9" : "#E4E7EC",
                background: filter === f ? "#3A5BD9" : "#fff",
                color: filter === f ? "#fff" : "#687182",
              }}
            >
              {f}
            </button>
          ))}
        </div>
        <DataTable columns={COLUMNS} data={filtered} rowKey={(r) => r.id} stickyHeader />
      </div>
    </div>
  );
}
