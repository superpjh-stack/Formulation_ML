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
 * 신설: **정확도 열** — 요구사항 3요소(호출·응답시간·정확도) 중 하나가 빠져 있었다.
 *   단 *"정확도를 무엇으로 측정하는지 산출물 어디에도 정의가 없다."*
 *   **응답에 값이 있을 때만 표시하고, 없으면 열을 숨긴다. 값을 만들어 채우지 않는다.**
 * ══════════════════════════════════════════════════════════════════════════════
 */

import { useMemo, useState } from "react";
import { getAgentLogs } from "@/lib/koryo-api";
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

type Row = Record<string, unknown>;

interface Query {
  page: number;
  pageSize: number;
  agent: string;
  dateFrom: string;
  dateTo: string;
}

const INITIAL: Query = { page: 1, pageSize: 50, agent: "", dateFrom: "", dateTo: "" };

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
        agent: applied.agent || undefined,
        date_from: applied.dateFrom || undefined,
        date_to: applied.dateTo || undefined,
      }),
    [applied.page, applied.pageSize, applied.agent, applied.dateFrom, applied.dateTo]
  );

  const pending = isNotImplemented(state.status, state.error);
  const rows: Row[] = useMemo(() => state.data?.items ?? [], [state.data]);
  const total = state.data?.total ?? 0;

  /** Agent 종류 — **응답 데이터의 distinct 로 파생.** 하드코딩 목록이 아니다 (§4) */
  const agentOptions = useMemo(() => {
    const seen = new Set<string>();
    for (const r of rows) {
      const a = str(r, "agent", "agent_name");
      if (a) seen.add(a);
    }
    return [
      { value: "", label: "전체" },
      ...[...seen].sort().map((a) => ({ value: a, label: a })),
    ];
  }, [rows]);

  /** 정확도 열은 **응답에 값이 하나라도 있을 때만** 만든다 (§4 주석) */
  const hasAccuracy = useMemo(
    () => rows.some((r) => n(r, "accuracy", "score") !== null),
    [rows]
  );

  const colCount = hasAccuracy ? 7 : 6;

  const apply = () => setApplied({ ...form, page: 1 });

  return (
    <PageShell>
      <PageHeader title="Agent 로그" subtitle="AI Agent 호출 이력 · 응답 시간 · 정확도" />

      {pending && (
        <PendingBanner note="Agent 호출 로그를 저장할 테이블이 없어 조회 결과가 0건입니다. 필터는 실제 쿼리 파라미터로 전송됩니다." />
      )}

      {!pending && state.error && <InlineError message={state.error} onRetry={state.refetch} />}

      <FilterBar>
        <Field label="Agent" htmlFor="lg-agent" width={170}>
          <Select
            id="lg-agent"
            value={form.agent}
            onChange={(v) => setForm((f) => ({ ...f, agent: v }))}
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
                <Th>Agent</Th>
                <Th>사용자</Th>
                <Th>질문</Th>
                <Th right>응답 시간(ms)</Th>
                {hasAccuracy && <Th right>정확도</Th>}
                <Th>상태</Th>
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
                    <Td>{dateTime(str(row, "created_at", "called_at", "timestamp"))}</Td>
                    <Td>{str(row, "agent", "agent_name") ?? "—"}</Td>
                    <Td>{str(row, "username", "user") ?? "—"}</Td>
                    <Td wrap>{str(row, "question", "query") ?? "—"}</Td>
                    {/* 1,000ms 이상도 `1.2s` 로 축약하지 않는다 — 성능 비교 목적 (§6) */}
                    <Td right>{int(n(row, "latency_ms", "elapsed_ms"))}</Td>
                    {hasAccuracy && <Td right>{num(n(row, "accuracy", "score"), 3)}</Td>}
                    <Td>{str(row, "status") ?? "—"}</Td>
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
