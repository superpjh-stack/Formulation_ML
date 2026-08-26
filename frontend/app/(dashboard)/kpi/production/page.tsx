"use client";

/**
 * FE-RT-43 — 생산 KPI · `/kpi/production` · FR-K-01 (필수)
 *
 * 명세: `specs/plan-g3.md` FE-RT-43. 와이어프레임 없음(SF-TD3 §3).
 * SF-AD3 기능대비표: *"목표 대비 실적 **게이지·트렌드**"* → 두 요소가 명시적 구성요소다.
 * 저장 테이블: `lots`(집계) + `kpi_targets`(목표값). **501 아님.**
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * 🔴 **생산량 단위는 `LOT` 다. `kg` 이 나오면 실패다** (수용 기준 3).
 *
 * `lots` 에 투입량·산출량 컬럼이 없다 (api-contract §8.6: *"`input_qty`/`output_qty` 는
 * 저장 테이블이 없다"*). 그래서 계약이 `production_volume` 을 `COUNT(lots)` 로 대체하고
 * 단위를 `LOT` 로 규정했다. 개편 전 `production: 18200` (kg) 은 **저장할 곳이 없는 값**이었다.
 *
 * 라운드 2 에서 고친 것:
 *   - 하드코딩 6개월 배열 삭제 → `GET /api/v1/kpi/production?months=` 실 연동
 *   - 생산량 kg → **LOT**
 *   - `utilization`(설비 가동률)·`efficiency`(생산 효율) 카드 제거 —
 *     `equipment` 에 가동률 컬럼이 없고 `lots` 에 효율 컬럼이 없다
 *   - **수율·불량률 신설** — FR-K-01 의 3요소 중 2개가 빠져 있었다
 *   - 목표값 `20000` 하드코딩 → `kpi_targets.target_value` (서버 조인)
 *   - 기간 선택 신설 (항상 6개월 고정이었다)
 *   - 페이지 내부 canvas 중복 구현(`GaugeArc`) → 공용 조각
 *
 * ✅ **계약 확장 #4 가 반영됐다.** `target`·`achieved` 가 스칼라가 아니라
 *    **지표별 객체**(`{yield_pct, production_volume, defect_rate}`)로 온다.
 *    덕분에 3지표 모두 게이지를 그릴 수 있다.
 *
 * ⚠ 목표값이 실재하는 지표는 **수율(95)·불량률(5)** 2종뿐이다. `production_volume` 은
 *   근거가 없어 `target=null` 로 오므로 **게이지를 숨긴다** (수용 기준 4).
 *   **달성 판정(`achieved`)은 서버가 한다** — 불량률은 낮을수록 좋다는 방향을
 *   프론트가 하드코딩하지 않는다.
 * ══════════════════════════════════════════════════════════════════════════════
 */

import { useMemo, useState } from "react";
import { useKpiProduction } from "@/hooks/useKoryoData";
import { KPI_DECIMALS, KPI_LABELS, KPI_UNITS } from "@/types/api";
import { TrendChart } from "@/components/charts/TrendChart";
import { T } from "@/components/ui/tokens";
import {
  Field,
  FilterBar,
  PageHeader,
  PageShell,
  ScreenError,
  Section,
  Select,
  num,
} from "../../_g1/ui";
import { TargetGauge } from "../../_g3/ui";

/** `months` 상한이 계약에 없다 — 프론트 선택지를 24 로 제한한다 (**판단값**) */
const MONTH_OPTIONS = [
  { value: "6", label: "최근 6개월" },
  { value: "12", label: "최근 12개월" },
  { value: "24", label: "최근 24개월" },
];

const METRICS = ["yield_pct", "production_volume", "defect_rate"] as const;
type Metric = (typeof METRICS)[number];

/** 값 없는 달은 **선을 끊는다.** 0 으로 찍지 않는다 (§6) */
const gap = (v: number | null | undefined) => (Number.isFinite(v as number) ? (v as number) : NaN);

export default function KpiProductionPage() {
  const [months, setMonths] = useState(12);
  const state = useKpiProduction(months);

  const rows = useMemo(() => state.data ?? [], [state.data]);
  /**
   * 요약 카드가 가리키는 "현재" 달.
   *
   * 서버는 요청한 개월 수만큼 **실적이 없는 미래 달까지** 채워 준다
   * (예: 2026-07·08 은 전 지표가 `null`). 초판은 배열의 마지막 원소를 그대로 썼는데,
   * 그 결과 카드가 전부 `—` 에 "설정된 목표값이 없습니다" 로 뜨면서
   * **바로 아래 표에는 목표 95.0/5.0/88.00 이 찍히는 자기모순**이 났다 (QA-C DEF-C-01).
   *
   * 실적이 하나라도 있는 **가장 최근 달**을 고른다.
   */
  const latest = useMemo(() => {
    for (let i = rows.length - 1; i >= 0; i -= 1) {
      const r = rows[i];
      if (METRICS.some((k) => r[k] !== null && r[k] !== undefined)) return r;
    }
    return null;
  }, [rows]);

  if (state.error) {
    return (
      <PageShell>
        <PageHeader title="생산 KPI" subtitle="월별 수율·생산량·불량률 · 목표 대비 현황" />
        <ScreenError message={state.error} onRetry={state.refetch} />
      </PageShell>
    );
  }

  const empty = !state.loading && rows.length === 0;

  return (
    <PageShell>
      <PageHeader
        title="생산 KPI"
        subtitle="월별 수율·생산량·불량률 · 목표 대비 현황"
        actions={
          <Field label="기간" htmlFor="kp-months" width={160}>
            <Select
              id="kp-months"
              value={String(months)}
              onChange={(v) => setMonths(Number(v))}
              options={MONTH_OPTIONS}
              width={160}
            />
          </Field>
        }
      />

      {/* ── KPI 카드 3 ─────────────────────────────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
        {METRICS.map((m) => (
          <div key={m} className="card" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: T.textSub }}>
              {KPI_LABELS[m]}
            </span>
            <strong style={{ fontSize: 28, fontWeight: 700, color: T.text, lineHeight: 1.2 }}>
              {state.loading || !latest ? "—" : num(latest[m], KPI_DECIMALS[m])}
              <span style={{ fontSize: 14, fontWeight: 500, color: T.textSub, marginLeft: 4 }}>
                {KPI_UNITS[m]}
              </span>
            </strong>
            {/* 목표가 없으면 목표 줄 자체를 그리지 않는다 */}
            {latest && latest.target[m] !== null && (
              <span style={{ fontSize: 11.5, color: T.textMuted }}>
                목표 {num(latest.target[m], KPI_DECIMALS[m])}
                {KPI_UNITS[m]}
                {latest.achieved[m] !== null && (
                  <strong
                    style={{
                      marginLeft: 6,
                      color: latest.achieved[m] ? T.success : T.error,
                    }}
                  >
                    {latest.achieved[m] ? "달성" : "미달"}
                  </strong>
                )}
              </span>
            )}
            {latest && latest.target[m] === null && (
              <span style={{ fontSize: 11.5, color: T.textMuted }}>목표 미설정</span>
            )}
          </div>
        ))}
      </div>

      {/* ── 목표 대비 달성 게이지 — 목표값이 있는 지표만 ────────────────────── */}
      <Section title="목표 대비 달성">
        {state.loading && <Center>불러오는 중…</Center>}
        {empty && <Center>해당 기간에 생산 실적이 없습니다.</Center>}
        {!state.loading && latest && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {METRICS.map((m) => (
              <TargetGauge
                key={m}
                label={`${KPI_LABELS[m]} (${latest.month})`}
                actual={latest[m]}
                target={latest.target[m]}
                achieved={latest.achieved[m]}
                unit={KPI_UNITS[m]}
                digits={KPI_DECIMALS[m]}
              />
            ))}
            {METRICS.every((m) => latest.target[m] === null) && (
              <span style={{ fontSize: 12.5, color: T.textMuted }}>
                설정된 목표값이 없습니다. KPI 설정 화면에서 목표를 등록하세요.
              </span>
            )}
          </div>
        )}
      </Section>

      {/* ── 월별 트렌드 ────────────────────────────────────────────────────── */}
      <Section title="월별 트렌드">
        {state.loading && <Center height={240}>불러오는 중…</Center>}
        {empty && <Center height={240}>해당 기간에 생산 실적이 없습니다.</Center>}
        {!state.loading && rows.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
            {METRICS.map((m) => (
              <div key={m}>
                <span style={{ fontSize: 12, fontWeight: 600, color: T.textSub }}>
                  {KPI_LABELS[m]} ({KPI_UNITS[m]})
                </span>
                <TrendChart
                  categories={rows.map((r) => r.month)}
                  series={[{ name: KPI_LABELS[m], values: rows.map((r) => gap(r[m])) }]}
                  height={180}
                  legend={false}
                  ariaLabel={`${KPI_LABELS[m]} 월별 트렌드`}
                />
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* ── 월별 표 ────────────────────────────────────────────────────────── */}
      <Section title="월별 실적">
        <div style={{ overflowX: "auto", border: `1px solid ${T.border}`, borderRadius: 12 }}>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: 12.5,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            <thead>
              <tr style={{ background: "#F8F9FB" }}>
                <Th>월</Th>
                {METRICS.map((m) => (
                  <Th key={m} right>
                    {KPI_LABELS[m]} ({KPI_UNITS[m]})
                  </Th>
                ))}
                {METRICS.map((m) => (
                  <Th key={`t-${m}`} right>
                    {KPI_LABELS[m]} 목표
                  </Th>
                ))}
              </tr>
            </thead>
            <tbody>
              {state.loading && (
                <tr>
                  <Td colSpan={7} muted>
                    불러오는 중…
                  </Td>
                </tr>
              )}
              {empty && (
                <tr>
                  <Td colSpan={7} muted>
                    해당 기간에 생산 실적이 없습니다.
                  </Td>
                </tr>
              )}
              {!state.loading &&
                rows.map((r) => (
                  <tr key={r.month} style={{ borderTop: `1px solid ${T.border}` }}>
                    <Td>{r.month}</Td>
                    {METRICS.map((m) => (
                      <Td key={m} right>
                        {num(r[m], KPI_DECIMALS[m])}
                      </Td>
                    ))}
                    {METRICS.map((m) => (
                      <Td key={`t-${m}`} right>
                        {r.target[m] === null ? (
                          "—"
                        ) : (
                          <>
                            {num(r.target[m], KPI_DECIMALS[m])}
                            {r.achieved[m] !== null && (
                              <span
                                style={{
                                  marginLeft: 5,
                                  color: r.achieved[m] ? T.success : T.error,
                                  fontWeight: 600,
                                }}
                              >
                                {r.achieved[m] ? "✔" : "✖"}
                              </span>
                            )}
                          </>
                        )}
                      </Td>
                    ))}
                  </tr>
                ))}
            </tbody>
          </table>
        </div>

        <span style={{ fontSize: 11, color: T.textMuted, lineHeight: 1.6 }}>
          ⓘ 생산량은 `COUNT(lots)` 이며 단위는 <strong>LOT</strong> 입니다 — 투입량·산출량
          컬럼이 DB 에 없어 kg 으로 표시할 수 없습니다. 달성 여부는 서버 판정값이며, 목표가
          없는 지표는 게이지와 목표 열을 표시하지 않습니다.
        </span>
      </Section>
    </PageShell>
  );
}

function Center({ children, height = 140 }: { children: React.ReactNode; height?: number }) {
  return (
    <div
      style={{
        minHeight: height,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 13,
        color: T.textMuted,
      }}
    >
      {children}
    </div>
  );
}

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th
      style={{
        padding: "10px 12px",
        fontSize: 12,
        fontWeight: 600,
        color: T.textSub,
        textAlign: right ? "right" : "left",
        whiteSpace: "nowrap",
        borderBottom: `1px solid ${T.border}`,
      }}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  colSpan,
  right,
  muted,
}: {
  children: React.ReactNode;
  colSpan?: number;
  right?: boolean;
  muted?: boolean;
}) {
  return (
    <td
      colSpan={colSpan}
      style={{
        padding: muted ? "28px 12px" : "9px 12px",
        color: muted ? T.textMuted : T.text,
        textAlign: muted ? "center" : right ? "right" : "left",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </td>
  );
}
