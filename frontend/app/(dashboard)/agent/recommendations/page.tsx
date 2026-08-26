"use client";

/**
 * FE-RT-41 — 추천 이력 · `/agent/recommendations` · FR-AG-04 (**선택**)
 *
 * 명세: `specs/plan-g3.md` FE-RT-41 · 공통 전제 §G9-1·§G9-2. 와이어프레임 없음.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * 🔴 **화면 성격 자체가 달랐다.**
 *
 * 현 구현은 "경보/추천/예측/정보" 4유형 **알림함**이고 읽음 처리가 핵심이었다.
 * SF-AD2 §1.9 FR-AG-04 는 *"AI 배합 추천 이력 및 **실제 적용 결과 비교**"* 이고
 * `api-contract.md` §8.10 도 *"(추천 vs 실제 적용 비교)"* 라고 적었다.
 * → **알림함이 아니라 "추천값 vs 실적값 비교표"** 로 재설계했다.
 *
 * 라운드 2 에서 지운 것:
 *   - 하드코딩 추천 배열 10건 하드코딩 (API 호출 0건)
 *   - 근거 없는 내용: *"R²: 0.627 → 0.661"* (api-contract §7.4 가 성능 수치 인용을
 *     금지한다) · *"외부 IP 203.45.12.8 로그인 시도"* · *"삼성전자 클레임(Cu 혼입)"*
 *   - "보안 AI"·"공급망 AI"·"생산 AI" 등 **계약에 없는 Agent 종류 8개**
 *   - `markRead`/`markAllRead` — 읽음 상태 필드도 엔드포인트도 없다.
 *     **로컬 state 만 바꿔 저장되는 것처럼 보였다** (새로고침하면 초기화)
 *   - `읽지 않음` 배지
 *
 * ⚠ `AgentRecommendationOut` 의 **필드 구성이 계약에 정의돼 있지 않다.**
 *    아래 열 구성은 요구사항 문장과 `RecommendResponse`/`quality` 스키마에서
 *    **유도한 것**이며, 서버 스키마가 확정되면 교체 대상이다 (§4).
 *    v1 은 501 이라 행이 0건이므로 이 유도가 화면에 숫자를 만들어내지 않는다.
 * ══════════════════════════════════════════════════════════════════════════════
 */

import { useMemo, useState } from "react";
import { getAgentRecommendations } from "@/lib/koryo-api";
import { T } from "@/components/ui/tokens";
import { InlineError, PageHeader, PageShell, Pagination, Section, dateTime, num } from "../../_g1/ui";
import { PendingBanner, isNotImplemented, useApi } from "../../_g3/ui";

const PAGE_SIZE = 50;

/** 성분 3자리(`lots.*_ratio DECIMAL(6,3)`) · 품질 2자리(`quality.score DECIMAL(5,2)`) */
const RATIO_DIGITS = 3;
const SCORE_DIGITS = 2;

type Row = Record<string, unknown>;

function pickNum(row: Row, ...keys: string[]): number | null {
  for (const k of keys) {
    const v = row[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return null;
}

function pickStr(row: Row, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = row[k];
    if (typeof v === "string" && v !== "") return v;
  }
  return null;
}

/** 중첩 배합 객체(`recommended_ratios: {sn, ag, ...}`)와 평면 키를 모두 받아준다 */
function pickRatio(row: Row, group: string, comp: string): number | null {
  const g = row[group];
  if (g && typeof g === "object") {
    const v = (g as Record<string, unknown>)[comp];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return pickNum(row, `${group}_${comp}`, `${comp}_${group}`);
}

export default function AgentRecommendationsPage() {
  const [page, setPage] = useState(1);

  const state = useApi(
    () => getAgentRecommendations({ page, page_size: PAGE_SIZE }),
    [page]
  );

  const pending = isNotImplemented(state.status, state.error);

  const rows: Row[] = useMemo(() => state.data?.items ?? [], [state.data]);
  const total = state.data?.total ?? 0;

  return (
    <PageShell>
      <PageHeader title="추천 이력" subtitle="AI 배합 추천값과 실제 적용 결과 비교" />

      {pending && (
        <PendingBanner note="추천 이력을 저장할 테이블이 없어 조회 결과가 0건입니다. 아래 표는 열 구성만 보여줍니다." />
      )}

      {/* 501 이 아닌 실패는 오류로 그린다 — 501 과 섞으면 장애가 '준비 중' 으로 위장된다 */}
      {!pending && state.error && <InlineError message={state.error} onRetry={state.refetch} />}

      <Section
        title={`추천 이력 (${pending ? 0 : total.toLocaleString()}건)`}
        right={
          <span style={{ fontSize: 11.5, color: T.textMuted }}>
            차이 = 실제 품질 − 예측 품질
          </span>
        }
      >
        <div style={{ overflowX: "auto", border: `1px solid ${T.border}`, borderRadius: 12 }}>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: 12.5,
              fontVariantNumeric: "tabular-nums",
              minWidth: 1080,
            }}
          >
            <thead>
              <tr style={{ background: "#F8F9FB" }}>
                <Th rowSpan={2}>추천 일시</Th>
                <Th rowSpan={2}>LOT</Th>
                <Th colSpan={4} center>
                  추천 배합 (%)
                </Th>
                <Th colSpan={4} center>
                  실제 배합 (%)
                </Th>
                <Th rowSpan={2} right>
                  예측 품질
                </Th>
                <Th rowSpan={2} right>
                  실제 품질
                </Th>
                <Th rowSpan={2} right>
                  차이
                </Th>
              </tr>
              <tr style={{ background: "#F8F9FB" }}>
                {["Sn", "Ag", "Cu", "Pb"].map((c) => (
                  <Th key={`r-${c}`} right small>
                    {c}
                  </Th>
                ))}
                {["Sn", "Ag", "Cu", "Pb"].map((c) => (
                  <Th key={`a-${c}`} right small>
                    {c}
                  </Th>
                ))}
              </tr>
            </thead>
            <tbody>
              {state.loading && (
                <tr>
                  <Td colSpan={13} muted>
                    불러오는 중…
                  </Td>
                </tr>
              )}

              {!state.loading && rows.length === 0 && (
                <tr>
                  <Td colSpan={13} muted>
                    {pending
                      ? "v1 범위에서는 추천 이력을 저장·조회하지 않습니다."
                      : "표시할 이력이 없습니다."}
                  </Td>
                </tr>
              )}

              {!state.loading &&
                rows.map((row, i) => {
                  const predicted = pickNum(row, "predicted_quality", "predicted_score");
                  const actual = pickNum(row, "actual_quality", "actual_score", "score");
                  const diff =
                    predicted !== null && actual !== null ? actual - predicted : null;
                  return (
                    <tr key={i} style={{ borderTop: `1px solid ${T.border}` }}>
                      <Td>{dateTime(pickStr(row, "created_at", "recommended_at", "date"))}</Td>
                      <Td>{pickStr(row, "lot_id", "lot") ?? "—"}</Td>
                      {["sn", "ag", "cu", "pb"].map((c) => (
                        <Td key={`r-${c}`} right>
                          {num(pickRatio(row, "recommended_ratios", c), RATIO_DIGITS)}
                        </Td>
                      ))}
                      {["sn", "ag", "cu", "pb"].map((c) => (
                        <Td key={`a-${c}`} right>
                          {num(pickRatio(row, "actual_ratios", c), RATIO_DIGITS)}
                        </Td>
                      ))}
                      <Td right>{num(predicted, SCORE_DIGITS)}</Td>
                      <Td right>{num(actual, SCORE_DIGITS)}</Td>
                      <Td right>
                        {diff === null
                          ? "—"
                          : `${diff > 0 ? "+" : ""}${diff.toFixed(SCORE_DIGITS)}`}
                      </Td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>

        {!pending && (
          <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />
        )}

        <span style={{ fontSize: 11, color: T.textMuted, lineHeight: 1.6 }}>
          ⓘ `AgentRecommendationOut` 의 필드 구성이 계약에 정의돼 있지 않아, 위 열은 FR-AG-04
          문장과 `RecommendResponse`·`quality` 스키마에서 유도한 것입니다. 서버 스키마 확정 시
          교체 대상입니다.
        </span>
      </Section>
    </PageShell>
  );
}

function Th({
  children,
  colSpan,
  rowSpan,
  right,
  center,
  small,
}: {
  children: React.ReactNode;
  colSpan?: number;
  rowSpan?: number;
  right?: boolean;
  center?: boolean;
  small?: boolean;
}) {
  return (
    <th
      colSpan={colSpan}
      rowSpan={rowSpan}
      style={{
        padding: small ? "6px 10px" : "10px 12px",
        fontSize: 12,
        fontWeight: 600,
        color: T.textSub,
        textAlign: right ? "right" : center ? "center" : "left",
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
