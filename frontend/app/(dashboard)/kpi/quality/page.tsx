"use client";

/**
 * FE-RT-44 — 품질 KPI · `/kpi/quality` · FR-K-02 (필수)
 *
 * 명세: `specs/plan-g3.md` FE-RT-44. 와이어프레임 없음(SF-TD3 §3).
 * SF-AD2 §1.10 인용: *"평균 품질 점수, 합격률, 클레임 발생률 월별 KPI"*.
 * 저장 테이블: `quality` + `claims` + `kpi_targets` (셋 다 존재). **501 아님.**
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * 라운드 2 에서 고친 것:
 *   - 하드코딩 6개월 배열 삭제 → `GET /api/v1/kpi/quality?months=` 실 연동
 *   - **`defectRate`(불량률) 카드 제거** — FR-K-01 소관이다. FE-RT-43 으로 이관했다.
 *     이 화면에 불량률이 있으면 수용 기준 3 위반이다
 *   - `CUSTOMER_SCORES` 6건 제거 — 삼성전자/LG이노텍/현대모비스/SK하이닉스/삼성SDI/
 *     한화에어로. **고객사명이 산출물 어디에도 없고**(`CUST-A` 형식이 정본)
 *     고객사별 품질 점수를 낼 컬럼도 없다. 고객사 단위 집계는 요구사항(FR-K-02)에도 없다
 *   - 목표선 `target` prop 하드코딩 → `kpi_targets.target_value` (서버 조인)
 *   - **합격 기준선 신설** — 품질점수 트렌드에 기준선이 없었다.
 *     🔴 값은 하드코딩하지 않는다. `usePublicSettings()` 의 `quality_pass_score` 이고,
 *     서버 값을 못 읽으면 폴백 배너를 띄운다 (`source === 'fallback'`)
 *   - 기간 선택 신설
 *   - 페이지 내부 canvas 중복 구현(`TrendChart`) → 공용 컴포넌트
 *
 * ✅ **`claim_rate` 가 v1.1 에서 살아났다.** api-contract §8.11 은 *"`claims`(CR-DB-001)
 *    대기 → `null`"* 이라고 적었으나 `claims` 테이블이 생성 완료됐다 (db-schema §6.4).
 *
 * ⚠ **`claim_rate` 의 분모가 계약에 정의돼 있지 않다** (`COUNT(shipments)` 인지
 *   `COUNT(lots)` 인지 불명 — 부록 B #7). **서버 값을 그대로 표시하고 프론트가
 *   계산하지 않는다.**
 *
 * ⚠ 목표값이 실재하는 지표는 **평균 품질점수(88)** 1종뿐이다. `pass_rate`·`claim_rate` 는
 *   근거가 없어 `target=null` 로 오므로 **게이지를 숨긴다**.
 *   달성 판정(`achieved`)은 **서버가 한다** — 클레임률이 낮을수록 좋다는 방향을
 *   프론트가 하드코딩하지 않는다.
 * ══════════════════════════════════════════════════════════════════════════════
 */

import { useMemo, useState } from "react";
import { useKpiQuality, usePublicSettings } from "@/hooks/useKoryoData";
import { KPI_DECIMALS, KPI_LABELS, KPI_UNITS } from "@/types/api";
import { passScoreOf } from "@/lib/quality";
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
  SettingsFallbackBanner,
  num,
} from "../../_g1/ui";
import { TargetGauge } from "../../_g3/ui";

const MONTH_OPTIONS = [
  { value: "6", label: "최근 6개월" },
  { value: "12", label: "최근 12개월" },
  { value: "24", label: "최근 24개월" },
];

/** FR-K-02 의 3요소와 1:1. **불량률은 여기 없다** (FE-RT-43 소관) */
const METRICS = ["quality_avg", "pass_rate", "claim_rate"] as const;
type Metric = (typeof METRICS)[number];

const gap = (v: number | null | undefined) => (Number.isFinite(v as number) ? (v as number) : NaN);

export default function KpiQualityPage() {
  const [months, setMonths] = useState(12);
  const state = useKpiQuality(months);

  /** 🔴 합격선은 서버 설정이 정본이다. 70 을 코드에 박지 않는다 */
  const settings = usePublicSettings();
  const passScore = passScoreOf(settings.data?.settings);

  const rows = useMemo(() => state.data ?? [], [state.data]);
  /**
   * 요약 카드가 가리키는 "현재" 달.
   *
   * 서버는 요청한 개월 수만큼 **실적이 없는 미래 달까지** 채워 준다
   * (예: 2026-07·08 은 전 지표가 `null`). 초판은 배열의 마지막 원소를 그대로 썼는데,
   * 그 결과 카드가 전부 `—` 로 뜨면서 **바로 아래 표에는 값이 찍히는 자기모순**이 났다
   * (QA-C DEF-C-01). 실적이 하나라도 있는 **가장 최근 달**을 고른다.
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
        <PageHeader title="품질 KPI" subtitle="월별 평균 품질점수·합격률·클레임 발생률" />
        <ScreenError message={state.error} onRetry={state.refetch} />
      </PageShell>
    );
  }

  const empty = !state.loading && rows.length === 0;

  return (
    <PageShell>
      <PageHeader
        title="품질 KPI"
        subtitle="월별 평균 품질점수·합격률·클레임 발생률"
        actions={
          <Field label="기간" htmlFor="kq-months" width={160}>
            <Select
              id="kq-months"
              value={String(months)}
              onChange={(v) => setMonths(Number(v))}
              options={MONTH_OPTIONS}
              width={160}
            />
          </Field>
        }
      />

      {/* 임계값이 서버 값이 아니면 숨기지 않는다 */}
      <SettingsFallbackBanner settings={settings.data} />

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
            {latest && latest.target[m] !== null && (
              <span style={{ fontSize: 11.5, color: T.textMuted }}>
                목표 {num(latest.target[m], KPI_DECIMALS[m])}
                {KPI_UNITS[m]}
                {latest.achieved[m] !== null && (
                  <strong
                    style={{ marginLeft: 6, color: latest.achieved[m] ? T.success : T.error }}
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

      <Section title="목표 대비 달성">
        {state.loading && <Center>불러오는 중…</Center>}
        {empty && <Center>해당 기간에 품질 실적이 없습니다.</Center>}
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

      <Section title="월별 트렌드">
        {state.loading && <Center height={240}>불러오는 중…</Center>}
        {empty && <Center height={240}>해당 기간에 품질 실적이 없습니다.</Center>}
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
                  /* 품질점수에만 합격 기준선을 그린다 — 값은 서버 설정에서 온다 */
                  references={
                    m === "quality_avg"
                      ? [{ value: passScore, label: `합격선 ${passScore}점` }]
                      : undefined
                  }
                  ariaLabel={`${KPI_LABELS[m]} 월별 트렌드`}
                />
              </div>
            ))}
          </div>
        )}
      </Section>

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
                    해당 기간에 품질 실적이 없습니다.
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
          ⓘ 클레임 발생률의 분모(출하 건수 / LOT 수)가 계약에 정의돼 있지 않습니다. 서버가 준
          값을 그대로 표시하며 화면에서 다시 계산하지 않습니다. 합격 기준선은 서버 설정
          (`quality_pass_score`)에서 읽은 값입니다. 불량률은 이 화면 소관이 아니며 생산 KPI 에
          있습니다.
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
