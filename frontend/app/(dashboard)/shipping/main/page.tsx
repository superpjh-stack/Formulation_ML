"use client";

/**
 * FE-RT-16 · `/shipping/main` · 출하 현황 (FR-S-01)
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * 🔴 삭제한 것
 *   - `MOCK_ORDERS` 15건 하드코딩 → `GET /api/v1/shipments`
 *   - 상태 4종(`완료`/`진행중`/`대기`/`승인대기`) 과 `[승인]` 버튼
 *     → **저장할 곳도 요구사항 근거도 없다.** `shipments` 에 `status` 컬럼이 없고
 *       SF-AD2 에 출하 승인 워크플로가 없으며 `audit_logs.action` 에도 `APPROVE` 가 없다
 *   - `출하번호 SH-001` 열 → `shipments` 에 없는 컬럼이다 (내부 `id` 를 노출하지 마라)
 *   - `수량 "500 kg"` 문자열 결합 → `quantity`(숫자) + `unit`(별도 열) 로 분리
 *   - `SPARKLINE` 상수 · `trendValue "+2건"` → 실데이터가 없으면 **그리지 않는다**
 *
 * 🆕 신규: 고객사별 출하량 막대 · 출하 일정 캘린더 (FR-S-01 이 명시한 3대 구성요소 중
 *   둘이 통째로 빠져 있었다)
 *
 * ⚠ **`출하 대기` 는 아직 표시할 수 없다.** 명세는 서버가 `shipment_state:'shipped'|'waiting'`
 *   를 파생해 내려주도록 요구했으나 `ShipmentDto` 에 그 필드가 아직 없다 (계약 미반영).
 *   프론트가 `lots` 와 조인해 판정하지 말라고 명시돼 있으므로, **없는 값을 만들지 않고
 *   "제공 전"이라고 화면에 적는다.** 상태 pill 필터도 같은 이유로 두지 않는다.
 * ══════════════════════════════════════════════════════════════════════════════
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import * as api from "@/lib/koryo-api";
import { KpiCard } from "@/components/ui/KpiCard";
import { StatusScreen } from "@/components/layout/StatusScreen";
import { ErrorAlert } from "@/components/ui/ErrorAlert";
import { Spinner } from "@/components/ui/Spinner";
import { T } from "@/components/ui/tokens";
import { useDashboardShipping, useShipments } from "@/hooks/useKoryoData";
import type { ShipmentCalendarCell, ShipmentDto } from "@/types/api";

const PAGE_SIZE = 50;

/**
 * `GET /shipments/calendar?month=` — `hooks/useKoryoData.ts` 에 대응 훅이 없어서
 * 여기서 만든다 (`hooks/` 는 개발3 소유라 수정하지 않는다).
 * `month` 가 바뀔 때만 요청이 나간다 — 달 이동 1회당 호출 1회다.
 */
function useShipmentCalendar(month: string) {
  const [data, setData] = useState<ShipmentCalendarCell[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const refetch = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .getShipmentCalendar(month)
      .then((cells) => {
        if (!cancelled) setData(cells);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "캘린더를 불러오지 못했습니다");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [month, tick]);

  return { data, loading, error, refetch };
}

function iso(d: Date) {
  return d.toISOString().slice(0, 10);
}
function daysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return iso(d);
}
function monthOf(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function shiftMonth(month: string, delta: number) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return monthOf(d);
}

export default function ShippingMainPage() {
  const [dateFrom, setDateFrom] = useState(daysAgo(6));
  const [dateTo, setDateTo] = useState(iso(new Date()));
  const [customer, setCustomer] = useState("");
  const [page, setPage] = useState(1);
  const [month, setMonth] = useState(monthOf(new Date()));

  const rangeError = dateFrom > dateTo ? "시작일이 종료일보다 늦습니다" : null;

  const listQuery = useMemo(
    () => ({
      page,
      page_size: PAGE_SIZE,
      date_from: dateFrom,
      date_to: dateTo,
      ...(customer ? { customer } : {}),
    }),
    [page, dateFrom, dateTo, customer]
  );

  // 세 영역은 서로를 막지 않는다 — 각자 로딩·오류를 그린다 (§9)
  const list = useShipments(rangeError ? {} : listQuery);
  const dash = useDashboardShipping(7);
  const calendar = useShipmentCalendar(month);

  const items = list.data?.items ?? [];
  const total = list.data?.total ?? 0;
  const maxPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function resetRange() {
    setDateFrom(daysAgo(6));
    setDateTo(iso(new Date()));
    setCustomer("");
    setPage(1);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* [A] 헤더 + 필터 */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: T.text, margin: 0 }}>출하 현황</h1>
          <p style={{ fontSize: 12.5, color: T.textSub, margin: "4px 0 0" }}>
            출하 목록 · 고객사별 출하량 · 출하 일정 (FR-S-01)
          </p>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={labelStyle}>기간 시작</span>
            <input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }} style={inputStyle} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={labelStyle}>기간 종료</span>
            <input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }} style={inputStyle} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={labelStyle}>고객사</span>
            <input
              type="text"
              placeholder="전체"
              value={customer}
              onChange={(e) => { setCustomer(e.target.value.trim()); setPage(1); }}
              style={{ ...inputStyle, width: 140 }}
            />
          </label>
          {/* `entity=shipments` 가 `/data/export` 화이트리스트에 없다 → 동작시키지 않는다 */}
          <button type="button" className="btn" disabled title="준비 중 — 내보내기 대상에 출하 데이터가 아직 포함돼 있지 않습니다">
            내보내기 (준비 중)
          </button>
        </div>
      </div>

      {rangeError && <ErrorAlert message={`${rangeError} — 조회를 실행하지 않았습니다`} />}

      {/* [B] KPI */}
      {dash.loading ? (
        <div className="card" style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: T.textSub }}>
          <Spinner size="sm" /> 출하 지표를 불러오는 중
        </div>
      ) : dash.error ? (
        <ErrorAlert message={`출하 지표를 불러오지 못했습니다 — ${dash.error}`} />
      ) : dash.data ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
          <KpiCard label="오늘 출하량" value={dash.data.today_qty.toFixed(1)} unit="kg" />
          <KpiCard label="주간 출하량" value={dash.data.week_qty.toFixed(1)} unit="kg" />
          <KpiCard label="출하 완료" value={list.loading ? "—" : total.toLocaleString("ko-KR")} unit="건" />
          <div className="card" style={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: 4 }}>
            <div style={{ fontSize: 11.5, fontWeight: 600, color: T.textSub }}>출하 대기</div>
            <div style={{ fontSize: 13, color: T.textMuted, lineHeight: 1.5 }}>
              제공 전 — 출하 대기 판정(<code>shipment_state</code>)은 서버가 내려줘야 하며 아직 응답에
              없습니다. 화면에서 임의로 계산하지 않습니다.
            </div>
          </div>
        </div>
      ) : null}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        {/* [C] 고객사별 출하량 */}
        <div className="card">
          <div style={sectionTitle}>고객사별 출하량 (최근 7일)</div>
          {dash.loading ? (
            <Spinner size="sm" />
          ) : dash.error ? (
            <ErrorAlert message={dash.error} />
          ) : (dash.data?.by_customer.length ?? 0) === 0 ? (
            <p style={{ fontSize: 12.5, color: T.textMuted, margin: 0 }}>최근 7일 출하 실적이 없습니다.</p>
          ) : (
            <CustomerBars rows={dash.data!.by_customer} />
          )}
        </div>

        {/* [D] 출하 일정 캘린더 */}
        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div style={{ ...sectionTitle, marginBottom: 0 }}>출하 일정</div>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <button type="button" className="btn" onClick={() => setMonth((m) => shiftMonth(m, -1))}>
                ‹
              </button>
              <span style={{ fontSize: 12.5, fontWeight: 600, color: T.text, minWidth: 70, textAlign: "center" }}>
                {month}
              </span>
              <button type="button" className="btn" onClick={() => setMonth((m) => shiftMonth(m, 1))}>
                ›
              </button>
            </div>
          </div>
          {calendar.loading ? (
            <Spinner size="sm" />
          ) : calendar.error ? (
            <ErrorAlert message={`캘린더를 불러오지 못했습니다 — ${calendar.error}`} />
          ) : (
            <MonthCalendar month={month} cells={calendar.data ?? []} />
          )}
        </div>
      </div>

      {/* [E] 출하 목록 */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <div style={sectionTitle}>출하 목록</div>
          <span style={{ fontSize: 12, color: T.textSub }}>
            {list.loading ? "조회 중" : `총 ${total.toLocaleString("ko-KR")}건`}
          </span>
        </div>

        {rangeError ? null : list.loading ? (
          <StatusScreen tone="loading" title="출하 목록을 불러오는 중" />
        ) : list.error ? (
          <ErrorAlert message={`출하 목록을 불러오지 못했습니다 — ${list.error}`} />
        ) : items.length === 0 ? (
          <StatusScreen
            tone="empty"
            title="선택한 기간에 출하 내역이 없습니다"
            actions={[{ label: "기간 초기화", onClick: resetRange, primary: true }]}
          />
        ) : (
          <ShipmentTable rows={items} />
        )}

        {!rangeError && !list.loading && !list.error && total > PAGE_SIZE && (
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, alignItems: "center" }}>
            <span style={{ fontSize: 12, color: T.textSub }}>
              {page} / {maxPage}
            </span>
            <button type="button" className="btn" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              이전
            </button>
            <button type="button" className="btn" disabled={page >= maxPage} onClick={() => setPage((p) => p + 1)}>
              다음
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── [C] 수평 막대 ────────────────────────────────────────────────────────────

function CustomerBars({ rows }: { rows: { customer: string; quantity: number }[] }) {
  const max = Math.max(...rows.map((r) => r.quantity), 1);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {rows.map((r) => (
        <div key={r.customer} style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 12, color: T.text, width: 90, flexShrink: 0 }}>{r.customer}</span>
          <div style={{ flex: 1, height: 10, background: T.surfaceSubtle, borderRadius: 6, overflow: "hidden" }}>
            <div
              style={{
                width: `${(r.quantity / max) * 100}%`,
                height: "100%",
                background: T.primary,
                borderRadius: 6,
              }}
            />
          </div>
          <span style={{ fontSize: 12, fontWeight: 700, color: T.text, width: 78, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
            {r.quantity.toFixed(1)} kg
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── [D] 월 캘린더 ────────────────────────────────────────────────────────────

function MonthCalendar({
  month,
  cells,
}: {
  month: string;
  cells: { date: string; count: number; quantity: number }[];
}) {
  const [y, m] = month.split("-").map(Number);
  const first = new Date(y, m - 1, 1);
  const daysInMonth = new Date(y, m, 0).getDate();
  const lead = first.getDay();
  const byDate = new Map(cells.map((c) => [c.date, c]));

  const slots: (number | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4, marginBottom: 4 }}>
        {["일", "월", "화", "수", "목", "금", "토"].map((d) => (
          <div key={d} style={{ fontSize: 10.5, fontWeight: 600, color: T.textMuted, textAlign: "center" }}>
            {d}
          </div>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 }}>
        {slots.map((day, i) => {
          if (day === null) return <div key={`pad-${i}`} />;
          const key = `${month}-${String(day).padStart(2, "0")}`;
          const cell = byDate.get(key);
          return (
            <div
              key={key}
              style={{
                minHeight: 44,
                border: `1px solid ${T.border}`,
                borderRadius: 6,
                padding: "3px 5px",
                background: cell ? "#EEF1FD" : T.surface,
              }}
            >
              <div style={{ fontSize: 10.5, color: T.textMuted, fontVariantNumeric: "tabular-nums" }}>{day}</div>
              {cell && (
                <div style={{ fontSize: 10.5, color: T.primary, fontWeight: 700, lineHeight: 1.3 }}>
                  {cell.count}건
                  <br />
                  {cell.quantity.toFixed(0)}kg
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── [E] 목록 표 ──────────────────────────────────────────────────────────────

function ShipmentTable({ rows }: { rows: ShipmentDto[] }) {
  return (
    <div style={tableWrapStyle}>
      <table style={tableStyle}>
        <thead>
          <tr style={{ background: T.surfaceSubtle }}>
            <th style={thStyle}>LOT번호</th>
            <th style={thStyle}>고객사</th>
            <th style={thStyle}>제품</th>
            <th style={{ ...thStyle, textAlign: "right" }}>수량</th>
            <th style={thStyle}>단위</th>
            <th style={thStyle}>출하일시</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} style={{ borderBottom: `1px solid ${T.border}` }}>
              <td style={{ ...tdStyle, fontWeight: 600 }}>{r.lot_id}</td>
              <td style={tdStyle}>{r.customer}</td>
              <td style={tdStyle}>{r.product}</td>
              {/* DECIMAL(10,2) — 소수 2자리 고정, 서버 값을 반올림하지 않는다 */}
              <td style={{ ...tdStyle, textAlign: "right" }}>{r.quantity.toFixed(2)}</td>
              <td style={tdStyle}>{r.unit}</td>
              <td style={tdStyle}>{r.shipped_at.replace("T", " ").slice(0, 16)}</td>
            </tr>
          ))}
        </tbody>
      </table>
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
