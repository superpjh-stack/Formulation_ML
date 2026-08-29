"use client";

/**
 * FE-RT-39 — 분석 요청 · `/agent/analysis` · FR-AG-02 (**선택**)
 *
 * 명세: `specs/plan-g3.md` FE-RT-39 · 공통 전제 §G9-1·§G9-2. 와이어프레임 없음.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * 🔴 v1 범위 = "준비 중" 을 정직하게 그리는 것까지 (`api-contract.md` §8.10).
 *
 * 라운드 2 에서 지운 것:
 *   - 하드코딩 리포트 배열 5건 — *"용융온도 1,180°C"* · *"에너지 소비 월 85만원"* ·
 *     *"야간 실온 20°C"* · *"3호 라인 T-3-02 센서"*. **DB 에 라인·교대조·실온·센서ID
 *     컬럼이 하나도 없다** (db-schema §3). 전부 발명된 값이다
 *   - 가짜 2초 지연 타이머 — 버튼만 도는 순수 연출. 요청은 0건이었다
 *   - 요약 4카드 (집계 응답이 계약에 없다. "대기 액션 = 3" 은 상수를 그대로 표시)
 *   - `PDF 저장`·`공유` 버튼 (계약 누락 · `ISS-001`)
 *   - 과거 리포트 피드 (리포트 목록 GET 이 없다. POST 만 존재한다)
 *
 * 신설한 것: **요청 폼.** 계약(`POST /agents/analysis`)이 `{topic, lot_id?,
 * date_from?, date_to?}` 를 요구하는데 현 구현에는 이 값을 지정할 입력이 없었다.
 * `topic` 은 요청 본문에서 **유일한 필수 필드**다.
 * ══════════════════════════════════════════════════════════════════════════════
 */

import { useCallback, useState } from "react";
import { requestAgentAnalysis } from "@/lib/koryo-api";
import { T } from "@/components/ui/tokens";
import {
  DateInput,
  Field,
  FilterBar,
  PageHeader,
  PageShell,
  Section,
  TextInput,
} from "../../_g1/ui";
import {
  FieldError,
  PendingResult,
  errStatus,
  errText,
  isNotImplemented,
} from "../../_g3/ui";

/** `topic` 1~200자 · `lot_id` 0~20자(`lots.lot_id VARCHAR(20)`) — 명세 §6 */
const MAX_TOPIC = 200;
const MAX_LOT_ID = 20;

type Result =
  | { kind: "pending"; message: string }
  | { kind: "error"; message: string; status: number | null }
  | {
      kind: "report";
      report: string | null;
      latencyMs: number;
      charts: unknown[];
      /** 차트가 없는 **이유**. 개수만 세는 대신 문장을 보여준다 */
      chartsNote: string;
      sources: number;
    };

export default function AgentAnalysisPage() {
  const [topic, setTopic] = useState("");
  const [lotId, setLotId] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  const topicTooLong = topic.trim().length > MAX_TOPIC;
  const lotTooLong = lotId.trim().length > MAX_LOT_ID;
  const rangeInverted = dateFrom !== "" && dateTo !== "" && dateFrom > dateTo;

  const canRun =
    topic.trim().length > 0 && !topicTooLong && !lotTooLong && !rangeInverted && !running;

  const run = useCallback(async () => {
    if (!canRun) return;
    setRunning(true);
    setResult(null);
    try {
      // 🔴 실제 요청이다. 빈 값은 아예 보내지 않는다 (`qs()` 가 빈 문자열을 거른다)
      const data = await requestAgentAnalysis({
        topic: topic.trim(),
        lot_id: lotId.trim() || undefined,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
      });
      setResult({
        kind: "report",
        report: data.report,
        chartsNote: data.charts_note ?? "",
        sources: (data.sources ?? []).length,
        latencyMs: data.latency_ms,
        charts: data.charts ?? [],
      });
    } catch (err) {
      const status = errStatus(err);
      const message = errText(err);
      setResult(
        isNotImplemented(status, message)
          ? { kind: "pending", message }
          : { kind: "error", message, status }
      );
    } finally {
      setRunning(false);
    }
  }, [canRun, topic, lotId, dateFrom, dateTo]);

  return (
    <PageShell>
      <PageHeader title="분석 요청" subtitle="기간·LOT 지정 AI 분석 리포트 요청" />


      <FilterBar>
        <Field label="분석 주제 (필수)" htmlFor="an-topic" width={280}>
          <TextInput
            id="an-topic"
            value={topic}
            onChange={setTopic}
            width={280}
            invalid={topicTooLong}
            placeholder="예: 8월 불량 LOT 원인"
          />
          <FieldError
            message={topicTooLong ? `분석 주제는 ${MAX_TOPIC}자를 넘을 수 없습니다` : null}
          />
        </Field>

        <Field label="LOT 번호" htmlFor="an-lot" width={170}>
          <TextInput
            id="an-lot"
            value={lotId}
            onChange={setLotId}
            invalid={lotTooLong}
            placeholder="LOT-2026-001"
          />
          <FieldError
            message={lotTooLong ? `LOT 번호는 ${MAX_LOT_ID}자를 넘을 수 없습니다` : null}
          />
        </Field>

        <Field label="기간 시작" htmlFor="an-from" width={150}>
          <DateInput id="an-from" value={dateFrom} onChange={setDateFrom} invalid={rangeInverted} />
        </Field>

        <Field label="기간 종료" htmlFor="an-to" width={150}>
          <DateInput id="an-to" value={dateTo} onChange={setDateTo} invalid={rangeInverted} />
          <FieldError message={rangeInverted ? "종료일이 시작일보다 빠릅니다" : null} />
        </Field>

        <button
          type="button"
          className="btn btn-primary"
          disabled={!canRun}
          onClick={() => void run()}
          style={{ height: 34 }}
        >
          {running ? "요청 중…" : "분석 요청"}
        </button>
      </FilterBar>

      <Section title="분석 결과">
        {running && (
          <div
            style={{
              minHeight: 160,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 13,
              color: T.textMuted,
            }}
          >
            서버에 요청하는 중입니다…
          </div>
        )}

        {!running && result === null && (
          <div
            style={{
              minHeight: 160,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 13,
              color: T.textMuted,
            }}
          >
            분석 주제를 입력하고 분석 요청을 눌러주세요.
          </div>
        )}

        {!running && result?.kind === "pending" && (
          <PendingResult
            detail="AI Agent 가 구성되지 않아 서버가 요청을 처리하지 않았습니다 (HTTP 501). 관리자에게 문의하세요. 입력한 조건은 그대로 유지됩니다."
            serverMessage={result.message}
          />
        )}

        {!running && result?.kind === "error" && (
          <div
            style={{
              padding: "12px 14px",
              borderRadius: 10,
              border: `1px solid ${T.error}`,
              background: "#FEF3F2",
              color: "#B42318",
              fontSize: 12.5,
              lineHeight: 1.6,
            }}
          >
            <strong style={{ fontWeight: 600 }}>요청이 실패했습니다</strong>
            <div style={{ marginTop: 4, wordBreak: "break-all" }}>
              {result.status !== null ? `HTTP ${result.status} — ` : ""}
              {result.message}
            </div>
          </div>
        )}

        {/* 2026-08-30 501 해제. `charts[]` 는 여전히 빈 배열이다 —
            계약에 원소 스키마가 없다. 개수를 세는 대신 **없는 이유**를 보여준다.
            빈 배열을 조용히 두면 "차트가 안 나오네" 로만 보인다 */}
        {!running && result?.kind === "report" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div
              style={{
                padding: "14px 16px",
                borderRadius: 10,
                border: `1px solid ${T.border}`,
                background: T.surface,
                fontSize: 12.5,
                lineHeight: 1.7,
                color: T.text,
                whiteSpace: "pre-wrap",
              }}
            >
              {/* 🔴 null 이 정상 값이다 — 근거가 없으면 리포트를 만들지 않는다 */}
              {result.report ?? "근거를 찾지 못해 리포트를 만들지 않았습니다."}
            </div>
            <span style={{ fontSize: 11.5, color: T.textMuted }}>
              응답 시간 {Math.round(result.latencyMs)} ms
              {result.sources > 0 && ` · 근거 ${result.sources}건`}
            </span>
            {result.chartsNote && (
              <span style={{ fontSize: 11, color: T.textMuted, lineHeight: 1.6 }}>
                {result.chartsNote}
              </span>
            )}
          </div>
        )}
      </Section>
    </PageShell>
  );
}
