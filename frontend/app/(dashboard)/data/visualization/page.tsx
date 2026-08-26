"use client";

/**
 * FE-RT-35 — 시각화 · `/data/visualization` · FR-DT-03 (필수)
 *
 * 명세: `specs/plan-g3.md` FE-RT-35. 와이어프레임 없음(SF-TD3 §3).
 * 저장 테이블: `lots`/`components`/`quality`. **501 아님.**
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * SF-AD2 §1.8 인용: *"성분 트렌드, 품질 분포, 공급사 비교 등 인터랙티브 차트"*.
 * **이 3종이 계약의 `chart=trend|distribution|supplier` 와 1:1 대응한다** (§2).
 *
 * 라운드 2 에서 지운 것:
 *   - 🔴 `DATA` 를 **난수 생성기로 매 렌더 생성**하던 것 —
 *     **새로고침할 때마다 숫자가 바뀌었다.** 난수 호출이 이 파일에서 사라졌다
 *   - X축 4종 × Y축 6종 = **24조합 자유 축 빌더** (`dim × metric` 조회 엔드포인트가
 *     계약에 없다) → 계약이 정의한 3차트로 축소
 *   - `efficiency`·`output`·`shift`·`product` 지표 — **`lots`/`components`/`quality` 에
 *     공정효율·생산량·교대조 컬럼이 없다** (db-schema §3)
 *   - `SUP_D` — 실제 공급사는 `SUP_A/B/C` 3사다 (db-schema §4.2)
 *   - 사전 정의 템플릿 5개 (계약 누락)
 *   - `PNG 저장` 버튼 (`onClick` 도 없었고 서버 이미지 생성 엔드포인트도 없다)
 *   - 페이지 내부 canvas 중복 구현(`DynamicChart`) → 공용 `TrendChart`/`ScatterChart`
 *
 * 연결한 것: **`GET /api/v1/eda-stats`** — 기존에 구현돼 있는 API 인데
 * 이 화면에 연결돼 있지 않았다 (§11 #7). **메인 차트와 독립적으로 실패 처리**한다.
 *
 * ⚠ `points[].y` 가 `null` 인 구간은 **`NaN` 으로 넘겨 선을 끊는다. 0 으로 찍지 않는다**
 *   (api-contract §4.1 · `DEF-IT-002`). `TrendChart` 가 비유한값을 건너뛴다.
 * ══════════════════════════════════════════════════════════════════════════════
 */

import { useMemo, useState } from "react";
import { getDataVisualization, getEdaStatsV1 } from "@/lib/koryo-api";
import type { VisualizationChart } from "@/types/api";
import { TrendChart } from "@/components/charts/TrendChart";
import { ScatterChart } from "@/components/charts/ScatterChart";
import { T } from "@/components/ui/tokens";
import {
  Field,
  FilterBar,
  InlineError,
  PageHeader,
  PageShell,
  Section,
  Select,
  num,
} from "../../_g1/ui";
import { Chips, useApi } from "../../_g3/ui";

const CHARTS: { value: VisualizationChart; label: string }[] = [
  { value: "trend", label: "성분 트렌드" },
  { value: "distribution", label: "품질 분포" },
  { value: "supplier", label: "공급사 비교" },
];

/** `days` 상한이 계약에 없다 — 프론트 선택지를 365 로 제한한다 (**판단값**, §4) */
const DAY_OPTIONS = [
  { value: "30", label: "최근 30일" },
  { value: "90", label: "최근 90일" },
  { value: "180", label: "최근 180일" },
  { value: "365", label: "최근 365일" },
];

interface Summary {
  avg: number | null;
  max: number | null;
  min: number | null;
  count: number;
}

/** 요약 통계는 **클라이언트 집계**다 — 계약에 요약 통계 필드가 없다 (§7) */
function summarize(values: number[]): Summary {
  const finite = values.filter(Number.isFinite);
  if (finite.length === 0) return { avg: null, max: null, min: null, count: values.length };
  return {
    avg: finite.reduce((a, b) => a + b, 0) / finite.length,
    max: Math.max(...finite),
    min: Math.min(...finite),
    count: values.length,
  };
}

export default function DataVisualizationPage() {
  const [chart, setChart] = useState<VisualizationChart>("trend");
  const [days, setDays] = useState(90);

  /** 🔴 탭 전환마다 **서버 요청이 발생**한다. 클라이언트 재집계가 아니다 (수용 기준 1) */
  const viz = useApi(() => getDataVisualization(chart, days), [chart, days]);

  /** EDA 패널은 최초 1회. **메인 차트와 독립적으로 실패한다** (§5) */
  const eda = useApi(() => getEdaStatsV1(), []);

  const series = useMemo(() => viz.data?.series ?? [], [viz.data]);

  /** 카테고리는 첫 시리즈의 x 를 쓴다 (계약이 시리즈별 x 정렬을 보장한다) */
  const categories = useMemo(
    () => (series[0]?.points ?? []).map((p) => String(p.x)),
    [series]
  );

  const chartSeries = useMemo(
    () =>
      series.map((s) => ({
        name: s.name,
        // `null` → `NaN` : 선을 끊는다. **0 으로 채우지 않는다**
        values: s.points.map((p) =>
          p.y === null || p.y === undefined || !Number.isFinite(p.y) ? NaN : p.y
        ),
      })),
    [series]
  );

  /**
   * 요약은 **계열마다 따로** 낸다.
   *
   * 초판은 `chartSeries.flatMap(s => s.values)` 로 전 계열을 한 통에 섞었다.
   * 공급사 비교처럼 평균 품질(점)과 LOT 수(건)가 함께 오는 차트에서는
   * 단위가 다른 값의 평균·최대·최소라 **의미가 없는 숫자**가 나왔다 (QA-C DEF-C-05).
   */
  const summaries = useMemo(
    () => chartSeries.map((s) => ({ name: s.name, ...summarize(s.values) })),
    [chartSeries]
  );

  const isEmpty = !viz.loading && !viz.error && series.length === 0;

  return (
    <PageShell>
      <PageHeader title="데이터 시각화" subtitle="성분 트렌드 · 품질 분포 · 공급사 비교" />

      <FilterBar>
        <Chips
          value={chart}
          onChange={(v) => setChart(v as VisualizationChart)}
          options={CHARTS}
        />
        <div style={{ flex: 1 }} />
        <Field label="기간" htmlFor="viz-days" width={150}>
          <Select
            id="viz-days"
            value={String(days)}
            onChange={(v) => setDays(Number(v))}
            options={DAY_OPTIONS}
          />
        </Field>
      </FilterBar>

      <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: 12, alignItems: "start" }}>
        <Section title="요약 통계">
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {viz.loading || viz.error || summaries.length === 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <Stat label="평균" value="—" />
                <Stat label="최대" value="—" />
                <Stat label="최소" value="—" />
                <Stat label="데이터 포인트" value="—" />
              </div>
            ) : (
              summaries.map((sm) => (
                <div key={sm.name} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {summaries.length > 1 && (
                    <div style={{ fontSize: 11.5, fontWeight: 600, color: T.textSub }}>{sm.name}</div>
                  )}
                  <Stat label="평균" value={num(sm.avg, 2)} />
                  <Stat label="최대" value={num(sm.max, 2)} />
                  <Stat label="최소" value={num(sm.min, 2)} />
                  <Stat label="데이터 포인트" value={String(sm.count)} />
                </div>
              ))
            )}
          </div>
          <span style={{ fontSize: 11, color: T.textMuted, lineHeight: 1.6 }}>
            요약 통계는 응답 데이터로 화면에서 계산한 값입니다 (계약에 집계 필드가 없습니다).
          </span>
        </Section>

        <Section title={CHARTS.find((c) => c.value === chart)?.label ?? "차트"}>
          {viz.loading && <Center height={280}>불러오는 중…</Center>}
          {viz.error && <InlineError message={viz.error} onRetry={viz.refetch} />}
          {isEmpty && <Center height={280}>표시할 데이터가 없습니다.</Center>}

          {!viz.loading && !viz.error && series.length > 0 && (
            <TrendChart
              categories={categories}
              series={chartSeries}
              kind={chart === "distribution" ? "bar" : "line"}
              height={300}
              legend={chartSeries.length > 1}
              ariaLabel={`${chart} 차트`}
            />
          )}
        </Section>
      </div>

      {/* ── EDA 보조 패널 — 독립 실패 처리 ─────────────────────────────────── */}
      <Section title="EDA 통계">
        {eda.loading && <Center height={200}>불러오는 중…</Center>}
        {eda.error && <InlineError message={eda.error} onRetry={eda.refetch} />}

        {!eda.loading && !eda.error && eda.data && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
              <Stat label="전체 LOT" value={eda.data.stats.total_lots.toLocaleString()} inline />
              <Stat label="평균 품질" value={num(eda.data.stats.mean_quality, 2)} inline />
              <Stat label="품질 표준편차" value={num(eda.data.stats.std_quality, 2)} inline />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
              {(
                [
                  ["Sn 분포", eda.data.sn_distribution],
                  ["Ag 분포", eda.data.ag_distribution],
                  ["Cu 분포", eda.data.cu_distribution],
                ] as const
              ).map(([label, bins]) => (
                <div key={label}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: T.textSub }}>{label}</span>
                  <TrendChart
                    categories={bins.map((b) => b.range)}
                    series={[{ name: label, values: bins.map((b) => b.count) }]}
                    kind="bar"
                    height={160}
                    legend={false}
                    ariaLabel={label}
                  />
                </div>
              ))}
            </div>

            <div>
              <span style={{ fontSize: 12, fontWeight: 600, color: T.textSub }}>
                Sn 함량 vs 품질 점수
              </span>
              {/* `EdaStats.sn_vs_quality` 는 `{sn, quality}`, 차트는 `{x, y}` 를 받는다.
                  이름만 바꿔 넘긴다 — 값을 가공하지 않는다 */}
              <ScatterChart
                points={eda.data.sn_vs_quality.map((p) => ({ x: p.sn, y: p.quality }))}
                xLabel="Sn (%)"
                yLabel="품질 점수"
                height={280}
              />
            </div>
          </div>
        )}
      </Section>
    </PageShell>
  );
}

function Center({ children, height = 160 }: { children: React.ReactNode; height?: number }) {
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

function Stat({
  label,
  value,
  inline,
}: {
  label: string;
  value: string;
  inline?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: inline ? "column" : "row",
        alignItems: inline ? "flex-start" : "baseline",
        justifyContent: "space-between",
        gap: inline ? 2 : 8,
      }}
    >
      <span style={{ fontSize: 12, color: T.textSub }}>{label}</span>
      <strong style={{ fontSize: inline ? 20 : 15, fontWeight: 700, color: T.text }}>
        {value}
      </strong>
    </div>
  );
}
