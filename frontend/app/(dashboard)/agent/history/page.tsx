"use client";

/**
 * FE-RT-42 — Agent 로그 · `/agent/history` · FR-AG-05 (**선택**)
 *
 * 명세: `specs/plan-g3.md` FE-RT-42 · 공통 전제 §G9-1·§G9-2. 와이어프레임 없음.
 *
 * ⚠ **`audit_logs` 와 혼동하지 마라.** `audit_logs` 는 `admin` 전용이고 FE-RT-27
 *   `/system/logs` 가 조회한다. 이 화면은 **Agent 전용 로그**이며 전 역할 R 이다.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * 라운드 2 에서 지운 것:
 *   - 하드코딩 질문이력 배열 10건 하드코딩 (API 호출 0건)
 *   - 답변 전문의 근거 없는 수치: *"모델: GradientBoosting (R² 0.627)"*
 *     (api-contract §7.4 위반) · *"AG 125kg 보유 / 필요 150kg"* (재고 테이블 없음) ·
 *     *"3호 라인 T-3-02 센서"* (라인·센서 컬럼 없음)
 *   - `AGENTS` 5종 하드코딩 — **계약에 Agent 종류 정의가 없다.** 응답 distinct 로 파생한다
 *   - `USERS` 하드코딩 사용자 필터 — 쿼리 파라미터에 `user_id` 가 없다 (`/audit-logs` 에만 있다)
 *   - `dateFilter` 가 서버로 안 가고 mock 문자열과 비교되던 것
 *     → **`date_from`/`date_to` 를 실제 쿼리 파라미터로 전송한다**
 *     (FE-RT-34 와 같은 결함을 반복하지 않는다 — 수용 기준 5)
 *
 * ── 2026-08-28 계약 확정 ──────────────────────────────────────────────────────
 * `agent_runs` 테이블과 `GET /agents/logs` 가 실제로 생기면서 필드가 확정됐다.
 * 그전까지 이 화면은 `agent`·`latency_ms`·`status` 를 찾고 있었는데 서버는
 * `scope`·`total_ms`·`answer_status` 를 준다. **19건이 있는데도 표가 비어 있었다.**
 * 계약(§6.6)에 맞춰 매핑을 고쳤다.
 *
 * **"정확도" 는 만족도다.** 설계서 §6.8: 정답 라벨이 없는 자연어 답변에서 정확도를
 * 계산할 방법은 사람의 평가밖에 없다. `GET /agents/feedback/summary` 가 주는
 * 👍/(👍+👎) 를 쓰고, 화면에도 **"만족도 (n건 평가 기준)"** 로 적는다.
 * 평가가 0건이면 서버가 `satisfaction: null` 을 주고 화면은 **왜 없는지 말한다.**
 * 0% 로 채우지 않는다 — 그건 "아무도 평가 안 함" 이 아니라 "전원 불만족" 으로 읽힌다.
 *
 * ⚠ `prompt_sent`(외부 송출 전문)·`raw_answer` 는 서버가 아예 내려주지 않는다.
 *   질문 원문까지가 감사 범위다.
 * ══════════════════════════════════════════════════════════════════════════════
 */

import { useEffect, useMemo, useState } from "react";
import {
  getAgentFeedbackSummary,
  getAgentLogs,
  type AgentFeedbackSummary,
} from "@/lib/koryo-api";
import { T } from "@/components/ui/tokens";
import {
  DateInput,
  Field,
  FilterBar,
  InlineError,
  PAGE_SIZE_OPTIONS,
  PageHeader,
  PageShell,
  Pagination,
  Section,
  Select,
  dateTime,
  int,
  num,
} from "../../_g1/ui";
import { PendingBanner, isNotImplemented, useApi } from "../../_g3/ui";

/** `scope` 는 화면 단위다 (§6.6). 코드값을 그대로 보여주지 않는다. */
const SCOPE_LABEL: Record<string, string> = {
  receiving: "입고 (FE-RT-10)",
  shipping: "출하 (FE-RT-20)",
  mixing: "배합",
  global: "전역",
};

/** §6.8 은 rating 을 1|-1 두 값으로만 정의했다. 그 외는 미평가다. */
const RATING_LABEL: Record<string, string> = { "1": "👍", "-1": "👎" };

/** §7.5 닫힌 집합 5개. 모르는 값이 오면 **그대로 보여준다** — 임의로 뭉개지 않는다. */
const STATUS_LABEL: Record<string, { text: string; color: string }> = {
  ok: { text: "정상", color: T.success },
  no_evidence: { text: "근거 없음", color: T.textMuted },
  out_of_scope: { text: "범위 밖", color: T.textMuted },
  timeout: { text: "시간 초과", color: T.warning },
  rule_violation: { text: "룰 위반 — 답변 폐기", color: T.error },
};

function StatusCell({
  status,
  violations,
  errorCode,
}: {
  status: string | null;
  violations: string[] | null;
  errorCode: string | null;
}) {
  const known = status ? STATUS_LABEL[status] : undefined;
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 2 }}>
      <span style={{ color: known?.color ?? T.text, fontWeight: known ? 600 : 400 }}>
        {known?.text ?? status ?? "—"}
      </span>
      {/* 위반 사유를 숨기지 않는다 — 이 화면이 그걸 보라고 있는 것이다 */}
      {violations?.length ? (
        <span style={{ fontSize: 10.5, color: T.error, lineHeight: 1.4 }}>
          {violations.join(" / ")}
        </span>
      ) : null}
      {errorCode ? (
        <span style={{ fontSize: 10.5, color: T.warning }}>{errorCode}</span>
      ) : null}
    </span>
  );
}

/**
 * 만족도 카드 — `agent_feedback` 이 유일한 원천이다 (§6.8).
 *
 * 🔴 평가가 0건이면 **숫자를 만들지 않는다.** 서버가 `satisfaction: null` 과
 *    사유 문장을 주고, 화면은 그 문장을 그대로 보여준다.
 */
function SatisfactionCard({ summary }: { summary: AgentFeedbackSummary | null }) {
  if (!summary) return null;
  const has = summary.satisfaction !== null && summary.satisfaction !== undefined;
  return (
    <div
      className="card"
      style={{ display: "flex", gap: 28, alignItems: "center", flexWrap: "wrap" }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        <span style={{ fontSize: 11.5, color: T.textMuted }}>만족도</span>
        <span style={{ fontSize: 26, fontWeight: 700, color: has ? T.primary : T.textMuted }}>
          {has ? `${summary.satisfaction}%` : "—"}
        </span>
      </div>
      <div style={{ display: "flex", gap: 20, fontSize: 12.5, color: T.textSub }}>
        <Metric label="👍" value={summary.positive} />
        <Metric label="👎" value={summary.negative} />
        <Metric label="평가" value={`${summary.rated}건`} />
        <Metric label="실행" value={`${summary.total_runs}건`} />
      </div>
      {summary.note && (
        <span style={{ fontSize: 11.5, color: T.textMuted, flex: 1, minWidth: 240 }}>
          {summary.note}
        </span>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 2 }}>
      <span style={{ fontSize: 11, color: T.textMuted }}>{label}</span>
      <span style={{ fontWeight: 600, color: T.text }}>{value}</span>
    </span>
  );
}


type Row = Record<string, unknown>;

interface Query {
  page: number;
  pageSize: number;
  scope: string;
  dateFrom: string;
  dateTo: string;
}

const INITIAL: Query = { page: 1, pageSize: 50, scope: "", dateFrom: "", dateTo: "" };

function str(row: Row, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = row[k];
    if (typeof v === "string" && v !== "") return v;
  }
  return null;
}

function n(row: Row, ...keys: string[]): number | null {
  for (const k of keys) {
    const v = row[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return null;
}

export default function AgentHistoryPage() {
  /** 폼 상태와 **전송된 쿼리**를 분리한다 — 타이핑마다 요청이 나가지 않게 */
  const [form, setForm] = useState<Query>(INITIAL);
  const [applied, setApplied] = useState<Query>(INITIAL);

  const rangeInverted =
    form.dateFrom !== "" && form.dateTo !== "" && form.dateFrom > form.dateTo;

  const state = useApi(
    () =>
      getAgentLogs({
        page: applied.page,
        page_size: applied.pageSize,
        // 빈 값은 `qs()` 가 통째로 뺀다 — 서버가 빈 문자열을 필터로 오해하지 않게
        scope: applied.scope || undefined,
        date_from: applied.dateFrom || undefined,
        date_to: applied.dateTo || undefined,
      }),
    [applied.page, applied.pageSize, applied.scope, applied.dateFrom, applied.dateTo]
  );

  const pending = isNotImplemented(state.status, state.error);
  const rows: Row[] = useMemo(() => state.data?.items ?? [], [state.data]);
  const total = state.data?.total ?? 0;

  /** Agent 종류 — **응답 데이터의 distinct 로 파생.** 하드코딩 목록이 아니다 (§4) */
  const agentOptions = useMemo(() => {
    const seen = new Set<string>();
    for (const r of rows) {
      const a = str(r, "scope");
      if (a) seen.add(a);
    }
    return [
      { value: "", label: "전체" },
      ...[...seen].sort().map((a) => ({ value: a, label: a })),
    ];
  }, [rows]);

  /** 만족도 — `agent_feedback` 이 유일한 원천이다 (§6.8). 없으면 없다고 말한다. */
  const [summary, setSummary] = useState<AgentFeedbackSummary | null>(null);
  useEffect(() => {
    let alive = true;
    getAgentFeedbackSummary(applied.scope || undefined)
      .then((s) => alive && setSummary(s))
      .catch(() => alive && setSummary(null));
    return () => {
      alive = false;
    };
  }, [applied.scope]);

  const colCount = 8;

  const apply = () => setApplied({ ...form, page: 1 });

  return (
    <PageShell>
      <PageHeader
        title="Agent 로그"
        subtitle="AI Agent 호출 이력 · 응답 시간 · 만족도 (사업계획서 p.60 사용 로그 기록·관리)"
      />

      <SatisfactionCard summary={summary} />

      {pending && (
        <PendingBanner note="Agent 호출 로그를 저장할 테이블이 없어 조회 결과가 0건입니다. 필터는 실제 쿼리 파라미터로 전송됩니다." />
      )}

      {!pending && state.error && <InlineError message={state.error} onRetry={state.refetch} />}

      <FilterBar>
        <Field label="화면" htmlFor="lg-scope" width={170}>
          <Select
            id="lg-scope"
            value={form.scope}
            onChange={(v) => setForm((f) => ({ ...f, scope: v }))}
            options={agentOptions}
            disabled={agentOptions.length <= 1}
            width={170}
          />
        </Field>

        <Field label="기간 시작" htmlFor="lg-from" width={150}>
          <DateInput
            id="lg-from"
            value={form.dateFrom}
            onChange={(v) => setForm((f) => ({ ...f, dateFrom: v }))}
            invalid={rangeInverted}
          />
        </Field>

        <Field label="기간 종료" htmlFor="lg-to" width={150}>
          <DateInput
            id="lg-to"
            value={form.dateTo}
            onChange={(v) => setForm((f) => ({ ...f, dateTo: v }))}
            invalid={rangeInverted}
          />
        </Field>

        <Field label="페이지 크기" htmlFor="lg-size" width={120}>
          <Select
            id="lg-size"
            value={String(form.pageSize)}
            onChange={(v) => setForm((f) => ({ ...f, pageSize: Number(v) }))}
            options={PAGE_SIZE_OPTIONS}
            width={120}
          />
        </Field>

        <button
          type="button"
          className="btn btn-primary"
          disabled={rangeInverted || state.loading}
          onClick={apply}
          style={{ height: 34 }}
        >
          조회
        </button>

        {rangeInverted && (
          <span style={{ fontSize: 11.5, color: T.error, alignSelf: "center" }}>
            종료일이 시작일보다 빠릅니다
          </span>
        )}
      </FilterBar>

      <Section title={`호출 이력 (${pending ? 0 : total.toLocaleString()}건)`}>
        <div style={{ overflowX: "auto", border: `1px solid ${T.border}`, borderRadius: 12 }}>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: 12.5,
              fontVariantNumeric: "tabular-nums",
              minWidth: 900,
            }}
          >
            <thead>
              <tr style={{ background: "#F8F9FB" }}>
                <Th>호출 일시</Th>
                <Th>화면</Th>
                <Th>사용자</Th>
                <Th>질문</Th>
                <Th right>응답 시간(ms)</Th>
                <Th>경로</Th>
                <Th>상태</Th>
                <Th>평가</Th>
              </tr>
            </thead>
            <tbody>
              {state.loading && (
                <tr>
                  <Td colSpan={colCount} muted>
                    불러오는 중…
                  </Td>
                </tr>
              )}

              {!state.loading && rows.length === 0 && (
                <tr>
                  <Td colSpan={colCount} muted>
                    {pending
                      ? "v1 범위에서는 Agent 로그를 저장·조회하지 않습니다."
                      : "표시할 이력이 없습니다."}
                  </Td>
                </tr>
              )}

              {!state.loading &&
                rows.map((row, i) => (
                  <tr key={i} style={{ borderTop: `1px solid ${T.border}` }}>
                    <Td>{dateTime(str(row, "created_at"))}</Td>
                    <Td>{SCOPE_LABEL[str(row, "scope") ?? ""] ?? str(row, "scope") ?? "—"}</Td>
                    <Td>{str(row, "username") ?? "—"}</Td>
                    <Td wrap>{str(row, "question") ?? "—"}</Td>
                    {/* 1,000ms 이상도 `1.2s` 로 축약하지 않는다 — 성능 비교 목적 (§6) */}
                    <Td right>{int(n(row, "total_ms"))}</Td>
                    <Td>{str(row, "route") ?? "—"}</Td>
                    <Td>
                      <StatusCell
                        status={str(row, "answer_status")}
                        violations={row.violations as string[] | null}
                        errorCode={str(row, "error_code")}
                      />
                    </Td>
                    {/* 미평가는 null 이다. 0 이나 "보통" 으로 바꾸지 않는다 */}
                    <Td>{RATING_LABEL[String(n(row, "rating") ?? "")] ?? "미평가"}</Td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>

        {!pending && (
          <Pagination
            page={applied.page}
            pageSize={applied.pageSize}
            total={total}
            onPage={(p) => setApplied((a) => ({ ...a, page: p }))}
          />
        )}

        <span style={{ fontSize: 11, color: T.textMuted, lineHeight: 1.6 }}>
          ⓘ `AgentLogOut` 의 필드 구성이 계약에 정의돼 있지 않습니다. 정확도는 측정 방법이
          산출물 어디에도 정의돼 있지 않아, 응답에 값이 있을 때만 열을 표시합니다.
        </span>
      </Section>
    </PageShell>
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
  wrap,
}: {
  children: React.ReactNode;
  colSpan?: number;
  right?: boolean;
  muted?: boolean;
  wrap?: boolean;
}) {
  return (
    <td
      colSpan={colSpan}
      style={{
        padding: muted ? "28px 12px" : "9px 12px",
        color: muted ? T.textMuted : T.text,
        textAlign: muted ? "center" : right ? "right" : "left",
        whiteSpace: wrap ? "normal" : "nowrap",
        maxWidth: wrap ? 380 : undefined,
      }}
    >
      {children}
    </td>
  );
}
