"use client";

import { useState } from "react";
import { DataTable, Column } from "@/components/ui/DataTable";

// ─── Types & Mock Data ────────────────────────────────────────────────────────

type DataType = "성분분석" | "입고이력" | "품질검사" | "공정실적" | "출하이력";

// ── 성분분석 ──
interface ComponentRow {
  id: string; date: string; lot: string; supplier: string; sn: number; ag: number; cu: number; pb: number; result: string;
}
const COMPONENT_DATA: ComponentRow[] = [
  { id: "CA-001", date: "2026-06-27", lot: "LOT-A-260001", supplier: "SUP_A", sn: 62.1, ag: 2.98, cu: 0.51, pb: 34.41, result: "합격" },
  { id: "CA-002", date: "2026-06-27", lot: "LOT-B-260001", supplier: "SUP_B", sn: 61.8, ag: 3.02, cu: 0.49, pb: 34.69, result: "합격" },
  { id: "CA-003", date: "2026-06-26", lot: "LOT-C-260001", supplier: "SUP_C", sn: 61.5, ag: 2.85, cu: 0.47, pb: 35.18, result: "보류" },
  { id: "CA-004", date: "2026-06-26", lot: "LOT-D-260001", supplier: "SUP_D", sn: 59.8, ag: 2.72, cu: 0.44, pb: 37.04, result: "불합격" },
  { id: "CA-005", date: "2026-06-25", lot: "LOT-A-260003", supplier: "SUP_A", sn: 62.2, ag: 2.99, cu: 0.51, pb: 34.30, result: "합격" },
];

// ── 입고이력 ──
interface PurchaseRow {
  id: string; date: string; lot: string; material: string; supplier: string; qty: number; unitPrice: number; total: number;
}
const PURCHASE_DATA: PurchaseRow[] = [
  { id: "RC-001", date: "2026-06-27", lot: "LOT-A-260001", material: "SN", supplier: "SUP_A", qty: 500, unitPrice: 28500, total: 14250000 },
  { id: "RC-002", date: "2026-06-27", lot: "LOT-B-260001", material: "AG", supplier: "SUP_B", qty: 30,  unitPrice: 980000, total: 29400000 },
  { id: "RC-003", date: "2026-06-26", lot: "LOT-A-260002", material: "PB", supplier: "SUP_A", qty: 200, unitPrice: 3200,   total: 640000 },
  { id: "RC-004", date: "2026-06-26", lot: "LOT-C-260001", material: "CU", supplier: "SUP_C", qty: 50,  unitPrice: 12400,  total: 620000 },
  { id: "RC-005", date: "2026-06-25", lot: "LOT-B-260002", material: "SN", supplier: "SUP_B", qty: 600, unitPrice: 28500,  total: 17100000 },
];

// ── 품질검사 ──
interface QualityRow {
  id: string; date: string; lot: string; product: string; score: number; inspector: string; result: string; defect: string;
}
const QUALITY_DATA: QualityRow[] = [
  { id: "QI-001", date: "2026-06-27", lot: "LOT-2026-0627-001", product: "Sn63Pb37", score: 88.4, inspector: "김민준", result: "합격", defect: "-" },
  { id: "QI-002", date: "2026-06-27", lot: "LOT-2026-0627-003", product: "Sn60Pb40", score: 82.1, inspector: "이서연", result: "불합격", defect: "CU 편차" },
  { id: "QI-003", date: "2026-06-26", lot: "LOT-2026-0626-002", product: "Sn63Pb37", score: 86.9, inspector: "박지훈", result: "합격", defect: "-" },
  { id: "QI-004", date: "2026-06-26", lot: "LOT-2026-0626-005", product: "Sn60Pb40", score: 83.4, inspector: "김민준", result: "불합격", defect: "SN 편차" },
  { id: "QI-005", date: "2026-06-25", lot: "LOT-2026-0625-001", product: "Sn63Pb37", score: 89.1, inspector: "이서연", result: "합격", defect: "-" },
];

// ── 공정실적 ──
interface ProcessRow {
  id: string; date: string; line: string; lot: string; product: string; planQty: number; actualQty: number; temp: number; time: number; efficiency: string;
}
const PROCESS_DATA: ProcessRow[] = [
  { id: "PR-001", date: "2026-06-27", line: "1호 라인", lot: "LOT-2026-0627-001", product: "Sn63Pb37", planQty: 500, actualQty: 498, temp: 1178, time: 45, efficiency: "99.6%" },
  { id: "PR-002", date: "2026-06-27", line: "2호 라인", lot: "LOT-2026-0627-002", product: "Sn60Pb40", planQty: 400, actualQty: 402, temp: 1182, time: 43, efficiency: "100.5%" },
  { id: "PR-003", date: "2026-06-26", line: "3호 라인", lot: "LOT-2026-0626-001", product: "Sn63Pb37", planQty: 600, actualQty: 587, temp: 1175, time: 47, efficiency: "97.8%" },
  { id: "PR-004", date: "2026-06-26", line: "1호 라인", lot: "LOT-2026-0626-002", product: "Sn60Pb40", planQty: 350, actualQty: 351, temp: 1180, time: 44, efficiency: "100.3%" },
  { id: "PR-005", date: "2026-06-25", line: "2호 라인", lot: "LOT-2026-0625-001", product: "Sn63Pb37", planQty: 500, actualQty: 495, temp: 1179, time: 46, efficiency: "99.0%" },
];

// ── 출하이력 ──
interface ShipRow {
  id: string; date: string; lot: string; product: string; customer: string; qty: number; destination: string; status: string;
}
const SHIP_DATA: ShipRow[] = [
  { id: "SH-001", date: "2026-06-27", lot: "LOT-2026-0625-001", product: "Sn63Pb37", customer: "현대모비스", qty: 490, destination: "울산 공장", status: "출하완료" },
  { id: "SH-002", date: "2026-06-27", lot: "LOT-2026-0624-002", product: "Sn60Pb40", customer: "LG전자",    qty: 350, destination: "구미 공장", status: "출하완료" },
  { id: "SH-003", date: "2026-06-26", lot: "LOT-2026-0624-001", product: "Sn63Pb37", customer: "삼성전기",  qty: 600, destination: "수원 공장", status: "출하완료" },
  { id: "SH-004", date: "2026-06-26", lot: "LOT-2026-0623-003", product: "Sn60Pb40", customer: "현대모비스", qty: 400, destination: "아산 공장", status: "출하완료" },
  { id: "SH-005", date: "2026-06-27", lot: "LOT-2026-0626-001", product: "Sn63Pb37", customer: "삼성전기",  qty: 500, destination: "수원 공장", status: "준비중" },
];

// ─── Column definitions ────────────────────────────────────────────────────────

const COLUMNS_MAP: Record<DataType, Column<Record<string, unknown>>[]> = {
  성분분석: [
    { key: "id",       header: "분석번호", width: 110 },
    { key: "date",     header: "분석일",   width: 110 },
    { key: "lot",      header: "LOT번호",  width: 140 },
    { key: "supplier", header: "공급사",   width: 90  },
    { key: "sn",       header: "SN (%)",   width: 90, align: "right",
      render: (v) => <span style={{ fontVariantNumeric: "tabular-nums" }}>{(v as number).toFixed(2)}</span> },
    { key: "ag",       header: "AG (%)",   width: 90, align: "right",
      render: (v) => <span style={{ fontVariantNumeric: "tabular-nums" }}>{(v as number).toFixed(2)}</span> },
    { key: "cu",       header: "CU (%)",   width: 90, align: "right",
      render: (v) => <span style={{ fontVariantNumeric: "tabular-nums" }}>{(v as number).toFixed(2)}</span> },
    { key: "pb",       header: "PB (%)",   width: 90, align: "right",
      render: (v) => <span style={{ fontVariantNumeric: "tabular-nums" }}>{(v as number).toFixed(2)}</span> },
    { key: "result",   header: "판정",     width: 80, align: "center",
      render: (v) => {
        const s = v === "합격" ? { color: "#16A34A", bg: "#ECFDF3" } : v === "불합격" ? { color: "#DC2626", bg: "#FEF1F2" } : { color: "#B45309", bg: "#FEF6E7" };
        return <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 20, color: s.color, background: s.bg }}>{v as string}</span>;
      } },
  ],
  입고이력: [
    { key: "id",        header: "입고번호",  width: 110 },
    { key: "date",      header: "입고일",    width: 110 },
    { key: "lot",       header: "LOT번호",   width: 140 },
    { key: "material",  header: "원자재",    width: 80  },
    { key: "supplier",  header: "공급사",    width: 90  },
    { key: "qty",       header: "수량(kg)",  width: 90, align: "right",
      render: (v) => <span style={{ fontVariantNumeric: "tabular-nums" }}>{(v as number).toLocaleString()}</span> },
    { key: "unitPrice", header: "단가(원)",  width: 110, align: "right",
      render: (v) => <span style={{ fontVariantNumeric: "tabular-nums" }}>{(v as number).toLocaleString()}</span> },
    { key: "total",     header: "합계(원)",  width: 130, align: "right",
      render: (v) => <strong style={{ fontVariantNumeric: "tabular-nums" }}>{(v as number).toLocaleString()}</strong> },
  ],
  품질검사: [
    { key: "id",        header: "검사번호",  width: 110 },
    { key: "date",      header: "검사일",    width: 110 },
    { key: "lot",       header: "LOT번호",   width: 160 },
    { key: "product",   header: "제품",      width: 110 },
    { key: "score",     header: "품질점수",  width: 100, align: "right",
      render: (v) => {
        const score = v as number;
        const color = score >= 87 ? "#16A34A" : score >= 84 ? "#D97706" : "#DC2626";
        return <strong style={{ color, fontVariantNumeric: "tabular-nums" }}>{score.toFixed(1)}</strong>;
      } },
    { key: "inspector", header: "검수자",    width: 90  },
    { key: "result",    header: "판정",      width: 80, align: "center",
      render: (v) => {
        const s = v === "합격" ? { color: "#16A34A", bg: "#ECFDF3" } : { color: "#DC2626", bg: "#FEF1F2" };
        return <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 20, color: s.color, background: s.bg }}>{v as string}</span>;
      } },
    { key: "defect",    header: "불량 원인", width: 110 },
  ],
  공정실적: [
    { key: "id",         header: "실적번호",  width: 110 },
    { key: "date",       header: "생산일",    width: 110 },
    { key: "line",       header: "라인",      width: 90  },
    { key: "lot",        header: "LOT번호",   width: 155 },
    { key: "product",    header: "제품",      width: 110 },
    { key: "planQty",    header: "계획(kg)",  width: 90, align: "right",
      render: (v) => <span style={{ fontVariantNumeric: "tabular-nums" }}>{(v as number).toLocaleString()}</span> },
    { key: "actualQty",  header: "실적(kg)",  width: 90, align: "right",
      render: (v) => <span style={{ fontVariantNumeric: "tabular-nums" }}>{(v as number).toLocaleString()}</span> },
    { key: "temp",       header: "온도(°C)",  width: 90, align: "right",
      render: (v) => <span style={{ fontVariantNumeric: "tabular-nums" }}>{v as number}</span> },
    { key: "efficiency", header: "달성률",    width: 80, align: "right" },
  ],
  출하이력: [
    { key: "id",          header: "출하번호",  width: 110 },
    { key: "date",        header: "출하일",    width: 110 },
    { key: "lot",         header: "LOT번호",   width: 155 },
    { key: "product",     header: "제품",      width: 110 },
    { key: "customer",    header: "고객사",    width: 110 },
    { key: "qty",         header: "수량(kg)",  width: 90, align: "right",
      render: (v) => <span style={{ fontVariantNumeric: "tabular-nums" }}>{(v as number).toLocaleString()}</span> },
    { key: "destination", header: "납품처",    width: 120 },
    { key: "status",      header: "상태",      width: 90, align: "center",
      render: (v) => {
        const s = v === "출하완료" ? { color: "#16A34A", bg: "#ECFDF3" } : { color: "#D97706", bg: "#FEF6E7" };
        return <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 20, color: s.color, background: s.bg }}>{v as string}</span>;
      } },
  ],
};

const DATA_SOURCE: Record<DataType, Record<string, unknown>[]> = {
  성분분석: COMPONENT_DATA as unknown as Record<string, unknown>[],
  입고이력: PURCHASE_DATA  as unknown as Record<string, unknown>[],
  품질검사: QUALITY_DATA   as unknown as Record<string, unknown>[],
  공정실적: PROCESS_DATA   as unknown as Record<string, unknown>[],
  출하이력: SHIP_DATA      as unknown as Record<string, unknown>[],
};

const DATA_TYPES: DataType[] = ["성분분석", "입고이력", "품질검사", "공정실적", "출하이력"];

const TYPE_STYLES: Record<DataType, { color: string; bg: string }> = {
  성분분석: { color: "#3A5BD9", bg: "#EEF1FD" },
  입고이력: { color: "#7C3AED", bg: "#F5F3FF" },
  품질검사: { color: "#16A34A", bg: "#ECFDF3" },
  공정실적: { color: "#D97706", bg: "#FEF6E7" },
  출하이력: { color: "#687182", bg: "#F8F9FB" },
};

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DataQueryPage() {
  const [selectedType, setSelectedType] = useState<DataType>("성분분석");
  const [startDate, setStartDate] = useState("2026-06-01");
  const [endDate,   setEndDate]   = useState("2026-06-27");
  const [supplier,  setSupplier]  = useState("");
  const [lotNo,     setLotNo]     = useState("");
  const [hasQueried, setHasQueried] = useState(false);
  const [results,    setResults]    = useState<Record<string, unknown>[]>([]);

  function handleQuery() {
    const base = DATA_SOURCE[selectedType];
    let filtered = base;

    if (supplier.trim()) {
      filtered = filtered.filter((r) =>
        typeof r.supplier === "string" && r.supplier.toLowerCase().includes(supplier.toLowerCase())
      );
    }
    if (lotNo.trim()) {
      filtered = filtered.filter((r) =>
        typeof r.lot === "string" && r.lot.toLowerCase().includes(lotNo.toLowerCase())
      );
    }

    setResults(filtered);
    setHasQueried(true);
  }

  const inputStyle: React.CSSProperties = {
    height: 36, padding: "0 12px", border: "1px solid #E4E7EC", borderRadius: 8,
    fontSize: 13, color: "#161B26", background: "#fff", outline: "none", fontFamily: "inherit",
  };

  const columns = COLUMNS_MAP[selectedType];
  const typeStyle = TYPE_STYLES[selectedType];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* Header */}
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: "#161B26", margin: 0 }}>데이터 조회</h1>
        <p style={{ fontSize: 12.5, color: "#687182", margin: "4px 0 0" }}>유형별 조건 검색 및 결과 조회</p>
      </div>

      {/* Query form */}
      <div className="card">
        {/* Data type selector */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#687182", letterSpacing: "0.03em", textTransform: "uppercase", marginBottom: 10 }}>
            데이터 유형
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {DATA_TYPES.map((t) => {
              const active = selectedType === t;
              const ts = TYPE_STYLES[t];
              return (
                <button
                  key={t}
                  onClick={() => { setSelectedType(t); setHasQueried(false); }}
                  style={{
                    padding: "6px 16px", fontSize: 13, fontWeight: 600, borderRadius: 20,
                    border: active ? "none" : "1px solid #E4E7EC",
                    background: active ? ts.color : "#F8F9FB",
                    color: active ? "#fff" : "#687182",
                    cursor: "pointer", transition: "all 0.15s",
                  }}
                >
                  {t}
                </button>
              );
            })}
          </div>
        </div>

        {/* Period + filters */}
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div>
            <div style={{ fontSize: 11.5, fontWeight: 600, color: "#687182", marginBottom: 6, letterSpacing: "0.03em", textTransform: "uppercase" }}>기간</div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} style={{ ...inputStyle, width: 150 }} />
              <span style={{ color: "#9AA4B2", fontSize: 13 }}>~</span>
              <input type="date" value={endDate}   onChange={(e) => setEndDate(e.target.value)}   style={{ ...inputStyle, width: 150 }} />
            </div>
          </div>
          <div>
            <div style={{ fontSize: 11.5, fontWeight: 600, color: "#687182", marginBottom: 6, letterSpacing: "0.03em", textTransform: "uppercase" }}>공급사</div>
            <input
              type="text" value={supplier} onChange={(e) => setSupplier(e.target.value)}
              placeholder="SUP_A"
              style={{ ...inputStyle, width: 120 }}
            />
          </div>
          <div>
            <div style={{ fontSize: 11.5, fontWeight: 600, color: "#687182", marginBottom: 6, letterSpacing: "0.03em", textTransform: "uppercase" }}>LOT번호</div>
            <input
              type="text" value={lotNo} onChange={(e) => setLotNo(e.target.value)}
              placeholder="LOT-A-..."
              style={{ ...inputStyle, width: 160 }}
            />
          </div>
          <button
            onClick={handleQuery}
            style={{
              height: 36, padding: "0 24px", fontSize: 13, fontWeight: 700,
              borderRadius: 8, border: "none", background: typeStyle.color,
              color: "#fff", cursor: "pointer",
            }}
          >
            조회
          </button>
          <button
            onClick={() => { setSupplier(""); setLotNo(""); setHasQueried(false); setResults([]); }}
            style={{
              height: 36, padding: "0 16px", fontSize: 13, fontWeight: 600,
              borderRadius: 8, border: "1px solid #E4E7EC", background: "#F8F9FB",
              color: "#687182", cursor: "pointer",
            }}
          >
            초기화
          </button>
        </div>
      </div>

      {/* Results */}
      {hasQueried && (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{
            display: "flex", alignItems: "center", gap: 10,
            padding: "14px 16px", borderBottom: "1px solid #E4E7EC", flexWrap: "wrap",
          }}>
            <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 9px", borderRadius: 20, color: typeStyle.color, background: typeStyle.bg }}>
                {selectedType}
              </span>
              <span style={{ fontSize: 13, fontWeight: 700, color: "#161B26" }}>조회 결과</span>
              <span style={{ fontSize: 12, color: "#9AA4B2" }}>{results.length}건</span>
            </span>
            <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
              <button style={{
                padding: "5px 14px", fontSize: 12, fontWeight: 600, borderRadius: 6,
                border: "1px solid #E4E7EC", background: "#F8F9FB", color: "#687182", cursor: "pointer",
              }}>
                CSV 다운로드
              </button>
              <button style={{
                padding: "5px 14px", fontSize: 12, fontWeight: 600, borderRadius: 6,
                border: "1px solid #E4E7EC", background: "#F8F9FB", color: "#687182", cursor: "pointer",
              }}>
                Excel 다운로드
              </button>
            </div>
          </div>
          <DataTable
            columns={columns as Column<Record<string, unknown>>[]}
            data={results}
            rowKey={(_, i) => i}
            emptyText="조건에 맞는 데이터가 없습니다."
            stickyHeader
          />
        </div>
      )}

      {!hasQueried && (
        <div className="card" style={{ padding: "48px 24px", textAlign: "center" }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>🔍</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: "#687182", marginBottom: 4 }}>
            조회 조건을 설정하고 조회 버튼을 눌러주세요
          </div>
          <div style={{ fontSize: 12, color: "#9AA4B2" }}>
            데이터 유형, 기간, 필터를 선택한 후 결과를 확인할 수 있습니다
          </div>
        </div>
      )}
    </div>
  );
}
