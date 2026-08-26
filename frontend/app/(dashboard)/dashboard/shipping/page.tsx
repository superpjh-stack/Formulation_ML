"use client";

/**
 * FE-RT-05 — 출하 현황 대시보드 · `/dashboard/shipping` · FR-D-04
 *
 * 명세: `specs/plan-g1.md` FE-RT-05. **SF-TD3 에 와이어프레임이 없어서**
 * 응답 4필드 = FR-D-04 본문 4요소를 그대로 매핑했다. **부분 구동 화면**이다 (api-contract §8.13).
 *
 * 라운드 2 에서 고친 것 — 이 화면은 "대폭 축소"가 핵심이다:
 *   - 하드코딩 mock 전량 삭제 (`CUSTOMER_BAR` 7줄 · `MONTHLY_TREND` 6줄 ·
 *     `SHIPPING_DATA` 14줄 · `SHIP_COLUMNS` 15줄 · `SPARKLINE_*` 4종)
 *   - **납기준수율 KPI 제거** — `shipments` 에 `due_date` 컬럼이 없다. 계산 근거가 없다
 *   - **출하 명세 표 제거** — 이 엔드포인트는 목록을 주지 않는다 (FE-RT-16 소관)
 *   - **월별 출하 추이 제거** — 응답에 시계열이 없다 (`TODO-G1-004`)
 *   - **출하건수 KPI 제거** — 응답의 두 값은 건수가 아니라 수량이다
 *   - 단위 **톤 → kg** (`shipments.unit` 기본값이 `kg` 다. 톤 환산은 DB 근거가 없다)
 *   - 실존 기업명(삼성전기·LG이노텍…) 하드코딩 제거 → `shipments.customer` 실 데이터
 *   - 클레임 카드: `null` 이면 **"미구현"**. `0 건` 으로 표시하지 않는다 —
 *     "클레임 0건"과 "클레임 기능 없음"은 완전히 다른 의미다
 */

import Link from "next/link";
import { useMemo, useState } from "react";
import { useDashboardShipping } from "@/hooks/useKoryoData";
import type { DashboardShippingDto } from "@/types/api";
import { PillFilter } from "@/components/ui/PillFilter";
import { T } from "@/components/ui/tokens";
import { CenterBox, PageHeader, PageShell, ScreenError, int, num } from "../../_g1/ui";

type Period = "7" | "30" | "90";

/** 기본 **7일** — api-contract §8.2 의 `?days=7` 이 정본이다 */
const PERIODS: { value: Period; label: string }[] = [
  { value: "7", label: "7일" },
  { value: "30", label: "30일" },
  { value: "90", label: "90일" },
];

/**
 * 계약은 `claims.open`/`closed` 가 `null` 일 수 있다고 규정하는데
 * `DashboardShippingDto` 는 `number` 로만 선언돼 있다. 읽기만 넓힌다 —
 * 값을 지어내지 않고, `null` 이면 "미구현" 으로 정직하게 그린다.
 */
type ShippingResponse = Omit<DashboardShippingDto, "claims"> & {
  claims: { open: number | null; closed: number | null };
};

/** 응답에 단위 필드가 없다. `shipments.unit DEFAULT 'kg'` (db-schema §3.10) 고정 표기 */
const QTY_UNIT = "kg";

function QtyCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <span
        style={{ fontSize: 11.5, fontWeight: 600, color: T.textSub, letterSpacing: "0.03em", textTransform: "uppercase" }}
      >
        {label}
      </span>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 4 }}>
        <span
          style={{
            fontSize: 26,
            fontWeight: 800,
            color: T.text,
            lineHeight: 1,
            fontVariantNumeric: "tabular-nums",
            letterSpacing: "-0.02em",
          }}
        >
          {/* `0` 은 유효한 값이다 — 정상 표시한다 */}
          {num(value, 2)}
        </span>
        <span style={{ fontSize: 13, fontWeight: 500, color: T.textMuted, marginBottom: 2 }}>
          {QTY_UNIT}
        </span>
      </div>
    </div>
  );
}

function ClaimCard({ claims }: { claims: ShippingResponse["claims"] }) {
  const unavailable = claims.open === null && claims.closed === null;

  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <span
        style={{ fontSize: 11.5, fontWeight: 600, color: T.textSub, letterSpacing: "0.03em", textTransform: "uppercase" }}
      >
        클레임
      </span>
      {unavailable ? (
        // 🔴 수치를 만들어내지 않는다. 기능이 없다는 사실을 그대로 적는다
        <span style={{ fontSize: 13, color: T.textMuted, lineHeight: 1.5 }}>
          미구현 — CR-DB-001 승인 대기
        </span>
      ) : (
        <div style={{ display: "flex", alignItems: "flex-end", gap: 16 }}>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 4 }}>
            <span
              style={{
                fontSize: 26,
                fontWeight: 800,
                color: T.error,
                lineHeight: 1,
                fontVariantNumeric: "tabular-nums",
                letterSpacing: "-0.02em",
              }}
            >
              {int(claims.open)}
            </span>
            <span style={{ fontSize: 12, color: T.textMuted, marginBottom: 2 }}>건 미처리</span>
          </div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 4 }}>
            <span
              style={{ fontSize: 18, fontWeight: 700, color: T.textSub, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}
            >
              {int(claims.closed)}
            </span>
            <span style={{ fontSize: 12, color: T.textMuted, marginBottom: 1 }}>건 처리완료</span>
          </div>
        </div>
      )}
    </div>
  );
}

/** 고객사별 가로 막대 — 출하량 내림차순. 10개를 넘으면 스크롤한다 */
function CustomerBars({ rows }: { rows: { customer: string; quantity: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.quantity));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, maxHeight: 420, overflowY: "auto" }}>
      {rows.map((r) => (
        <div key={r.customer} style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span
            style={{
              width: 120,
              flexShrink: 0,
              fontSize: 12.5,
              fontWeight: 600,
              color: T.text,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={r.customer}
          >
            {r.customer}
          </span>
          <div style={{ flex: 1, height: 20, borderRadius: 4, background: T.surfaceSubtle, position: "relative" }}>
            <div
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                bottom: 0,
                width: `${Math.max(1, (r.quantity / max) * 100)}%`,
                borderRadius: 4,
                background: "linear-gradient(90deg, #6B8AFF, #3A5BD9)",
              }}
            />
          </div>
          <span
            style={{
              width: 110,
              flexShrink: 0,
              textAlign: "right",
              fontSize: 12.5,
              fontWeight: 700,
              color: T.text,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {num(r.quantity, 2)} {QTY_UNIT}
          </span>
        </div>
      ))}
    </div>
  );
}

export default function ShippingDashboardPage() {
  const [period, setPeriod] = useState<Period>("7");
  const days = Number(period);
  const { data, loading, error, refetch } = useDashboardShipping(days);

  const byCustomer = useMemo(
    () => [...(data?.by_customer ?? [])].sort((a, b) => b.quantity - a.quantity),
    [data],
  );

  if (error) return <ScreenError message={error} onRetry={refetch} />;

  const res = data as ShippingResponse | null;

  return (
    <PageShell>
      <PageHeader
        title="출하 현황 대시보드"
        subtitle="당일·기간 출하량 · 고객사별 출하량 · 클레임 현황 (FR-D-04)"
        actions={
          <>
            <PillFilter
              options={PERIODS}
              value={period}
              onChange={(v) => setPeriod(v)}
              ariaLabel="조회 기간"
              size="md"
            />
            <Link href="/shipping/main" className="btn">
              출하 목록 보기
            </Link>
          </>
        }
      />

      {/* 기간 전환 중에는 이전 기간 데이터를 남기지 않는다 */}
      {loading || !res ? (
        <CenterBox minHeight={420}>
          <span style={{ fontSize: 13, color: T.textMuted }}>불러오는 중…</span>
        </CenterBox>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
            <QtyCard label="당일 출하량" value={res.today_qty} />
            <QtyCard label={`최근 ${days}일 출하량`} value={res.week_qty} />
            <ClaimCard claims={res.claims} />
          </div>

          <section className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
              <h2 style={{ fontSize: 16, fontWeight: 600, color: T.text, margin: 0 }}>
                고객사별 출하량
              </h2>
              <span style={{ fontSize: 11, color: T.textMuted }}>최근 {days}일 · 출하량 내림차순</span>
            </div>
            {byCustomer.length === 0 ? (
              <CenterBox minHeight={220}>
                <span style={{ fontSize: 13, color: T.textMuted }}>
                  해당 기간 출하 실적이 없습니다
                </span>
              </CenterBox>
            ) : (
              <CustomerBars rows={byCustomer} />
            )}
          </section>
        </>
      )}
    </PageShell>
  );
}
