"use client";

/**
 * FE-RT-40 — 의사결정 지원 · `/agent/decision` · FR-AG-03 (**선택**)
 *
 * 명세: `specs/plan-g3.md` FE-RT-40 · 공통 전제 §G9-1·§G9-2. 와이어프레임 없음.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * 🔴 **현 구현과 계약의 형태가 달랐다.**
 *
 * 계약은 *"LOT 하나를 주면 원인과 방안을 돌려주는 함수"* 다
 * (`POST /agents/decision {lot_id}` → `{root_causes[], recommendations[], confidence}`).
 * 현 구현은 *"AI 가 알아서 만들어 둔 액션 목록을 채택/기각하는 워크플로"* 였다.
 * **계약 형태를 따른다** — 워크플로로 가려면 `agent_recommendations` 테이블이 필요하고
 * 그건 CR-DB-002 사안이다 (db-schema §6.2).
 *
 * 라운드 2 에서 지운 것:
 *   - `INITIAL_DECISIONS` 5건 하드코딩 (API 호출 0건이었다)
 *   - `act()` 채택/기각 — **로컬 state 만 바꿔 저장되는 것처럼 보였다.**
 *     새로고침하면 되돌아간다. 저장할 엔드포인트도 테이블도 없다
 *   - 근거 없는 수치: *"재고량 750kg"*(재고 테이블 없음) · *"납기 6/29"* ·
 *     *"MAPE 4.1%"* · *"SUP_D 순도 99.97%"* — **`SUP_D` 는 존재하지 않는 공급사다**
 *     (db-schema §4.2: SUP_A/B/C 3사)
 *   - 우선순위(P1/P2/P3)·카테고리·소요기간(즉시/단기/중기)·예상효과 5필드 (계약에 없다)
 *
 * 신설한 것:
 *   - **대상 LOT 드롭다운** — 계약의 필수 필드 `lot_id` 를 보낼 방법이 없는 구조였다.
 *     선택지는 `GET /api/v1/lots?status=fail` **실 데이터**로 채운다 (하드코딩 아님)
 *   - **신뢰도(`confidence`)** — 계약에 있는데 화면에 없었다
 * ══════════════════════════════════════════════════════════════════════════════
 */

import { useCallback, useMemo, useState } from "react";
import { requestAgentDecision } from "@/lib/koryo-api";
import { useLots } from "@/hooks/useKoryoData";
import { T } from "@/components/ui/tokens";
import { Field, FilterBar, InlineError, PageHeader, PageShell, Section, dateOnly } from "../../_g1/ui";
import {
  PendingBanner,
  PendingResult,
  errStatus,
  errText,
  isNotImplemented,
} from "../../_g3/ui";

type Result =
  | { kind: "pending"; message: string }
  | { kind: "error"; message: string; status: number | null }
  | { kind: "ok"; rootCauses: string[]; recommendations: string[]; confidence: number | null };

export default function AgentDecisionPage() {
  const [lotId, setLotId] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  /**
   * 불량 LOT 목록 — 요구사항 문장이 "불량 LOT 원인 분석" 이고
   * 계약 요청 본문도 `{lot_id}` 단건이다. 두 문서가 일치한다 (§2).
   */
  const lots = useLots({ status: "fail", page_size: 200 });

  const lotOptions = useMemo(
    () => (lots.data?.items ?? []).map((l) => ({ value: l.lot_id, date: l.date })),
    [lots.data]
  );

  const canRun = lotId !== "" && !running;

  const run = useCallback(async () => {
    if (!canRun) return;
    setRunning(true);
    setResult(null);
    try {
      const data = await requestAgentDecision(lotId); // 🔴 실제 POST
      setResult({
        kind: "ok",
        rootCauses: data.root_causes ?? [],
        recommendations: data.recommendations ?? [],
        confidence: typeof data.confidence === "number" ? data.confidence : null,
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
  }, [canRun, lotId]);

  return (
    <PageShell>
      <PageHeader title="의사결정 지원" subtitle="불량 LOT 원인 분석 및 개선 방안 추천" />

      <PendingBanner note="대상 LOT 목록은 실제 데이터입니다. 원인 분석 요청도 실제로 전송되지만, v1 에서는 분석 기능이 제공되지 않습니다." />

      <FilterBar>
        <Field label="대상 LOT (필수)" htmlFor="dec-lot" width={260}>
          <select
            id="dec-lot"
            value={lotId}
            disabled={lots.loading || lots.error !== null || lotOptions.length === 0}
            onChange={(e) => setLotId(e.target.value)}
            style={{
              height: 34,
              width: 260,
              padding: "0 10px",
              borderRadius: 8,
              border: `1px solid ${T.border}`,
              background: T.surface,
              fontSize: 12.5,
              color: T.text,
              fontFamily: "inherit",
            }}
          >
            <option value="">
              {lots.loading
                ? "불러오는 중…"
                : lots.error
                  ? "목록을 불러오지 못했습니다"
                  : lotOptions.length === 0
                    ? "불합격 LOT 이 없습니다"
                    : "LOT 을 선택하세요"}
            </option>
            {lotOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.value} ({dateOnly(o.date)})
              </option>
            ))}
          </select>
        </Field>

        <button
          type="button"
          className="btn btn-primary"
          disabled={!canRun}
          onClick={() => void run()}
          style={{ height: 34 }}
        >
          {running ? "분석 중…" : "원인 분석"}
        </button>
      </FilterBar>

      {/* 목록이 실패하면 조용히 비우지 않는다 — 왜 드롭다운이 비었는지 밝힌다 */}
      {lots.error && <InlineError message={lots.error} onRetry={lots.refetch} />}

      <Section title="분석 결과">
        {running && (
          <Center>서버에 요청하는 중입니다…</Center>
        )}

        {!running && result === null && (
          <Center>
            {lotId === "" ? "대상 LOT 을 선택하세요." : "원인 분석을 눌러주세요."}
          </Center>
        )}

        {!running && result?.kind === "pending" && (
          <PendingResult
            detail="불량 원인 분석 기능은 v1 범위 밖입니다. 서버가 이 요청을 처리하지 않았습니다 (HTTP 501). 선택한 LOT 은 그대로 유지됩니다."
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

        {/* v1 에서는 도달하지 않는다. 서버가 응답을 주기 시작하면 그때 그린다 */}
        {!running && result?.kind === "ok" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <ListCard title="추정 원인" items={result.rootCauses} />
              <ListCard title="개선 방안" items={result.recommendations} />
            </div>
            {/*
              `confidence` 범위(0~1 인지 0~100 인지)가 계약 미정의다.
              0~1 로 가정해 백분율로 표시하되, 1 을 넘으면 그대로 숫자만 보여준다 (§4).
              `null` 이면 영역 자체를 숨긴다 — 0 으로 채우지 않는다.
            */}
            {result.confidence !== null && (
              <span style={{ fontSize: 12.5, color: T.textSub }}>
                신뢰도{" "}
                <strong style={{ color: T.text }}>
                  {result.confidence <= 1
                    ? `${(result.confidence * 100).toFixed(2)}%`
                    : result.confidence.toFixed(2)}
                </strong>
              </span>
            )}
          </div>
        )}
      </Section>
    </PageShell>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return (
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
      {children}
    </div>
  );
}

function ListCard({ title, items }: { title: string; items: string[] }) {
  return (
    <div
      style={{
        padding: "14px 16px",
        borderRadius: 10,
        border: `1px solid ${T.border}`,
        background: T.surface,
      }}
    >
      <strong style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{title}</strong>
      {items.length === 0 ? (
        <div style={{ marginTop: 8, fontSize: 12.5, color: T.textMuted }}>—</div>
      ) : (
        <ul style={{ margin: "8px 0 0", paddingLeft: 18, display: "flex", flexDirection: "column", gap: 6 }}>
          {items.map((it, i) => (
            <li key={i} style={{ fontSize: 12.5, lineHeight: 1.7, color: T.textSub }}>
              {it}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
