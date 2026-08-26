"use client";

/**
 * FE-RT-02 — 생산 현황 대시보드 · `/dashboard/production` · FR-D-01
 *
 * 명세: `specs/plan-g1.md` FE-RT-02 · 와이어프레임 **SF-TD3 §3.1**
 * (KPI 4카드 / 주간 수율 트렌드 / 알림 목록 / 최근 LOT 표 — 4영역).
 *
 * 라운드 2 에서 고친 것:
 *   - 하드코딩 mock 전량 삭제 (`TREND_7D` 9줄 · `LOT_DATA` 14줄 · `SPARKLINE_*` 4종)
 *     → `GET /api/v1/dashboard/production` **단일 요청**으로 4영역을 전부 채운다
 *   - KPI **6개 → 4개** (가동률·생산효율·당일 생산량(kg)은 저장 컬럼이 없다)
 *   - 알림 패널 **신규** (SF-TD3 §3.1 필수 요소였는데 없었다)
 *   - 표: 제품별 생산실적(제품/목표량/달성률/등급 — DB 컬럼 없음) → **최근 LOT 현황 5열**
 *   - 상태 배지는 서버 `status` 를 `lotStatusBadge()` 로 그린다. 점수로 재계산하지 않는다
 *   - 죽은 기간 탭·동작 없는 다운로드 버튼 제거
 *
 * ⚠ `?date` 를 **보내지 않는다** (`TODO-G1-001`). 시드 범위가 `~2026-06-26` 이라
 *    브라우저 오늘 날짜를 보내면 빈 대시보드가 된다. 서버가 `MAX(lots.date)` 를 쓴다.
 */

import Link from "next/link";
import { useMemo } from "react";
import { useDashboardProduction } from "@/hooks/useKoryoData";
import type { AlertDto, DashboardProductionDto, LotDto } from "@/types/api";
import { lotStatusBadge } from "@/lib/quality";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { TrendChart } from "@/components/charts/TrendChart";
import { T } from "@/components/ui/tokens";
import { CenterBox, PageHeader, PageShell, ScreenError, dateOnly, int, num } from "../../_g1/ui";

/**
 * 응답에 `date`(기준일)가 실려 오는데 `DashboardProductionDto` 에는 그 필드가 없다.
 * 계약 타입을 고칠 권한이 없으므로(개발3 소관) 읽기만 확장한다 — 값을 지어내지는 않는다.
 */
type ProductionResponse = DashboardProductionDto & { date?: string };

/** 주간 수율은 실측상 `value: null` 인 날이 있다 (LOT 이 없는 날). 타입은 `number` 다 */
type WeeklyPoint = { date: string; value: number | null };

/** SF-TD3 §3.1 와이어프레임의 Y 범위. 데이터가 벗어나면 자동 확장한다 */
const YIELD_AXIS_MIN = 90;
const YIELD_AXIS_MAX = 100;

// ── KPI 타일 ─────────────────────────────────────────────────────────────────
//
// 공용 `KpiCard` 를 쓰지 않는 이유는 하나다: `trend="down"` 이 무조건 Error 색이라
// **"불량률 하락(= 좋음)"을 초록으로 그릴 수 없다.** `components/ui/` 는 이번 라운드에서
// 수정 금지라 타일만 여기 두고, 타이포그래피는 `KpiCard` 와 동일하게 맞춘다.

function DeltaBadge({
  delta,
  unit,
  /** true 면 **하락이 좋음** (불량률). 색만 뒤집고 화살표 방향은 값 그대로다 */
  lowerIsBetter = false,
}: {
  delta: number | null;
  unit: string;
  lowerIsBetter?: boolean;
}) {
  // 🔴 `null` 이면 배지를 **숨긴다.** `0` 으로 렌더하면 "변화 없음"과 구분이 안 된다
  //    (api-contract §8.2). 이건 표시 선택이 아니라 계약이다.
  if (delta === null || delta === undefined || !Number.isFinite(delta)) return null;

  const rising = delta > 0;
  const flat = delta === 0;
  const good = lowerIsBetter ? !rising : rising;

  const color = flat ? "#5B6573" : good ? "#15803D" : "#B91C1C";
  const bg = flat ? "#F2F4F7" : good ? "#ECFDF3" : "#FEF1F2";
  const arrow = flat ? "→" : rising ? "▲" : "▼";

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 3,
        padding: "2px 7px",
        borderRadius: 20,
        fontSize: 11,
        fontWeight: 700,
        color,
        background: bg,
        whiteSpace: "nowrap",
      }}
    >
      {arrow} {rising ? "+" : ""}
      {delta.toFixed(1)}
      {unit}
    </span>
  );
}

function KpiTile({
  label,
  value,
  unit,
  delta,
  deltaUnit,
  lowerIsBetter,
}: {
  label: string;
  value: string;
  unit?: string;
  delta: number | null;
  deltaUnit: string;
  lowerIsBetter?: boolean;
}) {
  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <span
          style={{
            fontSize: 11.5,
            fontWeight: 600,
            color: T.textSub,
            letterSpacing: "0.03em",
            textTransform: "uppercase",
          }}
        >
          {label}
        </span>
        <DeltaBadge delta={delta} unit={deltaUnit} lowerIsBetter={lowerIsBetter} />
      </div>
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
          {value}
        </span>
        {unit && (
          <span style={{ fontSize: 13, fontWeight: 500, color: T.textMuted, marginBottom: 2 }}>
            {unit}
          </span>
        )}
      </div>
    </div>
  );
}

// ── 알림 항목 ─────────────────────────────────────────────────────────────────

const LEVEL_COLOR: Record<AlertDto["level"], string> = {
  critical: T.error,
  warning: T.warning,
  info: T.textSub,
};

const LEVEL_GLYPH: Record<AlertDto["level"], string> = {
  critical: "🔴",
  warning: "🟡",
  info: "🔵",
};

function AlertRow({ alert }: { alert: AlertDto }) {
  const body = (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 8,
        padding: "9px 10px",
        borderRadius: 8,
        // 처리된 알림은 회색 처리 — 사라지지는 않는다
        background: alert.resolved ? T.surfaceSubtle : "transparent",
        opacity: alert.resolved ? 0.6 : 1,
      }}
    >
      <span aria-hidden="true" style={{ fontSize: 10, lineHeight: "18px" }}>
        {LEVEL_GLYPH[alert.level]}
      </span>
      <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
        <span
          style={{
            fontSize: 12.5,
            lineHeight: 1.5,
            color: alert.resolved ? T.textMuted : LEVEL_COLOR[alert.level],
            fontWeight: alert.level === "info" ? 400 : 600,
          }}
        >
          {alert.message}
        </span>
        <span style={{ fontSize: 11, color: T.textMuted }}>
          {alert.created_at.replace("T", " ").slice(0, 16)}
          {alert.resolved ? " · 처리됨" : ""}
        </span>
      </div>
    </div>
  );

  // `lot_id` 가 없는 알림은 갈 곳이 없다 → 링크로 만들지 않는다
  if (!alert.lot_id) return <div>{body}</div>;
  return (
    <Link
      href={`/shipping/lot?lot_id=${encodeURIComponent(alert.lot_id)}`}
      style={{ textDecoration: "none", display: "block" }}
    >
      {body}
    </Link>
  );
}

// ── 최근 LOT 표 ───────────────────────────────────────────────────────────────
//
// 공용 `DataTable` 대신 로컬 표를 쓴다. 불합격 행의 **행 배경 tint** 와 **행 클릭 이동**이
// 필요한데 `DataTable` 은 둘 다 지원하지 않고, 그 컴포넌트는 이번 라운드 수정 금지다.

const TH: React.CSSProperties = {
  padding: "10px 14px",
  fontSize: 11.5,
  fontWeight: 600,
  color: T.textSub,
  letterSpacing: "0.03em",
  textTransform: "uppercase",
  borderBottom: `1px solid ${T.border}`,
  whiteSpace: "nowrap",
  textAlign: "left",
};

const TD: React.CSSProperties = {
  padding: "10px 14px",
  color: T.text,
  verticalAlign: "middle",
};

function RecentLotTable({ rows }: { rows: LotDto[] }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          fontSize: 12.5,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        <thead>
          <tr style={{ background: T.surfaceSubtle }}>
            <th style={{ ...TH, width: 140 }}>LOT ID</th>
            <th style={{ ...TH, width: 110 }}>날짜</th>
            <th style={{ ...TH, width: 90 }}>공급사</th>
            <th style={{ ...TH, width: 90, textAlign: "right" }}>품질점수</th>
            <th style={{ ...TH, width: 90 }}>상태</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((lot, i) => {
            const badge = lotStatusBadge(lot.status);
            const failed = lot.status === "fail";
            return (
              <tr
                key={lot.lot_id}
                style={{
                  borderBottom: i < rows.length - 1 ? `1px solid ${T.surfaceSubtle}` : "none",
                  // 불합격 LOT 은 행 전체를 Error tint 로 강조한다 (plan-g1 §6)
                  background: failed ? "#FEF1F2" : "transparent",
                }}
              >
                <td style={TD}>
                  <Link
                    href={`/shipping/lot?lot_id=${encodeURIComponent(lot.lot_id)}`}
                    style={{ color: T.primary, fontWeight: 600, textDecoration: "none" }}
                  >
                    {lot.lot_id}
                  </Link>
                </td>
                <td style={TD}>{dateOnly(lot.date)}</td>
                <td style={TD}>{lot.supplier_code}</td>
                {/* 미검사 LOT 은 `null` 이다 — `0` 으로 채우지 않는다 */}
                <td style={{ ...TD, textAlign: "right" }}>{num(lot.quality_score, 1)}</td>
                <td style={TD}>
                  <StatusBadge variant={badge.variant} label={badge.label} dot />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── 페이지 ────────────────────────────────────────────────────────────────────

export default function ProductionDashboardPage() {
  // `date` 를 보내지 않는다 (TODO-G1-001) — 서버가 최신 생산일을 고른다
  const { data, loading, error, refetch } = useDashboardProduction();

  const weekly = useMemo<WeeklyPoint[]>(
    () => ((data?.weekly_yield ?? []) as unknown as WeeklyPoint[]),
    [data],
  );

  const yieldDomain = useMemo<[number, number]>(() => {
    const values = weekly
      .map((p) => p.value)
      .filter((v): v is number => v !== null && Number.isFinite(v));
    return [
      Math.min(YIELD_AXIS_MIN, ...(values.length ? values : [YIELD_AXIS_MIN])),
      Math.max(YIELD_AXIS_MAX, ...(values.length ? values : [YIELD_AXIS_MAX])),
    ];
  }, [weekly]);

  if (loading) {
    return (
      <PageShell>
        <PageHeader title="생산 현황 대시보드" />
        <CenterBox minHeight={420}>
          <span style={{ fontSize: 13, color: T.textMuted }}>불러오는 중…</span>
        </CenterBox>
      </PageShell>
    );
  }

  // 🔴 백엔드가 죽으면 화면에 그렇게 보인다. KPI 수치는 **하나도** 렌더하지 않는다.
  if (error) return <ScreenError message={error} onRetry={refetch} />;
  if (!data) return <ScreenError message="응답이 비어 있습니다" onRetry={refetch} />;

  const { kpi, alerts, recent_lots } = data;
  const baseDate = (data as ProductionResponse).date;
  // 결측 날짜는 `NaN` 으로 넘긴다 — TrendChart 가 비유한 값을 건너뛴다 (0 으로 잇지 않는다)
  const yieldValues = weekly.map((p) => (p.value === null ? NaN : p.value));
  const missingDays = weekly.filter((p) => p.value === null).length;

  return (
    <PageShell>
      <PageHeader
        title="생산 현황 대시보드"
        subtitle="당일 생산 LOT·수율·불량률·평균 품질 점수 (FR-D-01)"
        actions={
          <>
            {baseDate && (
              <span
                style={{
                  fontSize: 12.5,
                  fontWeight: 600,
                  color: T.textSub,
                  padding: "6px 12px",
                  borderRadius: 8,
                  background: T.surfaceSubtle,
                  border: `1px solid ${T.border}`,
                }}
              >
                기준일 {dateOnly(baseDate)}
              </span>
            )}
            <button type="button" className="btn" onClick={refetch}>
              새로고침
            </button>
          </>
        }
      />

      {/* ── KPI 4카드 (SF-TD3 §3.1 — 1행 4열) ─────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
        <KpiTile
          label="오늘 생산 LOT 수"
          value={int(kpi.today_lots)}
          unit="건"
          delta={kpi.today_lots_delta}
          deltaUnit="건"
        />
        <KpiTile
          label="수율"
          value={num(kpi.yield_pct, 1)}
          unit="%"
          delta={kpi.yield_pct_delta}
          deltaUnit="%p"
        />
        <KpiTile
          label="불량률"
          value={num(kpi.defect_rate, 1)}
          unit="%"
          delta={kpi.defect_rate_delta}
          deltaUnit="%p"
          // 불량률은 **내려가는 것이 좋다** — 색을 반전한다 (plan-g1 §4)
          lowerIsBetter
        />
        <KpiTile
          label="평균 품질 점수"
          value={num(kpi.avg_quality, 1)}
          delta={kpi.avg_quality_delta}
          deltaUnit="p"
        />
      </div>

      {/* ── 주간 수율 트렌드 (좌 2/3) + 알림 (우 1/3) ──────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 20, alignItems: "start" }}>
        <section className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
            <h2 style={{ fontSize: 16, fontWeight: 600, color: T.text, margin: 0 }}>
              주간 수율 트렌드 (7일)
            </h2>
            {missingDays > 0 && (
              <span style={{ fontSize: 11, color: T.textMuted }}>
                생산 없는 날 {missingDays}일은 선을 잇지 않았습니다
              </span>
            )}
          </div>

          {weekly.length === 0 ? (
            <CenterBox minHeight={220}>
              <span style={{ fontSize: 13, color: T.textMuted }}>트렌드 데이터가 없습니다</span>
            </CenterBox>
          ) : (
            <TrendChart
              categories={weekly.map((p) => p.date.slice(5))}
              series={[{ name: "수율", values: yieldValues, color: "primary", area: true }]}
              height={220}
              yDomain={yieldDomain}
              formatY={(v) => v.toFixed(0)}
              ariaLabel="주간 수율 트렌드"
              emptyMessage="트렌드 데이터가 없습니다"
            />
          )}
        </section>

        <section className="card" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, color: T.text, margin: 0 }}>
            알림 ({alerts.length}건)
          </h2>
          {alerts.length === 0 ? (
            <CenterBox minHeight={200}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: "#15803D" }}>
                <span aria-hidden="true">✓</span> 알림 없음
              </span>
            </CenterBox>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 2, maxHeight: 320, overflowY: "auto" }}>
              {alerts.map((a) => (
                <AlertRow key={a.id} alert={a} />
              ))}
            </div>
          )}
        </section>
      </div>

      {/* ── 최근 LOT 현황 ─────────────────────────────────────────────────── */}
      <section className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, color: T.text, margin: 0 }}>최근 LOT 현황</h2>
        {recent_lots.length === 0 ? (
          <CenterBox minHeight={160}>
            <span style={{ fontSize: 13, color: T.textMuted }}>표시할 LOT 이 없습니다</span>
          </CenterBox>
        ) : (
          <RecentLotTable rows={recent_lots} />
        )}
      </section>
    </PageShell>
  );
}
