"use client";

/**
 * FE-RT-34 — 데이터 조회 · `/data/query` · FR-DT-02 (필수)
 *
 * 명세: `specs/plan-g3.md` FE-RT-34. 와이어프레임 없음(SF-TD3 §3).
 * 저장 테이블: `lots`/`components`/`quality`. **CR-DB-001 무관, 501 아님.**
 * *"이 화면은 16화면 중 계약이 가장 온전한 축이다"* — **계약 누락 0건.**
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * 🔴 **1순위 수용 기준: 날짜 범위가 실제로 서버 쿼리에 반영된다.**
 *
 * 개편 전 결함: `startDate`/`endDate` state 가 존재하는데 `handleQuery()` 안에서
 * **전혀 사용되지 않았다** (`page.tsx:184-201` 은 `supplier`·`lotNo` 만 필터).
 * 사용자가 기간을 바꿔도 결과가 그대로였다 — 조용한 실패다.
 * 지금은 `date_from`/`date_to` 를 **쿼리 파라미터로 전송**한다.
 *
 * 그 밖에 고친 것:
 *   - 데이터 유형 5종(성분분석/입고이력/품질검사/공정실적/출하이력)
 *     → 계약 화이트리스트 **3종**(`lots`/`components`/`quality`).
 *     입고·출하·공정은 각자의 화면(FE-RT-06/07·16·21)이 담당한다
 *   - 열 정의 하드코딩(`COLUMNS_MAP`) → **응답 `columns` 로 동적 생성**
 *     (api-contract §8.9: *"`columns` 를 같이 내려주면 테이블 헤더를 하드코딩하지
 *     않아도 된다"*)
 *   - mock 25행 5배열 삭제 → `GET /data/query` 실 연동
 *   - 공급사 **자유 텍스트 입력** → `GET /suppliers?active=true` 기반 드롭다운.
 *     mock 에 있던 `SUP_D` 는 존재하지 않는 공급사다 (`BUG-002` 재발 패턴)
 *   - 페이지네이션 신설 (전건을 한 번에 렌더링하던 것)
 *   - CSV/Excel 버튼에 `onClick` 이 없던 것 → `exportData()` 연결.
 *     **`<a href>`·`window.location` 을 쓰지 않는다 — 인증 헤더가 안 붙는다**
 *   - `toFixed(2)` 일괄 → DB 정의 기반 자릿수 (성분 3자리 등, §4)
 * ══════════════════════════════════════════════════════════════════════════════
 */

import { useCallback, useMemo, useState } from "react";
import { exportData, getDataQuery, getSuppliers } from "@/lib/koryo-api";
import type { DataColumn, ExportFormat, QueryEntity } from "@/types/api";
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
  TextInput,
} from "../../_g1/ui";
import { Chips, Notice, cell, errText, useApi } from "../../_g3/ui";

/** api-contract §8.9 화이트리스트 — **임의 테이블명·SQL 조각 전송 금지** (NFR-S-05) */
const ENTITIES: { value: QueryEntity; label: string }[] = [
  { value: "lots", label: "LOT" },
  { value: "components", label: "성분" },
  { value: "quality", label: "품질" },
];

/**
 * 소수 자릿수 — **DB 정의에서 유도한다** (db-schema §3.1·3.2·3.4).
 * 성분/편차 `DECIMAL(6,3)` → 3자리 · 품질점수 `DECIMAL(5,2)` → 2자리 ·
 * 온도 `DECIMAL(5,1)` → 1자리 · `time_min INTEGER` → 0자리.
 */
const DIGITS: Record<string, number> = {
  sn_ratio: 3, ag_ratio: 3, cu_ratio: 3, pb_ratio: 3,
  sn: 3, ag: 3, cu: 3, pb: 3,
  sn_deviation: 3, ag_deviation: 3, cu_deviation: 3,
  quality_score: 2, score: 2,
  temperature: 1,
  time_min: 0,
};

const UNITS: Record<string, string> = {
  sn_ratio: "%", ag_ratio: "%", cu_ratio: "%", pb_ratio: "%",
  sn: "%", ag: "%", cu: "%", pb: "%",
  sn_deviation: "%", ag_deviation: "%", cu_deviation: "%",
  quality_score: "점", score: "점",
  temperature: "°C",
  time_min: "분",
};

const SIGNED = new Set(["sn_deviation", "ag_deviation", "cu_deviation"]);

function formatCell(col: DataColumn, raw: unknown): string {
  if (raw === null || raw === undefined) return "—";
  if (typeof raw === "number" && Number.isFinite(raw)) {
    const d = DIGITS[col.key];
    if (d === undefined) return String(raw);
    const s = raw.toFixed(d);
    const withSign = SIGNED.has(col.key) && raw > 0 ? `+${s}` : s;
    const unit = UNITS[col.key];
    return unit ? `${withSign}${unit === "%" || unit === "°C" ? "" : " "}${unit}` : withSign;
  }
  return cell(raw);
}

interface Form {
  entity: QueryEntity;
  dateFrom: string;
  dateTo: string;
  supplier: string;
  lotId: string;
  pageSize: number;
}

const INITIAL: Form = {
  entity: "lots",
  dateFrom: "",
  dateTo: "",
  supplier: "",
  lotId: "",
  pageSize: 50,
};

export default function DataQueryPage() {
  const [form, setForm] = useState<Form>(INITIAL);
  /** `null` = 아직 조회 전. 안내 EmptyState 를 유지한다 (§9) */
  const [applied, setApplied] = useState<Form | null>(null);
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState<ExportFormat | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  /** 공급사 선택지 — **서버 응답으로 만든다.** `SUP_A/B/C` 를 하드코딩하지 않는다 */
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

  const rangeInverted =
    form.dateFrom !== "" && form.dateTo !== "" && form.dateFrom > form.dateTo;
  const lotTooLong = form.lotId.trim().length > 20; // `lots.lot_id VARCHAR(20)`

  const state = useApi(
    () =>
      applied
        ? getDataQuery(applied.entity, {
            page,
            page_size: applied.pageSize,
            // 🔴 여기가 개편의 핵심이다 — 날짜가 **실제로 서버로 간다**
            date_from: applied.dateFrom || undefined,
            date_to: applied.dateTo || undefined,
            supplier: applied.supplier || undefined,
            lot_id: applied.lotId.trim() || undefined,
          })
        : Promise.reject(new Error("조회 전")),
    [applied ? JSON.stringify(applied) : "", page],
    applied !== null
  );

  const columns = state.data?.columns ?? [];
  const rows = useMemo(() => state.data?.items ?? [], [state.data]);
  const total = state.data?.total ?? 0;

  const runQuery = () => {
    setApplied({ ...form });
    setPage(1);
  };

  const reset = () => {
    setForm(INITIAL);
    setApplied(null);
    setPage(1);
    setNotice(null);
  };

  /**
   * 🔴 **`exportData()` 를 쓴다.** `<a href>` / `window.location` 은
   * `Authorization: Bearer` 헤더를 붙일 수 없다 (api-contract §3.1 · §8.9).
   * 파일명은 서버 `Content-Disposition` 에서 파싱한 값을 그대로 쓴다.
   */
  const download = useCallback(
    async (format: ExportFormat) => {
      const q = applied ?? form;
      setExporting(format);
      setNotice(null);
      try {
        const file = await exportData(q.entity, format, {
          date_from: q.dateFrom || undefined,
          date_to: q.dateTo || undefined,
          supplier: q.supplier || undefined,
        });
        const url = URL.createObjectURL(file.blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = file.filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        setNotice({ tone: "ok", text: `${file.filename} 을(를) 내려받았습니다.` });
      } catch (err) {
        const msg = errText(err);
        setNotice({
          tone: "error",
          text: /422/.test(msg)
            ? "내보낼 수 있는 최대 행 수(100,000)를 초과했습니다. 기간을 좁혀 주세요."
            : msg,
        });
      } finally {
        setExporting(null);
      }
    },
    [applied, form]
  );

  return (
    <PageShell>
      <PageHeader title="데이터 조회" subtitle="유형별 조건 검색 및 결과 조회" />

      {notice && <Notice tone={notice.tone === "ok" ? "ok" : "error"}>{notice.text}</Notice>}

      <Section title="조회 조건">
        <Chips
          value={form.entity}
          onChange={(v) => setForm((f) => ({ ...f, entity: v as QueryEntity }))}
          options={ENTITIES}
        />

        <FilterBar>
          <Field label="기간 시작" htmlFor="q-from" width={150}>
            <DateInput
              id="q-from"
              value={form.dateFrom}
              onChange={(v) => setForm((f) => ({ ...f, dateFrom: v }))}
              invalid={rangeInverted}
            />
          </Field>

          <Field label="기간 종료" htmlFor="q-to" width={150}>
            <DateInput
              id="q-to"
              value={form.dateTo}
              onChange={(v) => setForm((f) => ({ ...f, dateTo: v }))}
              invalid={rangeInverted}
            />
          </Field>

          <Field label="공급사" htmlFor="q-sup" width={190}>
            <Select
              id="q-sup"
              value={form.supplier}
              onChange={(v) => setForm((f) => ({ ...f, supplier: v }))}
              options={supplierOptions}
              disabled={suppliers.loading || suppliers.error !== null}
              width={190}
            />
          </Field>

          <Field label="LOT 번호" htmlFor="q-lot" width={170}>
            <TextInput
              id="q-lot"
              value={form.lotId}
              onChange={(v) => setForm((f) => ({ ...f, lotId: v }))}
              invalid={lotTooLong}
              placeholder="LOT-2026-001"
            />
          </Field>

          <Field label="페이지 크기" htmlFor="q-size" width={120}>
            <Select
              id="q-size"
              value={String(form.pageSize)}
              onChange={(v) => setForm((f) => ({ ...f, pageSize: Number(v) }))}
              options={PAGE_SIZE_OPTIONS}
              width={120}
            />
          </Field>

          <button
            type="button"
            className="btn btn-primary"
            disabled={rangeInverted || lotTooLong || state.loading}
            onClick={runQuery}
            style={{ height: 34 }}
          >
            {state.loading ? "조회 중…" : "조회"}
          </button>
          <button type="button" className="btn" onClick={reset} style={{ height: 34 }}>
            초기화
          </button>
        </FilterBar>

        {rangeInverted && (
          <span style={{ fontSize: 11.5, color: T.error }}>종료일이 시작일보다 빠릅니다</span>
        )}
        {lotTooLong && (
          <span style={{ fontSize: 11.5, color: T.error }}>LOT 번호는 20자를 넘을 수 없습니다</span>
        )}
        {suppliers.error && (
          <InlineError message={suppliers.error} onRetry={suppliers.refetch} />
        )}
      </Section>

      <Section
        title={`조회 결과${applied ? ` (${state.loading || state.error ? "—" : total.toLocaleString()}건)` : ""}`}
        right={
          <div style={{ display: "flex", gap: 6 }}>
            <button
              type="button"
              className="btn"
              disabled={exporting !== null || rangeInverted}
              onClick={() => void download("csv")}
            >
              {exporting === "csv" ? "생성 중…" : "CSV 다운로드"}
            </button>
            <button
              type="button"
              className="btn"
              disabled={exporting !== null || rangeInverted}
              onClick={() => void download("xlsx")}
            >
              {exporting === "xlsx" ? "생성 중…" : "Excel 다운로드"}
            </button>
          </div>
        }
      >
        {applied === null && <Center>조회 조건을 설정하고 조회 버튼을 눌러주세요.</Center>}

        {applied !== null && state.error && (
          <InlineError message={state.error} onRetry={state.refetch} />
        )}

        {applied !== null && state.loading && <Center>불러오는 중…</Center>}

        {applied !== null && !state.loading && !state.error && rows.length === 0 && (
          <Center>조건에 맞는 데이터가 없습니다.</Center>
        )}

        {applied !== null && !state.loading && !state.error && rows.length > 0 && (
          <>
            <div style={{ overflowX: "auto", border: `1px solid ${T.border}`, borderRadius: 12 }}>
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: 12.5,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                <thead>
                  <tr style={{ background: "#F8F9FB" }}>
                    {/* 🔴 헤더는 응답 `columns` 로 만든다. 하드코딩 상수가 없다 */}
                    {columns.map((c) => (
                      <th
                        key={c.key}
                        style={{
                          padding: "10px 12px",
                          fontSize: 12,
                          fontWeight: 600,
                          color: T.textSub,
                          textAlign: c.type === "number" ? "right" : "left",
                          whiteSpace: "nowrap",
                          borderBottom: `1px solid ${T.border}`,
                        }}
                      >
                        {c.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => (
                    <tr key={i} style={{ borderTop: `1px solid ${T.border}` }}>
                      {columns.map((c) => (
                        <td
                          key={c.key}
                          style={{
                            padding: "9px 12px",
                            color: T.text,
                            textAlign: c.type === "number" ? "right" : "left",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {formatCell(c, row[c.key])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <Pagination
              page={page}
              pageSize={applied.pageSize}
              total={total}
              onPage={setPage}
            />
          </>
        )}
      </Section>
    </PageShell>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        minHeight: 200,
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
