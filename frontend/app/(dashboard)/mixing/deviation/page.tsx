"use client";

/**
 * FE-RT-12 — 성분 편차 분석 · `/mixing/deviation` · FR-M-02
 *
 * 명세: `specs/plan-g1.md` FE-RT-12 · 와이어프레임 **SF-TD3 §3.4** (그대로 따른다) ·
 * 계약 `api-contract.md` §8.4 · §8.4.3.
 *
 * 라운드 2 에서 고친 것:
 *   - 🚨 **경고 임계의 차원 오류.** 현 구현은 `WARN_PCT = 5` / `CAUTION_PCT = 3` 을
 *     **목표값 대비 상대 %** 로 계산했다. 계약 정본은 **절대 편차**다.
 *     상대 5% 는 Ag 에서 `±0.15`(계약 `0.3` 의 절반), Cu 에서 `±0.025`(계약 `0.1` 의 1/4)라
 *     **화면은 정상으로 보이면서 경고 판정만 조용히 틀렸다.** 두 상수를 전부 삭제하고
 *     응답의 `warn_threshold` 를 쓴다 — TSX 에 임계값 숫자가 없다.
 *   - 🚨 **공급사별 편차 비교표 + 권장 공급사 신규 구현.** SF-TD3 §3.4 의 핵심 요소인데
 *     통째로 빠져 있었다 (와이어프레임 대비 결손이 가장 컸다).
 *   - 차트 1개(SN/AG/CU 중첩, **CU 를 ×10 배율**로 왜곡) → **성분별 독립 차트 3개**.
 *     임의 배율은 데이터 왜곡이다 — 성분별 Y축 분리로 해결한다.
 *   - `MOCK_LOTS`(15행) · `TREND_DATA`(3×30) · `STAT_CARDS` · 로컬 캔버스 차트 제거
 *   - LOT별 편차 상세 표 제거 — SF-TD3·계약 어디에도 없다. LOT별 성분은 **FE-RT-08** 소관이다
 *   - **공급사 필터 제거** — `ISS-002` 는 v1.1 범위 밖이고 §8.4.3 이 `?supplier=` 를 금지한다
 *   - 기간 기본값 30일 → **90일** (SF-TD3 §3.4 제목이 "(최근 90일)")
 *   - 프론트 `value - target` 뺄셈 제거 → 서버 `points[].deviation`
 *   - 로컬 `SN_TARGET`/`AG_TARGET`/`CU_TARGET` 재정의 제거 → 응답 `target`
 */

import { useMemo, useState } from "react";
import { TrendChart } from "@/components/charts/TrendChart";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { T } from "@/components/ui/tokens";
import {
  useDeviationBySupplier,
  useDeviationTimeseries,
  usePublicSettings,
} from "@/hooks/useKoryoData";
import type { DeviationComponent } from "@/lib/koryo-api";
import type { DeviationTimeseriesDto } from "@/types/api";
import type { HookState } from "@/hooks/useKoryoData";
import {
  DASH,
  Field,
  FilterBar,
  PageHeader,
  PageShell,
  Section,
  SectionState,
  Select,
  SettingsFallbackBanner,
  num,
} from "../../_g1/ui";

/**
 * 기간 옵션. SF-TD3 §3.4 제목이 "(최근 90일)" 이고 계약도 `?days=90` 이라 **90 이 정본**이다.
 * 30 은 화면에서 좁혀 보기 위한 보조 선택지다 (판단).
 */
const PERIOD_OPTIONS = [
  { value: "30", label: "최근 30일" },
  { value: "90", label: "최근 90일" },
];

/** 성분별 표시 소수자리 — SF-TD3 §3.4 표기를 따랐다 */
const CHART_DIGITS: Record<DeviationComponent, number> = { sn: 2, ag: 3, cu: 3 };
/** 비교표 셀 소수자리 — SF-TD3 §3.4 의 `±0.8%` / `±0.12%` / `±0.03%` */
const TABLE_DIGITS: Record<DeviationComponent, number> = { sn: 1, ag: 2, cu: 2 };

const COMPONENT_LABEL: Record<DeviationComponent, string> = { sn: "Sn", ag: "Ag", cu: "Cu" };

const COMPONENTS: DeviationComponent[] = ["sn", "ag", "cu"];

// ══════════════════════════════════════════════════════════════════════════════
// 편차 추이 차트 — Y축은 `deviation` 이다 (실측값이 아니다)
// ══════════════════════════════════════════════════════════════════════════════

function DeviationChart({
  component,
  state,
  height,
}: {
  component: DeviationComponent;
  state: HookState<DeviationTimeseriesDto>;
  height: number;
}) {
  const { data, loading, error, refetch } = state;
  const digits = CHART_DIGITS[component];
  const label = COMPONENT_LABEL[component];

  const view = useMemo(() => {
    if (!data) return null;
    const warn = data.warn_threshold;
    return {
      categories: data.points.map((p) => p.date),
      values: data.points.map((p) => p.deviation),
      // 임계 초과 점만 Error 색 마커로 강조한다. 임계값은 응답에서 왔다.
      pointColors: data.points.map((p) =>
        Math.abs(p.deviation) > warn ? ("error" as const) : undefined
      ),
      warn,
      target: data.target,
      empty: data.points.length === 0,
    };
  }, [data]);

  return (
    <Section
      title={
        <h2 style={{ fontSize: 15, fontWeight: 600, color: T.text, margin: 0 }}>
          {label} 편차 추이{" "}
          <span style={{ fontSize: 12.5, fontWeight: 500, color: T.textSub }}>
            (목표: {view ? num(view.target, 1) : DASH}%)
          </span>
        </h2>
      }
      right={
        view && (
          <span style={{ fontSize: 11.5, color: T.textMuted }}>
            경고 임계 ±{num(view.warn, digits)}%
          </span>
        )
      }
    >
      <SectionState
        loading={loading}
        error={error}
        empty={view?.empty ?? false}
        emptyText="해당 기간 편차 데이터가 없습니다"
        onRetry={refetch}
        minHeight={height}
      >
        {view && (
          <TrendChart
            categories={view.categories}
            series={[
              {
                name: `${label} 편차`,
                values: view.values,
                color: "primary",
                area: false,
                pointColors: view.pointColors,
              },
            ]}
            height={height}
            dots="auto"
            // 0% 기준선 + ±warn_threshold 점선 2개 — 값은 전부 응답에서 온다
            references={[
              { value: 0, label: "기준선 0%", color: "textSub" },
              { value: view.warn, label: `+${num(view.warn, digits)}%`, color: "error" },
              { value: -view.warn, label: `-${num(view.warn, digits)}%`, color: "error" },
            ]}
            formatY={(v) => v.toFixed(digits)}
            formatX={(d) => d.slice(5)}
            ariaLabel={`${label} 편차 추이`}
          />
        )}
      </SectionState>
    </Section>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// 페이지
// ══════════════════════════════════════════════════════════════════════════════

export default function DeviationPage() {
  const settings = usePublicSettings();
  const [days, setDays] = useState(90);

  // 네 요청은 서로 독립적인 훅이라 **병렬로 나간다.** 순차 await 로 묶지 않는다 (NFR-P-01).
  const sn = useDeviationTimeseries("sn", days);
  const ag = useDeviationTimeseries("ag", days);
  const cu = useDeviationTimeseries("cu", days);
  const bySupplier = useDeviationBySupplier(days);

  const seriesState: Record<DeviationComponent, HookState<DeviationTimeseriesDto>> = {
    sn,
    ag,
    cu,
  };

  /** `기준:` 표시는 세 응답의 `target` 에서 온다 — 화면에 62.0/3.0/0.5 를 쓰지 않는다 */
  const targets = COMPONENTS.map((c) => ({
    label: COMPONENT_LABEL[c],
    target: seriesState[c].data?.target,
  }));

  const suppliers = bySupplier.data?.suppliers ?? [];
  const recommended = bySupplier.data?.recommended ?? null;
  const basis = bySupplier.data?.basis ?? "";

  return (
    <PageShell>
      <PageHeader
        title={`성분 편차 분석 (최근 ${days}일)`}
        subtitle="공급사별 Sn/Ag/Cu 편차 시계열 분석 — 목표값 대비 편차 시각화 (FR-M-02)"
      />

      <SettingsFallbackBanner settings={settings.data} />

      <FilterBar>
        <Field label="기간" htmlFor="f-days" width={150}>
          <Select
            id="f-days"
            value={String(days)}
            onChange={(v) => setDays(Number(v))}
            options={PERIOD_OPTIONS}
            width={150}
          />
        </Field>
        <span style={{ marginLeft: "auto", fontSize: 11.5, color: T.textMuted, alignSelf: "center" }}>
          기준:{" "}
          {targets.map(({ label, target }, i) => (
            <span key={label}>
              {i > 0 ? " / " : ""}
              {label} {num(target, 1)}%
            </span>
          ))}
        </span>
      </FilterBar>

      {/* Sn — 대형 차트 (SF-TD3 §3.4 전폭) */}
      <DeviationChart component="sn" state={sn} height={260} />

      {/* Ag · Cu — 소형 차트 2열 (SF-TD3 §3.4 "(소형 차트)") */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        <DeviationChart component="ag" state={ag} height={180} />
        <DeviationChart component="cu" state={cu} height={180} />
      </div>

      {/* 공급사별 성분 편차 비교 — SF-TD3 §3.4 는 행=성분, 열=공급사 방향이다 */}
      <Section
        title="공급사별 성분 편차 비교"
        right={
          <span style={{ fontSize: 11.5, color: T.textMuted }}>
            값은 <strong style={{ color: T.textSub }}>표준편차(σ)</strong> · ← 편차 작을수록 우수
          </span>
        }
      >
        <SectionState
          loading={bySupplier.loading}
          error={bySupplier.error}
          empty={suppliers.length === 0}
          emptyText="공급사 편차 데이터가 없습니다"
          onRetry={bySupplier.refetch}
          minHeight={180}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ overflowX: "auto" }}>
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: 13,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                <caption
                  style={{
                    captionSide: "bottom",
                    textAlign: "left",
                    fontSize: 11,
                    color: T.textMuted,
                    paddingTop: 8,
                  }}
                >
                  각 셀은 최근 {days}일 성분 표준편차(σ)다. 권장 공급사는 서버가 σ 합이 최소인
                  곳으로 계산한다 (api-contract §8.4.3).
                </caption>
                <thead>
                  <tr style={{ background: T.surfaceSubtle }}>
                    <th
                      scope="col"
                      style={{
                        padding: "10px 14px",
                        textAlign: "left",
                        fontSize: 11.5,
                        fontWeight: 600,
                        color: T.textSub,
                        borderBottom: `1px solid ${T.border}`,
                        width: 90,
                      }}
                    >
                      성분
                    </th>
                    {/* 응답은 공급사가 행이지만 SF-TD3 는 공급사가 열이다 → 전치해서 그린다 */}
                    {suppliers.map((s) => {
                      const isRec = s.code === recommended;
                      return (
                        <th
                          key={s.code}
                          scope="col"
                          style={{
                            padding: "10px 14px",
                            textAlign: "right",
                            fontSize: 11.5,
                            fontWeight: 700,
                            color: isRec ? "#15803D" : T.textSub,
                            background: isRec ? "#ECFDF3" : undefined,
                            borderBottom: `1px solid ${T.border}`,
                          }}
                        >
                          {s.code}
                          {isRec && (
                            <span style={{ fontSize: 10, fontWeight: 600, marginLeft: 4 }}>권장</span>
                          )}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {COMPONENTS.map((c, ri) => (
                    <tr
                      key={c}
                      style={{
                        borderBottom:
                          ri < COMPONENTS.length - 1 ? `1px solid ${T.border}` : "none",
                      }}
                    >
                      <th
                        scope="row"
                        style={{
                          padding: "10px 14px",
                          textAlign: "left",
                          fontWeight: 700,
                          color: T.text,
                          fontSize: 13,
                        }}
                      >
                        {COMPONENT_LABEL[c]}
                      </th>
                      {suppliers.map((s) => {
                        const isRec = s.code === recommended;
                        // `±` 는 산포(표준편차)를 뜻한다 — 부호를 붙이지 않는다
                        return (
                          <td
                            key={s.code}
                            style={{
                              padding: "10px 14px",
                              textAlign: "right",
                              color: T.text,
                              background: isRec ? "#ECFDF3" : undefined,
                              fontWeight: isRec ? 600 : 400,
                            }}
                          >
                            ±{num(Math.abs(s[c]), TABLE_DIGITS[c])}%
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* 권장 공급사 — `recommended`/`basis` 둘 다 서버 계산값이다 */}
            {recommended ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: T.text }}>권장:</span>
                <StatusBadge variant="green" label={recommended} dot />
                <span style={{ fontSize: 12.5, color: T.textSub }}>{basis}</span>
              </div>
            ) : (
              <span style={{ fontSize: 12.5, color: T.textMuted }}>
                권장 공급사를 판정할 데이터가 부족합니다
              </span>
            )}
          </div>
        </SectionState>
      </Section>
    </PageShell>
  );
}
