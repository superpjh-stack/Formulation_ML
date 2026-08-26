"use client";

/**
 * FE-RT-21 · `/process/performance` · 공정 실적 (FR-P-01)
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * 🔴 하드코딩 배열을 `GET /api/v1/process/performance` 로 교체했다.
 *   응답은 **벌거벗은 배열**이다 (기간 집계라 페이징 대상이 아니다 — §4.2 예외).
 *
 * ⚠ **`input_qty` / `output_qty` 는 항상 `null` 이다** — 저장 컬럼이 자체가 없다.
 *   규칙은 "숨기되, 숨겼다는 사실은 숨기지 않는다":
 *     1. 두 열을 **렌더링하지 않는다.** `—` 로 채운 빈 열을 남기면 사용자가
 *        "값이 0" 또는 "이번 기간만 없음"으로 오해한다. **0 으로 바꾸는 것은 더 나쁘다.**
 *     2. 판정은 **서버 응답**으로 한다 (`items.every(r => r.input_qty === null)`).
 *        `hideInputQty = true` 를 하드코딩하지 않는다 — 나중에 컬럼이 생기면
 *        API 만 고쳐도 화면이 자동으로 열을 살린다.
 *     3. 표 하단에 조용한 각주 1줄. 경고색이 아니다 — 상시 사실이지 오류가 아니다.
 *     4. **투입/산출 기반 KPI(원단위·재료효율·손실률)를 만들지 않는다.** v1 에 존재할 수 없다.
 *
 * ⚠ 평균 수율은 기간별 `yield_pct` 의 **산술평균이 아니다.** 기간마다 LOT 수가 달라서
 *   단순평균은 틀린다. `Σpass / Σlot × 100` 으로 가중 계산한다.
 * ══════════════════════════════════════════════════════════════════════════════
 */

import { useMemo, useState } from "react";
import { useProcessPerformance } from "@/hooks/useKoryoData";
import { StatusScreen } from "@/components/layout/StatusScreen";
import { ErrorAlert } from "@/components/ui/ErrorAlert";
import { PillFilter } from "@/components/ui/PillFilter";
import { KpiCard } from "@/components/ui/KpiCard";
import { TrendChart } from "@/components/charts/TrendChart";
import { T } from "@/components/ui/tokens";
import type { ProcessPerformanceRow } from "@/types/api";
import type { ProcessPeriod } from "@/lib/koryo-api";

const PERIOD_OPTIONS: { value: ProcessPeriod; label: string }[] = [
  { value: "day", label: "일" },
  { value: "week", label: "주" },
  { value: "month", label: "월" },
];

/** 차트 가독성 한계 (산출물 규정 없음 — UI 가드) */
const MAX_SPAN_DAYS: Record<ProcessPeriod, number> = { day: 366, week: 728, month: 1830 };

function iso(d: Date) {
  return d.toISOString().slice(0, 10);
}
function shiftDays(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return iso(d);
}
function shiftMonths(n: number) {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return iso(d);
}
function defaultFrom(period: ProcessPeriod) {
  if (period === "day") return shiftDays(6);
  if (period === "week") return shiftDays(11 * 7);
  return shiftMonths(11);
}

export default function ProcessPerformancePage() {
  const [period, setPeriod] = useState<ProcessPeriod>("day");
  const [dateFrom, setDateFrom] = useState(defaultFrom("day"));
  const [dateTo, setDateTo] = useState(iso(new Date()));

  const spanDays = Math.round((Date.parse(dateTo) - Date.parse(dateFrom)) / 86_400_000);
  const rangeError =
    dateFrom > dateTo
      ? "시작일이 종료일보다 늦습니다"
      : spanDays > MAX_SPAN_DAYS[period]
        ? `${PERIOD_OPTIONS.find((o) => o.value === period)!.label} 단위 조회 구간이 너무 깁니다`
        : null;

  const query = useMemo(
    () => ({ period, date_from: dateFrom, date_to: dateTo }),
    [period, dateFrom, dateTo]
  );

  const { data, loading, error, refetch } = useProcessPerformance(rangeError ? {} : query);
  const rows: ProcessPerformanceRow[] = data ?? [];

  // 🔴 서버 응답으로 열 숨김을 판정한다. 프론트 상수로 박지 않는다
  const hasInputQty = rows.length > 0 && rows.some((r) => r.input_qty !== null);
  const hasOutputQty = rows.length > 0 && rows.some((r) => r.output_qty !== null);

  const totalLots = rows.reduce((a, r) => a + r.lot_count, 0);
  const totalPass = rows.reduce((a, r) => a + r.pass_count, 0);
  const totalFail = rows.reduce((a, r) => a + r.fail_count, 0);
  // 가중 평균 — 기간별 yield_pct 의 산술평균이 아니다
  const avgYield = totalLots > 0 ? ((totalPass / totalLots) * 100).toFixed(1) : "—";

  function switchPeriod(p: ProcessPeriod) {
    setPeriod(p);
    setDateFrom(defaultFrom(p));
    setDateTo(iso(new Date()));
  }

  function resetRange() {
    switchPeriod(period);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* [A] 헤더 + 필터 */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: T.text, margin: 0 }}>공정 실적</h1>
          <p style={{ fontSize: 12.5, color: T.textSub, margin: "4px 0 0" }}>
            기간별 LOT 수 · 수율 집계 (FR-P-01)
          </p>
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
          <PillFilter options={PERIOD_OPTIONS} value={period} onChange={switchPeriod} label="기간 단위:" />
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={labelStyle}>기간 시작</span>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} style={inputStyle} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={labelStyle}>기간 종료</span>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} style={inputStyle} />
          </label>
          {/* `/data/export` 화이트리스트에 공정 실적이 없다 */}
          <button type="button" className="btn" disabled title="준비 중 — 내보내기 대상에 공정 실적이 아직 포함돼 있지 않습니다">
            내보내기 (준비 중)
          </button>
        </div>
      </div>

      {rangeError && <ErrorAlert message={`${rangeError} — 조회를 실행하지 않았습니다`} />}

      {/* [B] KPI 3장 — 투입/산출 기반 카드를 만들지 않는다 */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
        <KpiCard label="총 LOT 수" value={loading ? "—" : totalLots.toLocaleString("ko-KR")} unit="건" />
        <KpiCard label="평균 수율 (LOT 수 가중)" value={loading ? "—" : avgYield} unit={avgYield === "—" ? "" : "%"} />
        <KpiCard label="불량 LOT 수" value={loading ? "—" : totalFail.toLocaleString("ko-KR")} unit="건" />
      </div>

      {rangeError ? null : loading ? (
        <StatusScreen tone="loading" title="공정 실적을 불러오는 중" />
      ) : error ? (
        <StatusScreen
          tone="error"
          title="공정 실적을 불러오지 못했습니다"
          code={error}
          actions={[{ label: "다시 시도", onClick: refetch, primary: true }]}
        />
      ) : rows.length === 0 ? (
        <StatusScreen
          tone="empty"
          title="선택한 기간에 실적이 없습니다"
          actions={[{ label: "기간 초기화", onClick: resetRange, primary: true }]}
        />
      ) : (
        <>
          {/* [C] 추이 차트 */}
          <div className="card">
            <div style={sectionTitle}>기간별 추이</div>
            <TrendChart
              categories={rows.map((r) => r.period)}
              series={[{ name: "LOT 수", values: rows.map((r) => r.lot_count), color: "primary" }]}
              kind="bar"
              height={200}
            />
            <div style={{ marginTop: 12 }}>
              <TrendChart
                categories={rows.map((r) => r.period)}
                series={[{ name: "수율 (%)", values: rows.map((r) => r.yield_pct), color: "success", area: true }]}
                kind="line"
                height={180}
                yDomain={[0, 100]}
                formatY={(v) => `${v.toFixed(0)}%`}
              />
            </div>
          </div>

          {/* [D] 실적 표 */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={sectionTitle}>기간별 실적</div>
            <div style={tableWrapStyle}>
              <table style={tableStyle}>
                <thead>
                  <tr style={{ background: T.surfaceSubtle }}>
                    <th style={thStyle}>기간</th>
                    <th style={{ ...thStyle, textAlign: "right" }}>LOT 수</th>
                    <th style={{ ...thStyle, textAlign: "right" }}>합격</th>
                    <th style={{ ...thStyle, textAlign: "right" }}>경고</th>
                    <th style={{ ...thStyle, textAlign: "right" }}>불량</th>
                    {/* 열 자체가 생기지 않는다 — 빈 열을 남기지 않는다 */}
                    {hasInputQty && <th style={{ ...thStyle, textAlign: "right" }}>투입량</th>}
                    {hasOutputQty && <th style={{ ...thStyle, textAlign: "right" }}>산출량</th>}
                    <th style={{ ...thStyle, textAlign: "right" }}>수율</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.period} style={{ borderBottom: `1px solid ${T.border}` }}>
                      <td style={{ ...tdStyle, fontWeight: 600 }}>{r.period}</td>
                      <td style={{ ...tdStyle, textAlign: "right" }}>{r.lot_count.toLocaleString("ko-KR")}</td>
                      <td style={{ ...tdStyle, textAlign: "right" }}>{r.pass_count.toLocaleString("ko-KR")}</td>
                      <td style={{ ...tdStyle, textAlign: "right" }}>{r.warning_count.toLocaleString("ko-KR")}</td>
                      <td style={{ ...tdStyle, textAlign: "right" }}>{r.fail_count.toLocaleString("ko-KR")}</td>
                      {hasInputQty && (
                        <td style={{ ...tdStyle, textAlign: "right" }}>
                          {r.input_qty === null ? "—" : r.input_qty.toFixed(2)}
                        </td>
                      )}
                      {hasOutputQty && (
                        <td style={{ ...tdStyle, textAlign: "right" }}>
                          {r.output_qty === null ? "—" : r.output_qty.toFixed(2)}
                        </td>
                      )}
                      {/* 생산 0건이면 수율은 `—` 다. `0.0%` 로 쓰면 전량 불량과 구분되지 않는다 */}
                      <td style={{ ...tdStyle, textAlign: "right" }}>
                        {r.lot_count === 0 || r.yield_pct === null ? "—" : `${r.yield_pct.toFixed(1)}%`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!hasInputQty && !hasOutputQty && (
              <p style={{ fontSize: 11, color: T.textSub, margin: 0 }}>
                ※ 투입량·산출량은 현재 수집되지 않는 항목입니다 (FR-P-01 중 2개 지표 · 저장 컬럼 부재).
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ─── 스타일 ───────────────────────────────────────────────────────────────────

const labelStyle: React.CSSProperties = { fontSize: 11.5, fontWeight: 600, color: T.textSub };

const inputStyle: React.CSSProperties = {
  height: 32,
  padding: "0 8px",
  border: `1px solid ${T.border}`,
  borderRadius: 6,
  fontSize: 12.5,
  fontFamily: "inherit",
  outline: "none",
};

const sectionTitle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 700,
  color: T.text,
  marginBottom: 14,
};

const tableWrapStyle: React.CSSProperties = {
  overflowX: "auto",
  borderRadius: 12,
  border: `1px solid ${T.border}`,
  background: T.surface,
  boxShadow: "0 1px 2px rgba(16,24,40,.03)",
};

const tableStyle: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: 12.5,
  fontVariantNumeric: "tabular-nums",
};

const thStyle: React.CSSProperties = {
  padding: "10px 14px",
  textAlign: "left",
  fontSize: 11.5,
  fontWeight: 600,
  color: T.textSub,
  letterSpacing: "0.03em",
  borderBottom: `1px solid ${T.border}`,
  whiteSpace: "nowrap",
};

const tdStyle: React.CSSProperties = {
  padding: "10px 14px",
  color: T.text,
  whiteSpace: "nowrap",
};
