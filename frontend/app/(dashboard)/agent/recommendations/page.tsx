"use client";

/**
 * FE-RT-41 — 추천 이력 · `/agent/recommendations` · FR-AG-04
 *
 * 명세: `specs/plan-g3.md` FE-RT-41 · 공통 전제 §G9-1·§G9-2. 와이어프레임 없음.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ── 2026-08-30: 501 을 해제했다 ───────────────────────────────────────────────
 *
 * 이 화면이 유일하게 501 로 남아 있던 이유는 UI 가 아니라 **저장소**였다.
 * 추천이 어디에도 기록되지 않아 plan-agent 가 꼽은 질문 5개 중 4개가
 * "저장소 부재" 로 답을 못 했다. `agent_recommendations`(§6.9)를 CR-DB-008 로
 * 만들고, 추천이 나오는 두 경로를 전부 적재하게 한 뒤에야 화면이 의미를 갖는다.
 *
 *   POST /recommend       FE-RT-14 배합비율 추천 화면   → source `recommend_api`
 *   POST /agents/mixing   FE-RT-15 배합 AI Agent 도구   → source `agent`
 *
 * 라운드 2 에서 지운 것(그대로 유지):
 *   - 하드코딩 추천 배열 10건 · 근거 없는 성능 수치 · 계약에 없는 Agent 8종
 *   - `markRead`/`markAllRead` — 저장되는 것처럼 보였으나 로컬 state 였다
 *
 * 🔴 **차이 열은 여기서 계산한다** (plan-agent §4). 추천 − 실제, 소수 3자리.
 *    서버가 만들면 자릿수 규약이 두 벌이 된다.
 * 🔴 **미적용 행의 실제·차이 칸은 `—` 다.** `0` 으로 채우면 "0% 투입"으로 읽힌다
 *    (수용 기준 3).
 * 🔴 **적용 LOT 은 사람이 연결한다.** 시간·배합비가 비슷한 LOT 을 자동으로
 *    짝지으면 그건 추측이고, 화면은 그 추측을 "실제 적용 결과" 로 읽는다.
 * ══════════════════════════════════════════════════════════════════════════════
 */

import { useMemo, useState } from "react";
import {
  applyAgentRecommendation,
  getAgentRecommendations,
  unapplyAgentRecommendation,
  type AgentRecommendationDto,
  type RatioSet,
} from "@/lib/koryo-api";
import { T } from "@/components/ui/tokens";
import {
  DASH,
  InlineError,
  PageHeader,
  PageShell,
  Pagination,
  Section,
  dateTime,
  hasRole,
  num,
  signed,
  useRole,
} from "../../_g1/ui";
import { Chips, Notice, errText, useApi } from "../../_g3/ui";

const PAGE_SIZE = 50;

/** 성분 3자리(`lots.*_ratio DECIMAL(6,3)`) · 품질 2자리(`quality.score DECIMAL(5,2)`) */
const RATIO_DIGITS = 3;
const SCORE_DIGITS = 2;

/** 성분 합계 허용 오차 — `/predict` 의 422 규칙과 같은 값이다 (goal.md 2.3) */
const SUM_TOLERANCE = 0.05;

const COMPONENTS = ["sn", "ag", "cu", "pb"] as const;
type Component = (typeof COMPONENTS)[number];

const COMPONENT_LABEL: Record<Component, string> = {
  sn: "Sn",
  ag: "Ag",
  cu: "Cu",
  pb: "Pb",
};

const SOURCE_LABEL: Record<string, string> = {
  recommend_api: "추천 화면",
  agent: "배합 Agent",
};

const APPLIED_FILTERS = [
  { value: "", label: "전체" },
  { value: "true", label: "적용" },
  { value: "false", label: "미적용" },
];

/** 총 열 수 — 빈 상태 행의 `colSpan`. 열을 늘리면 여기도 늘린다 */
const COLUMN_COUNT = 21;

function ratioSum(r: RatioSet): number | null {
  const values = COMPONENTS.map((c) => r[c]);
  if (values.some((v) => v === null || v === undefined)) return null;
  return values.reduce((a, b) => (a as number) + (b as number), 0) as number;
}

/** 추천 − 실제. 한쪽이라도 없으면 `null` — 0 을 만들지 않는다 */
function diff(a: number | null, b: number | null | undefined): number | null {
  if (a === null || a === undefined) return null;
  if (b === null || b === undefined) return null;
  return a - b;
}

export default function AgentRecommendationsPage() {
  const [page, setPage] = useState(1);
  const [applied, setApplied] = useState("");
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  /** 연결 입력창이 열린 행 */
  const [editing, setEditing] = useState<number | null>(null);
  const [lotInput, setLotInput] = useState("");
  const [busy, setBusy] = useState(false);

  const role = useRole();
  // 권한 판정의 정본은 서버의 403 이다 — 이건 이중 방어다 (ts-types §6.3)
  const canApply = hasRole(role, "admin", "manufacture", "quality");

  const state = useApi(
    () =>
      getAgentRecommendations({
        page,
        page_size: PAGE_SIZE,
        applied: applied === "" ? undefined : applied === "true",
      }),
    [page, applied]
  );

  const rows: AgentRecommendationDto[] = useMemo(
    () => state.data?.items ?? [],
    [state.data]
  );
  const total = state.data?.total ?? 0;

  function closeEditor() {
    setEditing(null);
    setLotInput("");
  }

  async function submitApply(id: number) {
    const lotId = lotInput.trim();
    if (!lotId) return;
    setBusy(true);
    setNotice(null);
    try {
      await applyAgentRecommendation(id, lotId);
      closeEditor();
      setNotice({ tone: "ok", text: `${lotId} 을(를) 적용 LOT 으로 연결했습니다.` });
      state.refetch();
    } catch (err) {
      // 서버 문장을 그대로 보여준다 — 404 "LOT 을 찾을 수 없습니다" / 409 / 403
      setNotice({ tone: "error", text: errText(err) });
    } finally {
      setBusy(false);
    }
  }

  async function submitUnapply(id: number, lotId: string) {
    setBusy(true);
    setNotice(null);
    try {
      await unapplyAgentRecommendation(id);
      setNotice({ tone: "ok", text: `${lotId} 연결을 해제했습니다. 추천 이력은 남습니다.` });
      state.refetch();
    } catch (err) {
      setNotice({ tone: "error", text: errText(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <PageShell>
      <PageHeader title="추천 이력" subtitle="AI 배합 추천값과 실제 적용 결과 비교" />

      {state.error && <InlineError message={state.error} onRetry={state.refetch} />}
      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}

      <Section
        title={`추천 이력 (${total.toLocaleString()}건)`}
        right={
          <Chips
            value={applied}
            onChange={(v) => {
              setApplied(v);
              setPage(1);
              closeEditor();
            }}
            options={APPLIED_FILTERS}
          />
        }
      >
        <div style={{ overflowX: "auto", border: `1px solid ${T.border}`, borderRadius: 12 }}>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: 12.5,
              fontVariantNumeric: "tabular-nums",
              minWidth: 1720,
            }}
          >
            <thead>
              <tr style={{ background: "#F8F9FB" }}>
                <Th rowSpan={2}>추천 일시</Th>
                <Th rowSpan={2}>출처</Th>
                <Th rowSpan={2}>요청자</Th>
                <Th rowSpan={2}>모델</Th>
                <Th colSpan={4} center>
                  추천 배합 (%)
                </Th>
                <Th colSpan={4} center>
                  실제 배합 (%)
                </Th>
                <Th colSpan={4} center>
                  차이 (추천 − 실제)
                </Th>
                <Th rowSpan={2} right>
                  예측 품질
                </Th>
                <Th rowSpan={2} right>
                  실측 품질
                </Th>
                <Th rowSpan={2} right>
                  품질 차이
                </Th>
                <Th rowSpan={2}>적용 LOT</Th>
                <Th rowSpan={2}>작업</Th>
              </tr>
              <tr style={{ background: "#F8F9FB" }}>
                {(["r", "a", "d"] as const).map((group) =>
                  COMPONENTS.map((c) => (
                    <Th key={`${group}-${c}`} right small>
                      {COMPONENT_LABEL[c]}
                    </Th>
                  ))
                )}
              </tr>
            </thead>
            <tbody>
              {state.loading && (
                <tr>
                  <Td colSpan={COLUMN_COUNT} muted>
                    불러오는 중…
                  </Td>
                </tr>
              )}

              {!state.loading && !state.error && rows.length === 0 && (
                <tr>
                  <Td colSpan={COLUMN_COUNT} muted>
                    표시할 이력이 없습니다.
                  </Td>
                </tr>
              )}

              {!state.loading &&
                rows.map((row) => {
                  const rec = row.recommended_ratios;
                  const act = row.actual_ratios;
                  const sum = ratioSum(rec);
                  const sumOff = sum !== null && Math.abs(sum - 100) > SUM_TOLERANCE;
                  const qualityDiff = diff(row.actual_quality, row.predicted_quality);

                  return (
                    <tr key={row.id} style={{ borderTop: `1px solid ${T.border}` }}>
                      <Td>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                          {dateTime(row.recommended_at)}
                          {/* 수용 기준 6 — 합계가 100.0 이 아닌 추천 행은 경고 배지 */}
                          {sumOff && (
                            <Badge
                              tone="warn"
                              title={`추천 배합 합계가 ${sum?.toFixed(RATIO_DIGITS)}% 입니다 (100% 아님)`}
                            >
                              합계 {sum?.toFixed(1)}%
                            </Badge>
                          )}
                          {/* 🔴 수렴 실패한 추천도 이력에 남는다. 그 사실을 숨기지 않는다 */}
                          {!row.optimization_success && (
                            <Badge tone="error" title="최적화가 수렴하지 못한 추천입니다">
                              수렴 실패
                            </Badge>
                          )}
                        </span>
                      </Td>
                      <Td>{SOURCE_LABEL[row.source] ?? row.source}</Td>
                      <Td>{row.username ?? DASH}</Td>
                      <Td>{row.model_name ?? DASH}</Td>

                      {COMPONENTS.map((c) => (
                        <Td key={`r-${c}`} right>
                          {num(rec[c], RATIO_DIGITS)}
                        </Td>
                      ))}
                      {COMPONENTS.map((c) => (
                        <Td key={`a-${c}`} right>
                          {num(act ? act[c] : null, RATIO_DIGITS)}
                        </Td>
                      ))}
                      {COMPONENTS.map((c) => (
                        <Td key={`d-${c}`} right>
                          {signed(diff(rec[c], act ? act[c] : null), RATIO_DIGITS)}
                        </Td>
                      ))}

                      <Td right>{num(row.predicted_quality, SCORE_DIGITS)}</Td>
                      <Td right>{num(row.actual_quality, SCORE_DIGITS)}</Td>
                      <Td right>{signed(qualityDiff, SCORE_DIGITS)}</Td>

                      <Td>{row.applied_lot_id ?? DASH}</Td>
                      <Td>
                        {editing === row.id ? (
                          <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                            {/* `_g1/ui.tsx` 의 `TextInput` 은 Enter/Esc 를 못 받는다 —
                                거긴 개발1 담당이라 읽기만 하므로 여기서 <input> 을 쓴다 */}
                            <input
                              type="text"
                              value={lotInput}
                              autoFocus
                              placeholder="LOT-2024-001"
                              maxLength={20}
                              aria-label="적용 LOT 번호"
                              onChange={(e) => setLotInput(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") void submitApply(row.id);
                                if (e.key === "Escape") closeEditor();
                              }}
                              style={{
                                width: 150,
                                height: 28,
                                padding: "0 8px",
                                borderRadius: 8,
                                border: `1px solid ${T.border}`,
                                background: T.surface,
                                color: T.text,
                                fontSize: 12,
                                fontFamily: "inherit",
                              }}
                            />
                            <button
                              type="button"
                              className="btn"
                              disabled={busy || lotInput.trim() === ""}
                              onClick={() => void submitApply(row.id)}
                            >
                              확인
                            </button>
                            <button type="button" className="btn" onClick={closeEditor}>
                              취소
                            </button>
                          </span>
                        ) : row.applied ? (
                          <button
                            type="button"
                            className="btn"
                            disabled={!canApply || busy}
                            title={canApply ? undefined : "연결 해제 권한이 없습니다"}
                            onClick={() =>
                              void submitUnapply(row.id, row.applied_lot_id ?? "")
                            }
                          >
                            연결 해제
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="btn"
                            disabled={!canApply || busy}
                            title={canApply ? undefined : "적용 LOT 연결 권한이 없습니다"}
                            onClick={() => {
                              setEditing(row.id);
                              setLotInput("");
                            }}
                          >
                            적용 LOT 연결
                          </button>
                        )}
                      </Td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>

        <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />

        <span style={{ fontSize: 11, color: T.textMuted, lineHeight: 1.6 }}>
          ⓘ 실제 배합·실측 품질은 연결된 LOT 에서 **조회 시점에** 읽습니다 — 복사해 두지
          않으므로 LOT 이 재검사되면 이 표도 함께 바뀝니다. 적용 LOT 연결은 사람이 확정하며,
          누가 언제 연결했는지는 감사로그에 남습니다.
        </span>
      </Section>
    </PageShell>
  );
}

function Badge({
  children,
  tone,
  title,
}: {
  children: React.ReactNode;
  tone: "warn" | "error";
  title?: string;
}) {
  const color = tone === "warn" ? T.warning : T.error;
  return (
    <span
      title={title}
      style={{
        display: "inline-block",
        padding: "1px 6px",
        borderRadius: 999,
        border: `1px solid ${color}`,
        color,
        fontSize: 10.5,
        fontWeight: 600,
        whiteSpace: "nowrap",
      }}
    >
      ⚠ {children}
    </span>
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
