"use client";

/**
 * FE-RT-03 — 품질 현황 대시보드 · `/dashboard/quality` · FR-D-02
 *
 * 명세: `specs/plan-g1.md` FE-RT-03. **SF-TD3 에 와이어프레임이 없어서**
 * 구성은 FR-D-02 본문 3요소 + `GET /dashboard/quality` 응답 4필드를 1:1로 매핑했다.
 *
 * 라운드 2 에서 고친 것:
 *   - 하드코딩 mock 전량 삭제 (`PARETO_DATA` 7줄 · `QUALITY_DATA` 9줄 · `TREND_DATA` 14줄 ·
 *     `SPARKLINE_*` 4종). 그중 30일/90일 트렌드는 **`Math.random()` 으로 매 렌더 생성**돼
 *     QA 가 재현할 수 없는 화면이었다 → 즉시 제거
 *   - 불량 유형별 파레토 · 제품별 품질 현황 · 공정/출하 불량 KPI 제거 (DB 컬럼·엔드포인트 없음)
 *   - 등급 S/A/B/C 제거 (근거 없음)
 *   - 🚨 판정 배지를 **서버 `passed`** 로 그린다. `getQualityBadgeVariant()` 는 `{90,75,60}`
 *     기준이라 69.9(불합격)와 70.0(합격)이 같은 색이다 — 합격 판정에 쓰지 않는다
 *   - 히트맵 임계값을 `/settings/public` 의 `deviation_warn` 에서 읽는다.
 *     TSX 에 `2.0`/`0.3`/`0.1` 리터럴이 없다
 */

import { useMemo, useState } from "react";
import { useDashboardQuality, usePublicSettings } from "@/hooks/useKoryoData";
import { DEVIATION_WARN, type QualityDto, type SupplierCode } from "@/types/api";
import { passBadgeFromServer, passScoreOf } from "@/lib/quality";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { PillFilter } from "@/components/ui/PillFilter";
import { T } from "@/components/ui/tokens";
import {
  CenterBox,
  DASH,
  PageHeader,
  PageShell,
  ScreenError,
  SettingsFallbackBanner,
  dateTime,
  int,
  num,
} from "../../_g1/ui";

type Period = "7" | "30" | "90";

/** 기간 옵션 — `?days=` 허용값 3종 (plan-g1 §6) */
const PERIODS: { value: Period; label: string }[] = [
  { value: "7", label: "7일" },
  { value: "30", label: "30일" },
  { value: "90", label: "90일" },
];

type Comp = "sn" | "ag" | "cu";

/** 히트맵 열 정의. 소수자리는 SF-TD3 §3.4 표기 관례를 따른다 */
const HEATMAP_COLS: { key: Comp; label: string; digits: number }[] = [
  { key: "sn", label: "Sn 편차", digits: 2 },
  { key: "ag", label: "Ag 편차", digits: 2 },
  { key: "cu", label: "Cu 편차", digits: 3 },
];

// ── 히스토그램 ────────────────────────────────────────────────────────────────
//
// 캔버스 차트를 쓰지 않는 이유: **합격선 기준선을 정확한 x 위치에 그려야 한다.**
// `TrendChart` 의 `references` 는 가로 기준선(y값)만 지원한다. 세로 경계선은
// 버킷 경계에서 픽셀 단위로 맞아야 하므로 CSS 로 직접 배치한다.

/** `"~60"` · `"60-70"` · `"90-100"` 같은 라벨에서 [하한, 상한] 을 뽑는다 */
function parseRange(label: string): { lo: number | null; hi: number | null } {
  const nums = label.match(/\d+(?:\.\d+)?/g)?.map(Number) ?? [];
  if (label.trim().startsWith("~")) return { lo: null, hi: nums[0] ?? null };
  if (label.trim().endsWith("~")) return { lo: nums[0] ?? null, hi: null };
  if (nums.length >= 2) return { lo: nums[0], hi: nums[1] };
  return { lo: nums[0] ?? null, hi: nums[0] ?? null };
}

/**
 * 합격선이 히스토그램 가로축의 어디에 오는지 0~1 비율로 돌려준다.
 * 버킷 경계에 정확히 걸리면 그 경계에, 버킷 안쪽이면 선형 보간한다.
 * 축 밖이면 `null` — 선을 그리지 않는다 (없는 위치에 그리지 않는다).
 */
function passLineFraction(ranges: string[], passScore: number): number | null {
  if (ranges.length === 0) return null;
  const n = ranges.length;
  for (let i = 0; i < n; i++) {
    const { lo, hi } = parseRange(ranges[i]);
    if (lo !== null && passScore === lo) return i / n;
    if (lo !== null && hi !== null && passScore > lo && passScore < hi) {
      return (i + (passScore - lo) / (hi - lo)) / n;
    }
    if (lo === null && hi !== null && passScore < hi) {
      // 첫 버킷은 하한이 열려 있다 — 정확한 보간이 불가능하므로 버킷 끝에 붙인다
      return (i + 1) / n;
    }
  }
  return null;
}

function ScoreHistogram({
  data,
  passScore,
}: {
  data: { range: string; count: number }[];
  passScore: number;
}) {
  const max = Math.max(1, ...data.map((d) => d.count));
  const linePos = passLineFraction(data.map((d) => d.range), passScore);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ position: "relative", height: 220, display: "flex", alignItems: "flex-end", gap: 10 }}>
        {/* 합격 기준선 — 값은 `/settings/public` 에서 온다 */}
        {linePos !== null && (
          <div
            style={{
              position: "absolute",
              left: `${linePos * 100}%`,
              top: 0,
              bottom: 0,
              width: 0,
              borderLeft: `2px dashed ${T.error}`,
              pointerEvents: "none",
              zIndex: 1,
            }}
          >
            <span
              style={{
                position: "absolute",
                top: 0,
                left: 6,
                fontSize: 10.5,
                fontWeight: 700,
                color: T.error,
                whiteSpace: "nowrap",
              }}
            >
              합격 기준 {passScore}점
            </span>
          </div>
        )}

        {data.map((d) => {
          const { lo } = parseRange(d.range);
          // 합격선 미만 구간은 Error 계열, 이상은 Primary 계열
          const below = lo === null || lo < passScore;
          return (
            <div
              key={d.range}
              style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4, height: "100%", justifyContent: "flex-end" }}
            >
              <span style={{ fontSize: 11, fontWeight: 700, color: T.textSub, fontVariantNumeric: "tabular-nums" }}>
                {int(d.count)}
              </span>
              <div
                style={{
                  width: "100%",
                  height: `${(d.count / max) * 170}px`,
                  minHeight: d.count > 0 ? 2 : 0,
                  borderRadius: "4px 4px 0 0",
                  background: below ? T.error : T.primary,
                  opacity: below ? 0.75 : 1,
                }}
              />
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 10 }}>
        {data.map((d) => (
          <span
            key={d.range}
            style={{ flex: 1, textAlign: "center", fontSize: 11, color: T.textMuted }}
          >
            {d.range}
          </span>
        ))}
      </div>
    </div>
  );
}

// ── 히트맵 ────────────────────────────────────────────────────────────────────

/** 3단계 tint. 임계값은 인자로 받는다 — 이 파일에 숫자를 두지 않는다 */
function tintOf(absDev: number, threshold: number): { bg: string; color: string } {
  if (absDev > threshold) return { bg: "#FEF1F2", color: "#B91C1C" };
  if (absDev > threshold * 0.5) return { bg: "#FEF6E7", color: "#B45309" };
  return { bg: "#ECFDF3", color: "#15803D" };
}

function DeviationHeatmap({
  rows,
  warn,
}: {
  rows: { supplier: SupplierCode; sn: number; ag: number; cu: number }[];
  warn: { sn: number; ag: number; cu: number };
}) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 4, fontSize: 12.5 }}>
        <thead>
          <tr>
            <th style={{ fontSize: 11.5, fontWeight: 600, color: T.textSub, textAlign: "left", padding: "4px 8px" }}>
              공급사
            </th>
            {HEATMAP_COLS.map((c) => (
              <th
                key={c.key}
                title={`경고 임계 ±${warn[c.key]}%`}
                style={{ fontSize: 11.5, fontWeight: 600, color: T.textSub, textAlign: "center", padding: "4px 8px" }}
              >
                {c.label}
                <span style={{ display: "block", fontSize: 10, fontWeight: 500, color: T.textMuted }}>
                  임계 ±{warn[c.key]}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.supplier}>
              <td style={{ fontSize: 12.5, fontWeight: 600, color: T.text, padding: "8px" }}>
                {r.supplier}
              </td>
              {HEATMAP_COLS.map((c) => {
                const v = r[c.key];
                const t = tintOf(Math.abs(v), warn[c.key]);
                return (
                  <td
                    key={c.key}
                    style={{
                      textAlign: "center",
                      padding: "10px 8px",
                      borderRadius: 6,
                      background: t.bg,
                      color: t.color,
                      fontWeight: 700,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {num(v, c.digits)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── 요약 카드 ─────────────────────────────────────────────────────────────────

function SummaryCard({ label, value, unit, color }: { label: string; value: string; unit?: string; color: string }) {
  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", gap: 10, borderTop: `3px solid ${color}` }}>
      <span
        style={{ fontSize: 11.5, fontWeight: 600, color: T.textSub, letterSpacing: "0.03em", textTransform: "uppercase" }}
      >
        {label}
      </span>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 4 }}>
        <span
          style={{ fontSize: 26, fontWeight: 800, color, lineHeight: 1, fontVariantNumeric: "tabular-nums", letterSpacing: "-0.02em" }}
        >
          {value}
        </span>
        {unit && <span style={{ fontSize: 13, fontWeight: 500, color: T.textMuted, marginBottom: 2 }}>{unit}</span>}
      </div>
    </div>
  );
}

// ── 페이지 ────────────────────────────────────────────────────────────────────

export default function QualityDashboardPage() {
  const [period, setPeriod] = useState<Period>("30");
  const { data, loading, error, refetch } = useDashboardQuality(Number(period));
  const settings = usePublicSettings();

  const passScore = passScoreOf(settings.data?.settings);
  // 임계값의 정본은 서버다. 상수는 `/settings/public` 이 아직 안 왔을 때의 폴백일 뿐이고,
  // 폴백이 쓰이면 `SettingsFallbackBanner` 가 그 사실을 화면에 드러낸다.
  const warn = settings.data?.settings.deviation_warn ?? DEVIATION_WARN;

  const passRate = useMemo(() => {
    if (!data) return null;
    const { pass, warning, fail } = data.pass_fail;
    const denom = pass + warning + fail;
    return denom === 0 ? null : (pass / denom) * 100;
  }, [data]);

  const columns: Column<QualityDto>[] = useMemo(
    () => [
      { key: "lot_id", header: "LOT ID", width: 140 },
      {
        key: "tested_at",
        header: "검사일시",
        width: 140,
        render: (_v, row) => dateTime(row.tested_at),
      },
      {
        key: "score",
        header: "품질 점수",
        width: 90,
        align: "right",
        render: (_v, row) => num(row.score, 1),
      },
      {
        key: "passed",
        header: "판정",
        width: 80,
        // 🚨 서버 판정값 그대로. 69.9 와 70.0 이 다른 배지로 그려진다
        render: (_v, row) => {
          const b = passBadgeFromServer(row.passed);
          return <StatusBadge variant={b.variant} label={b.label} dot />;
        },
      },
      { key: "model_used", header: "사용 모델", width: 140 },
      {
        key: "predicted_score",
        header: "예측 점수",
        width: 90,
        align: "right",
        render: (_v, row) => num(row.predicted_score, 1),
      },
      {
        key: "error",
        header: "예측 오차",
        width: 90,
        align: "right",
        render: (_v, row) =>
          row.predicted_score === null ? DASH : num(row.score - row.predicted_score, 1),
      },
    ],
    [],
  );

  const periodTabs = (
    <PillFilter
      options={PERIODS}
      value={period}
      onChange={(v) => setPeriod(v)}
      ariaLabel="조회 기간"
      size="md"
    />
  );

  if (error) return <ScreenError message={error} onRetry={refetch} />;

  return (
    <PageShell>
      <PageHeader
        title="품질 현황 대시보드"
        subtitle="LOT별 품질 점수 분포 · 합격/불합격 비율 · 성분 편차 히트맵 (FR-D-02)"
        actions={periodTabs}
      />

      <SettingsFallbackBanner settings={settings.data} />

      {/* 기간 전환 중에는 **이전 기간 데이터를 남기지 않는다** (plan-g1 §9) */}
      {loading || !data ? (
        <CenterBox minHeight={420}>
          <span style={{ fontSize: 13, color: T.textMuted }}>불러오는 중…</span>
        </CenterBox>
      ) : (
        <>
          {/* ── 요약 3카드 + 합격률 ────────────────────────────────────────── */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
            <SummaryCard label="합격" value={int(data.pass_fail.pass)} unit="건" color="#22C55E" />
            <SummaryCard label="경고" value={int(data.pass_fail.warning)} unit="건" color="#F59E0B" />
            <SummaryCard label="불합격" value={int(data.pass_fail.fail)} unit="건" color="#EF4444" />
            {/* 분모가 0 이면 `—` — `0.0%` 로 채우지 않는다 */}
            <SummaryCard label="합격률" value={num(passRate, 1)} unit={passRate === null ? undefined : "%"} color="#3A5BD9" />
          </div>

          {/* ── 차트 A · B ──────────────────────────────────────────────── */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, alignItems: "start" }}>
            <section className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <h2 style={{ fontSize: 16, fontWeight: 600, color: T.text, margin: 0 }}>품질 점수 분포</h2>
              {data.score_distribution.length === 0 ||
              data.score_distribution.every((d) => d.count === 0) ? (
                <CenterBox minHeight={240}>
                  <span style={{ fontSize: 13, color: T.textMuted }}>
                    해당 기간 품질 데이터가 없습니다
                  </span>
                </CenterBox>
              ) : (
                <ScoreHistogram data={data.score_distribution} passScore={passScore} />
              )}
            </section>

            <section className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <h2 style={{ fontSize: 16, fontWeight: 600, color: T.text, margin: 0 }}>
                성분 편차 히트맵
              </h2>
              {data.deviation_heatmap.length === 0 ? (
                <CenterBox minHeight={240}>
                  <span style={{ fontSize: 13, color: T.textMuted }}>
                    성분 편차 데이터가 없습니다
                  </span>
                </CenterBox>
              ) : (
                <DeviationHeatmap rows={data.deviation_heatmap} warn={warn} />
              )}
            </section>
          </div>

          {/* ── 최근 품질 검사 결과 ─────────────────────────────────────── */}
          <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <h2 style={{ fontSize: 16, fontWeight: 600, color: T.text, margin: 0 }}>
              최근 품질 검사 결과
            </h2>
            <DataTable
              columns={columns}
              data={data.recent}
              rowKey={(row) => row.id}
              emptyText="해당 기간 품질 검사 결과가 없습니다"
            />
          </section>
        </>
      )}
    </PageShell>
  );
}
