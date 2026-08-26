"use client";

/**
 * FE-RT-36 — 다운로드 · `/data/download` · FR-DT-04 (필수, CSV/Excel)
 *
 * 명세: `specs/plan-g3.md` FE-RT-36. 와이어프레임 없음(SF-TD3 §3).
 * 저장 테이블: `lots`/`components`/`quality`. **501 아님.**
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * 🔴 **서버 생성 방식이다** (§3, 지시 항목).
 *
 * api-contract §8.9: *"`/data/export` 는 **유일하게 JSON 이 아닌 응답**이다.
 * `page_size` 상한(200)을 적용하지 않고 전체를 스트리밍한다. 대신 **최대 10만 행**
 * 제한을 걸고 초과 시 422."*
 * → 서버가 파일을 만들어 스트리밍하고 브라우저가 그 응답을 저장한다.
 *   클라이언트에서 JSON 을 받아 Blob 으로 CSV 를 조립하는 방식이 **아니다**.
 *
 * 프론트 구현 규약 (전부 지킴):
 *   1. **`window.location.href` 나 `<a href>` 직접 링크를 쓰지 않는다** —
 *      JWT 는 `Authorization: Bearer` 헤더로 나가는데 링크 이동은 헤더를 못 붙인다
 *   2. `exportData()` → `res.blob()` → `URL.createObjectURL` → 프로그램적 `<a download>`
 *      클릭 → `URL.revokeObjectURL()`
 *   3. 파일명은 **서버 `Content-Disposition` 에서 파싱**한다 (`exportData()` 가 처리).
 *      프론트가 파일명을 지어내지 않는다
 *   4. `format=xlsx` — UI 라벨은 "Excel", 쿼리 값은 `xlsx`
 *   5. 진행 표시는 요청 시작~응답 완료까지의 **실제 상태**다. 가짜 지연 금지
 *   6. **이 요청만 타임아웃이 없다** — 대용량 스트리밍이라 10초를 넘길 수 있다
 *
 * 라운드 2 에서 지운 것:
 *   - 가짜 지연 타이머 2회로 "다운로드중 → 완료" 를 연출하던 것.
 *     **파일이 실제로 생성되지 않았다**
 *   - 데이터셋 카드 5개 하드코딩 (성분분석/입고이력/품질검사/공정실적/AI학습용)
 *     → `entity` 3종 **단일 폼**
 *   - `ZIP` 형식 — 계약 `format` 에 `zip` 이 없다
 *   - 파일 크기·건수·기간·업데이트 시각 하드코딩(`"2.3 MB"` 등) — 응답 필드가 없다
 *   - 다운로드 이력 7건 + 사용자명 — 이력 엔드포인트가 없고
 *     `audit_logs` 는 GET 을 기록하지 않는다 (api-contract §6.2)
 *   - 안내 문구 *"민감 데이터는 접근 권한에 따라 제한될 수 있습니다"* —
 *     **계약에 엔티티별 권한 차등 규정이 없다.** 근거 없는 문구다
 *
 * 신설: 기간·공급사 필터 · 예상 행 수 · 10만 행 상한 이중 방어.
 * ══════════════════════════════════════════════════════════════════════════════
 */

import { useCallback, useMemo, useState } from "react";
import { exportData, getDataQuery, getSuppliers } from "@/lib/koryo-api";
import type { ExportFormat, QueryEntity } from "@/types/api";
import { T } from "@/components/ui/tokens";
import {
  DateInput,
  Field,
  FilterBar,
  InlineError,
  PageHeader,
  PageShell,
  Section,
  Select,
} from "../../_g1/ui";
import { Chips, Notice, errText, useApi } from "../../_g3/ui";

/** api-contract §8.9 — `/data/query` 와 동일한 화이트리스트 */
const ENTITIES: { value: QueryEntity; label: string }[] = [
  { value: "lots", label: "LOT" },
  { value: "components", label: "성분" },
  { value: "quality", label: "품질" },
];

/** 서버 상한. 초과 시 422 를 준다 — 프론트는 버튼을 먼저 막는다 (이중 방어) */
const MAX_ROWS = 100_000;

type Progress = "idle" | "running" | "done" | "failed";

export default function DataDownloadPage() {
  const [entity, setEntity] = useState<QueryEntity>("lots");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [supplier, setSupplier] = useState("");
  const [format, setFormat] = useState<ExportFormat>("csv");

  const [progress, setProgress] = useState<Progress>("idle");
  const [notice, setNotice] = useState<{ tone: "ok" | "warn" | "error"; text: string } | null>(
    null
  );

  const suppliers = useApi(() => getSuppliers(true), []);

  const supplierOptions = useMemo(
    () => [
      { value: "", label: "전체" },
      ...(suppliers.data?.items ?? []).map((s) => ({
        value: s.code,
        label: `${s.code} · ${s.name}`,
      })),
    ],
    [suppliers.data]
  );

  const rangeInverted = dateFrom !== "" && dateTo !== "" && dateFrom > dateTo;

  /**
   * 예상 행 수 — `GET /data/query?…&page_size=1` 의 `total` 만 쓴다 (§5).
   * **조용히 실패시키지 않는다** — 행 수 자리에 "—" 와 오류를 함께 보여준다 (§6).
   */
  const estimate = useApi(
    () =>
      getDataQuery(entity, {
        page_size: 1,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        supplier: supplier || undefined,
      }),
    [entity, dateFrom, dateTo, supplier],
    !rangeInverted
  );

  const rowCount = estimate.data?.total ?? null;
  const overLimit = rowCount !== null && rowCount > MAX_ROWS;
  const noRows = rowCount === 0;

  const canExport =
    progress !== "running" &&
    !rangeInverted &&
    !overLimit &&
    !noRows &&
    estimate.error === null;

  const run = useCallback(async () => {
    if (!canExport) return;
    setProgress("running");
    setNotice(null);
    try {
      // 🔴 인증 헤더가 붙는 실제 요청. 타임아웃 없음 (대용량 스트리밍)
      const file = await exportData(entity, format, {
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        supplier: supplier || undefined,
      });
      const url = URL.createObjectURL(file.blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = file.filename; // 서버 Content-Disposition 파싱 결과
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setProgress("done");
      setNotice({ tone: "ok", text: `${file.filename} 을(를) 내려받았습니다.` });
    } catch (err) {
      const msg = errText(err);
      setProgress("failed");
      setNotice({
        tone: "error",
        text: /422/.test(msg)
          ? `내보낼 수 있는 최대 행 수(${MAX_ROWS.toLocaleString()})를 초과했습니다. 기간을 좁혀 주세요.`
          : msg,
      });
    }
  }, [canExport, entity, format, dateFrom, dateTo, supplier]);

  return (
    <PageShell>
      <PageHeader title="데이터 다운로드" subtitle="대상 데이터 선택 및 CSV/Excel 내보내기" />

      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}

      <Section title="내보내기 조건">
        <Chips
          value={entity}
          onChange={(v) => setEntity(v as QueryEntity)}
          options={ENTITIES}
        />

        <FilterBar>
          <Field label="기간 시작" htmlFor="dl-from" width={150}>
            <DateInput
              id="dl-from"
              value={dateFrom}
              onChange={setDateFrom}
              invalid={rangeInverted}
            />
          </Field>

          <Field label="기간 종료" htmlFor="dl-to" width={150}>
            <DateInput id="dl-to" value={dateTo} onChange={setDateTo} invalid={rangeInverted} />
          </Field>

          <Field label="공급사" htmlFor="dl-sup" width={190}>
            <Select
              id="dl-sup"
              value={supplier}
              onChange={setSupplier}
              options={supplierOptions}
              disabled={suppliers.loading || suppliers.error !== null}
              width={190}
            />
          </Field>

          <Field label="형식" width={180}>
            <div style={{ display: "flex", alignItems: "center", gap: 14, height: 34 }}>
              {(["csv", "xlsx"] as const).map((f) => (
                <label
                  key={f}
                  style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12.5, color: T.text }}
                >
                  <input
                    type="radio"
                    name="dl-format"
                    checked={format === f}
                    onChange={() => setFormat(f)}
                  />
                  {f === "csv" ? "CSV" : "Excel"}
                </label>
              ))}
            </div>
          </Field>
        </FilterBar>

        {rangeInverted && (
          <span style={{ fontSize: 11.5, color: T.error }}>종료일이 시작일보다 빠릅니다</span>
        )}
        {suppliers.error && <InlineError message={suppliers.error} onRetry={suppliers.refetch} />}
      </Section>

      <Section title="내보내기">
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 20,
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: T.textSub }}>예상 행 수</span>
            <strong style={{ fontSize: 22, fontWeight: 700, color: T.text }}>
              {rangeInverted
                ? "—"
                : estimate.loading
                  ? "…"
                  : estimate.error
                    ? "—"
                    : rowCount !== null
                      ? `${rowCount.toLocaleString()}건`
                      : "—"}
            </strong>
            {estimate.error && (
              <span
                style={{ fontSize: 11.5, color: T.error, maxWidth: 320, lineHeight: 1.5 }}
                title={estimate.error}
              >
                행 수를 확인하지 못했습니다 — {estimate.error}
              </span>
            )}
          </div>

          <div style={{ flex: 1 }} />

          <button
            type="button"
            className="btn btn-primary"
            disabled={!canExport}
            onClick={() => void run()}
            style={{ height: 38, minWidth: 120 }}
          >
            {progress === "running" ? "생성 중…" : "내보내기"}
          </button>
        </div>

        {overLimit && (
          <Notice tone="warn">
            예상 행 수가 상한({MAX_ROWS.toLocaleString()}건)을 초과했습니다. 기간이나 공급사를
            좁혀 주세요.
          </Notice>
        )}
        {noRows && !estimate.loading && (
          <Notice tone="warn">조건에 맞는 데이터가 없습니다.</Notice>
        )}

        <span style={{ fontSize: 11, color: T.textMuted, lineHeight: 1.6 }}>
          ⓘ 파일은 서버가 생성해 스트리밍합니다. 대용량일 수 있어 이 요청에는 타임아웃을 두지
          않으며, 생성 중 취소는 지원하지 않습니다 (서버 중단 계약이 없습니다). 다운로드 이력은
          기록되지 않습니다 — 조회(GET)는 감사 로그 대상이 아닙니다.
        </span>
      </Section>
    </PageShell>
  );
}
