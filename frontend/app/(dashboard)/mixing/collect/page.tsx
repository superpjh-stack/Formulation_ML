"use client";

/**
 * FE-RT-11 — 학습 데이터 수집 · `/mixing/collect` · FR-M-01
 *
 * 명세: `specs/plan-g1.md` FE-RT-11 · 계약 `api-contract.md` §8.4 · §8.4.4.
 * **SF-TD3 에 와이어프레임 없음** — 구성은 `GET /training-data` 응답(`Page<TrainingRowDto>` +
 * `summary` 5값)과 `POST /training-data/upload` 응답 3필드에서 도출했다.
 *
 * 라운드 2 에서 고친 것:
 *   - 🚨 **주제 교정.** 현 화면은 "LOT별 성분 측정값 입력"(= FE-RT-08 FR-R-03 의 주제)이었다.
 *     FR-M-01 은 **학습 데이터 CSV 업로드 및 관리**다.
 *   - 🚨 `setTimeout(800)` 후 `setRows()` 하는 **가짜 저장 제거.** 새로고침하면 사라지는 저장은
 *     저장이 아니다 (goal.md 3절).
 *   - 🚨 **CSV 업로드 신규 구현** — FR-M-01 이 명시한 제약이고 이 화면의 존재 이유다.
 *     `rejected > 0` 이면 거부 행 전체를 보여주고 모달을 자동으로 닫지 않는다.
 *   - `INITIAL_DATA`(8행) · `WEEKLY_SPARKLINE` · `EMPTY_FORM` · `STATUS_CONFIG` 제거
 *   - 단건 입력 모달 제거 — 대응 엔드포인트가 없다. 단건 성분 등록은 **FE-RT-08 `POST /components`**
 *   - 프론트 이상치 판정(`sn>3` / `ag>0.5` / `total>1`) 제거 → 거부 판정은 **서버 `errors[]`** 가 한다.
 *     화면은 계약 경계를 **표시만** 한다 (학습 데이터는 이상치도 보관 대상이다)
 *   - 성분 입력 범위 `50~75 / 0~10 / 0~3 / 20~50` → `COMPONENT_BOUNDS` (55~70 / 1~5 / 0.1~1.5 / 25~45)
 *   - 합계 판정 `<0.5` → **`<=0.05`** (goal.md 2.3)
 *   - `SUP_D` 제거 · 측정자(`operator`) 열 제거 (DB 컬럼 없음)
 *
 * ⚠ 필드명 주의: `TrainingRowDto` 는 **ML 파이프라인 규약**(`sn_pct`/`melt_temp_c`/`melt_time_min`)이다.
 *   `lots` 컬럼명(`sn_ratio`/`temperature`/`time_min`)과 다르고 **서버가 매핑한다** (api-contract §8.4.4).
 */

import { useCallback, useMemo, useRef, useState } from "react";
import { KpiCard } from "@/components/ui/KpiCard";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Modal } from "@/components/ui/Modal";
import { ErrorAlert } from "@/components/ui/ErrorAlert";
import { Spinner } from "@/components/ui/Spinner";
import { T } from "@/components/ui/tokens";
import { useTrainingData, usePublicSettings } from "@/hooks/useKoryoData";
import { uploadTrainingData, ApiError } from "@/lib/koryo-api";
import { passScoreOf } from "@/lib/quality";
import { COMPONENT_BOUNDS, MELT_TEMP_RANGE } from "@/types/api";
import type { SupplierCode, TrainingRowDto, TrainingUploadResult } from "@/types/api";
import {
  DASH,
  Field,
  FilterBar,
  PAGE_SIZE_OPTIONS,
  PageHeader,
  PageShell,
  Pagination,
  ScreenError,
  Section,
  SectionState,
  Select,
  SUPPLIER_FILTER_OPTIONS,
  SettingsFallbackBanner,
  DateInput,
  hasRole,
  int,
  num,
  useRole,
} from "../../_g1/ui";

/** goal.md 2.3 — 배합 합계 허용 오차. 화면 어디에도 다시 쓰지 않는다 */
const SUM_TOLERANCE = 0.05;

/**
 * 업로드 CSV 필요 컬럼 — `TrainingRowDto` 실 필드명 그대로다 (api-contract §8.4.4).
 * 표 헤더와 안내 문구가 같은 배열을 보므로 두 곳이 어긋날 수 없다.
 */
const CSV_COLUMNS = [
  "lot_id",
  "date",
  "supplier_code",
  "sn_pct",
  "ag_pct",
  "cu_pct",
  "pb_pct",
  "melt_temp_c",
  "melt_time_min",
  "quality_score",
] as const;

// ── 셀 ────────────────────────────────────────────────────────────────────────

/**
 * 성분 셀. **경계를 벗어나면 Warning 으로 표시만 한다 — 거부하지 않는다.**
 * 경계값은 `COMPONENT_BOUNDS`(계약 정본)에서 오고 TSX 에 숫자를 쓰지 않는다.
 */
function BoundedCell({
  value,
  bounds,
  digits,
}: {
  value: number | null | undefined;
  bounds: readonly [number, number];
  digits: number;
}) {
  const out =
    value !== null && value !== undefined && Number.isFinite(value)
      ? value < bounds[0] || value > bounds[1]
      : false;
  return (
    <span
      title={out ? `허용 범위 ${bounds[0]} ~ ${bounds[1]} 밖 (표시만 — 학습 데이터는 보관 대상)` : undefined}
      style={{
        fontVariantNumeric: "tabular-nums",
        color: out ? T.warning : T.text,
        fontWeight: out ? 600 : 400,
      }}
    >
      {num(value, digits)}
    </span>
  );
}

// ── 페이지 ────────────────────────────────────────────────────────────────────

export default function CollectPage() {
  const role = useRole();
  const settings = usePublicSettings();
  const passScore = passScoreOf(settings.data?.settings);

  // 기간 기본값은 **비움(전체)** — 최근 N일로 자르면 `summary.rows` 와 표의 `total` 이 어긋나
  // "학습 데이터가 2,000건인데 표에는 30건" 처럼 읽힌다 (plan-g1 FE-RT-11 §4).
  const [supplier, setSupplier] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [pageSize, setPageSize] = useState(50);
  const [page, setPage] = useState(1);

  const rangeInverted = dateFrom !== "" && dateTo !== "" && dateFrom > dateTo;

  const query = useMemo(
    () => ({
      page,
      page_size: pageSize,
      supplier: (supplier || undefined) as SupplierCode | undefined,
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
    }),
    [page, pageSize, supplier, dateFrom, dateTo]
  );

  const { data, loading, error, refetch } = useTrainingData(rangeInverted ? {} : query);

  const rows = data?.items ?? [];
  const summary = data?.summary ?? null;
  const hasRows = (summary?.rows ?? 0) > 0;

  // ── 필터 변경 시 page 를 1 로 되돌린다 ────────────────────────────────────
  const resetPage = useCallback(<A,>(setter: (v: A) => void) => (v: A) => {
    setter(v);
    setPage(1);
  }, []);

  const clearFilters = () => {
    setSupplier("");
    setDateFrom("");
    setDateTo("");
    setPage(1);
  };

  // ── 표 열 ─────────────────────────────────────────────────────────────────
  const columns: Column<TrainingRowDto>[] = useMemo(
    () => [
      { key: "lot_id", header: "LOT ID", width: 150 },
      { key: "date", header: "날짜", width: 110 },
      { key: "supplier_code", header: "공급사", width: 90 },
      {
        key: "sn_pct",
        header: "Sn",
        width: 90,
        align: "right",
        render: (_v, r) => <BoundedCell value={r.sn_pct} bounds={COMPONENT_BOUNDS.sn} digits={3} />,
      },
      {
        key: "ag_pct",
        header: "Ag",
        width: 90,
        align: "right",
        render: (_v, r) => <BoundedCell value={r.ag_pct} bounds={COMPONENT_BOUNDS.ag} digits={3} />,
      },
      {
        key: "cu_pct",
        header: "Cu",
        width: 90,
        align: "right",
        render: (_v, r) => <BoundedCell value={r.cu_pct} bounds={COMPONENT_BOUNDS.cu} digits={3} />,
      },
      {
        key: "pb_pct",
        header: "Pb",
        width: 90,
        align: "right",
        render: (_v, r) => <BoundedCell value={r.pb_pct} bounds={COMPONENT_BOUNDS.pb} digits={3} />,
      },
      {
        key: "sum",
        header: "합계",
        width: 96,
        align: "right",
        render: (_v, r) => {
          const sum = r.sn_pct + r.ag_pct + r.cu_pct + r.pb_pct;
          const bad = Math.abs(sum - 100) > SUM_TOLERANCE;
          return (
            <span
              title={bad ? `성분 합계는 100%여야 한다 (허용 오차 ±${SUM_TOLERANCE})` : undefined}
              style={{
                fontVariantNumeric: "tabular-nums",
                color: bad ? T.error : T.text,
                fontWeight: bad ? 700 : 400,
              }}
            >
              {bad ? "⚠ " : ""}
              {num(sum, 1)}
            </span>
          );
        },
      },
      {
        key: "melt_temp_c",
        header: "용해 온도",
        width: 100,
        align: "right",
        render: (_v, r) => (
          <BoundedCell value={r.melt_temp_c} bounds={MELT_TEMP_RANGE} digits={1} />
        ),
      },
      {
        key: "melt_time_min",
        header: "처리 시간",
        width: 92,
        align: "right",
        render: (_v, r) => (
          <span style={{ fontVariantNumeric: "tabular-nums" }}>{int(r.melt_time_min)}</span>
        ),
      },
      {
        key: "quality_score",
        header: "품질 점수",
        width: 100,
        align: "right",
        render: (_v, r) => {
          // 합격선은 `/settings/public` 값이다. `70` 을 여기 쓰지 않는다.
          const below =
            r.quality_score !== null && Number.isFinite(r.quality_score)
              ? r.quality_score < passScore
              : false;
          return (
            <span
              style={{
                fontVariantNumeric: "tabular-nums",
                color: below ? T.error : T.text,
                fontWeight: below ? 600 : 400,
              }}
            >
              {num(r.quality_score, 2)}
            </span>
          );
        },
      },
      {
        key: "used_in_training",
        header: "학습 사용",
        width: 92,
        align: "center",
        render: (_v, r) =>
          r.used_in_training ? (
            <StatusBadge variant="green" label="사용" />
          ) : (
            <StatusBadge variant="gray" label="미사용" />
          ),
      },
    ],
    [passScore]
  );

  // ── 업로드 모달 ───────────────────────────────────────────────────────────
  const [uploadOpen, setUploadOpen] = useState(false);
  const canUpload = hasRole(role, "admin", "manufacture");

  if (error && !rangeInverted) {
    return <ScreenError message={error} onRetry={refetch} />;
  }

  return (
    <PageShell>
      <PageHeader
        title="학습 데이터 수집"
        subtitle="과거 배합 이력(성분·공정 조건·품질 점수) 업로드 및 관리 — CSV 형식 (FR-M-01)"
        actions={
          <button
            type="button"
            className="btn pri"
            disabled={!canUpload}
            onClick={() => setUploadOpen(true)}
            title={canUpload ? undefined : "admin · manufacture 만 업로드할 수 있습니다"}
          >
            CSV 업로드
          </button>
        }
      />

      <SettingsFallbackBanner settings={settings.data} />

      {/* 요약 5값 — `summary` 응답 그대로. 2000·86.15·9.70 같은 리터럴은 쓰지 않는다 */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 16,
        }}
      >
        <KpiCard label="총 학습 데이터" value={hasRows ? int(summary?.rows) : DASH} unit="건" />
        <KpiCard label="데이터 시작일" value={hasRows ? (summary?.date_min ?? DASH) : DASH} />
        <KpiCard label="데이터 종료일" value={hasRows ? (summary?.date_max ?? DASH) : DASH} />
        <KpiCard
          label="품질 평균"
          value={hasRows ? num(summary?.quality_mean, 2) : DASH}
          unit="점"
        />
        <KpiCard
          label="품질 표준편차"
          value={hasRows ? num(summary?.quality_std, 2) : DASH}
          unit="점"
        />
      </div>

      {/* 필터 — 서버 쿼리다. 클라이언트 filter() 를 하지 않는다 */}
      <FilterBar>
        <Field label="공급사" htmlFor="f-supplier" width={140}>
          <Select
            id="f-supplier"
            value={supplier}
            onChange={resetPage(setSupplier)}
            options={SUPPLIER_FILTER_OPTIONS}
            width={140}
          />
        </Field>
        <Field label="시작일" htmlFor="f-from" width={150}>
          <DateInput id="f-from" value={dateFrom} onChange={resetPage(setDateFrom)} invalid={rangeInverted} />
        </Field>
        <Field label="종료일" htmlFor="f-to" width={150}>
          <DateInput id="f-to" value={dateTo} onChange={resetPage(setDateTo)} invalid={rangeInverted} />
        </Field>
        <Field label="표시 개수" htmlFor="f-size" width={120}>
          <Select
            id="f-size"
            value={String(pageSize)}
            onChange={resetPage((v: string) => setPageSize(Number(v)))}
            options={PAGE_SIZE_OPTIONS}
            width={120}
          />
        </Field>
        <button type="button" className="btn" onClick={clearFilters}>
          필터 초기화
        </button>
        {rangeInverted && (
          <span style={{ fontSize: 12, color: T.error, fontWeight: 600, alignSelf: "center" }}>
            종료일이 시작일보다 앞섭니다 — 조회를 보내지 않았습니다
          </span>
        )}
        <span style={{ marginLeft: "auto", fontSize: 11.5, color: T.textMuted, alignSelf: "center" }}>
          기간을 비우면 전체 기간이 조회됩니다
        </span>
      </FilterBar>

      <Section
        title="학습 데이터 목록"
        right={
          <span style={{ fontSize: 11.5, color: T.textMuted }}>
            경계를 벗어난 값은 <span style={{ color: T.warning, fontWeight: 600 }}>표시만</span>{" "}
            합니다 — 거부 판정은 업로드 시 서버가 합니다
          </span>
        }
      >
        <SectionState
          loading={loading}
          error={rangeInverted ? null : error}
          empty={rows.length === 0}
          emptyText="학습 데이터가 없습니다 — CSV 업로드로 추가하세요"
          onRetry={refetch}
          minHeight={220}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <DataTable
              columns={columns}
              data={rows}
              rowKey={(r) => r.lot_id}
              stickyHeader
              emptyText="학습 데이터가 없습니다"
            />
            <Pagination
              page={data?.page ?? page}
              pageSize={data?.page_size ?? pageSize}
              total={data?.total ?? 0}
              onPage={setPage}
            />
          </div>
        </SectionState>
      </Section>

      <UploadModal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onApplied={() => {
          setPage(1);
          refetch();
        }}
      />
    </PageShell>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// CSV 업로드 모달 — 결과 리포트가 이 화면에서 가장 중요한 UI 다
// ══════════════════════════════════════════════════════════════════════════════

function UploadModal({
  open,
  onClose,
  onApplied,
}: {
  open: boolean;
  onClose: () => void;
  onApplied: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<TrainingUploadResult | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const isCsv = file !== null && /\.csv$/i.test(file.name);

  function reset() {
    setFile(null);
    setResult(null);
    setFailure(null);
    setBusy(false);
    if (inputRef.current) inputRef.current.value = "";
  }

  function close() {
    reset();
    onClose();
  }

  async function handleUpload() {
    if (!file || !isCsv) return;
    setBusy(true);
    setFailure(null);
    setResult(null);
    try {
      // 🔴 실제 요청이다. 성공 표시는 서버가 응답한 뒤에만 한다.
      const res = await uploadTrainingData(file);
      setResult(res);
      // 거부가 없으면 곧바로 목록을 갱신한다. 거부가 있으면 사용자가 리포트를 확인한 뒤에 갱신한다.
      if (res.rejected === 0) onApplied();
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 0;
      const detail = err instanceof Error ? err.message : "업로드에 실패했습니다";
      setFailure(
        status === 422
          ? `CSV 형식이 올바르지 않습니다 — ${detail}`
          : status === 403
            ? "접근 권한이 없습니다"
            : detail
      );
    } finally {
      setBusy(false);
    }
  }

  /** 거부 행을 클라이언트에서 CSV 로 만든다 (서버 왕복 없음) */
  function downloadRejected() {
    if (!result || result.errors.length === 0) return;
    const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
    const body = result.errors.map((e) => `${e.row},${esc(e.message)}`).join("\r\n");
    // BOM — Excel 이 UTF-8 한글을 깨뜨리지 않게 한다
    const blob = new Blob([`﻿행,오류 내용\r\n${body}\r\n`], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `training-upload-rejected-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const hasRejected = result !== null && result.rejected > 0;

  return (
    <Modal
      open={open}
      onClose={close}
      title="학습 데이터 CSV 업로드"
      description="FR-M-01 — CSV 형식만 지원합니다"
      width={620}
      // 결과 리포트를 보는 중에는 실수로 닫히지 않게 한다
      closeOnOverlayClick={!busy && !hasRejected}
      closeOnEsc={!busy}
      footerVariant="surface"
      footer={
        result ? (
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            {hasRejected && (
              <button type="button" className="btn" onClick={downloadRejected}>
                CSV로 저장
              </button>
            )}
            <button
              type="button"
              className="btn pri"
              onClick={() => {
                if (hasRejected) onApplied();
                close();
              }}
            >
              확인
            </button>
          </div>
        ) : (
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button type="button" className="btn" onClick={close} disabled={busy}>
              취소
            </button>
            <button
              type="button"
              className="btn pri"
              onClick={handleUpload}
              disabled={!isCsv || busy}
            >
              {busy ? "업로드 중…" : "업로드"}
            </button>
          </div>
        )
      }
    >
      {result ? (
        <UploadReport result={result} />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {failure && <ErrorAlert message={failure} />}

          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: T.textSub }}>CSV 파일</span>
            <input
              ref={inputRef}
              type="file"
              accept=".csv"
              disabled={busy}
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setFailure(null);
              }}
              style={{ fontSize: 12.5 }}
            />
          </label>

          {file && !isCsv && (
            <span style={{ fontSize: 12, color: T.error, fontWeight: 600 }}>
              `.csv` 파일만 업로드할 수 있습니다 (선택한 파일: {file.name})
            </span>
          )}

          {busy && (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Spinner size="sm" />
              <span style={{ fontSize: 12.5, color: T.textSub }}>
                서버가 파일을 검증하는 중입니다. 행 수에 따라 몇 초 걸릴 수 있습니다.
              </span>
            </div>
          )}

          <div
            style={{
              padding: "12px 14px",
              borderRadius: 8,
              background: T.surfaceSubtle,
              border: `1px solid ${T.border}`,
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 600, color: T.text, marginBottom: 6 }}>
              필요 컬럼 ({CSV_COLUMNS.length}개)
            </div>
            <code
              style={{
                fontSize: 11.5,
                lineHeight: 1.8,
                color: T.textSub,
                wordBreak: "break-all",
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              }}
            >
              {CSV_COLUMNS.join(", ")}
            </code>
            <div style={{ fontSize: 11, color: T.textMuted, marginTop: 8, lineHeight: 1.6 }}>
              성분 합계는 100%(허용 오차 ±{SUM_TOLERANCE})여야 하며, `quality_score` 가 빈 행은
              학습에 쓰이지 않습니다. 최종 검증은 서버가 하고 거부 사유를 행 단위로 돌려줍니다.
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

function UploadReport({ result }: { result: TrainingUploadResult }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", gap: 24 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
          <span style={{ fontSize: 13, color: T.textSub }}>✅ 반영</span>
          <strong
            style={{ fontSize: 22, fontWeight: 800, color: "#15803D", fontVariantNumeric: "tabular-nums" }}
          >
            {int(result.accepted)}
          </strong>
          <span style={{ fontSize: 12, color: T.textMuted }}>건</span>
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
          <span style={{ fontSize: 13, color: T.textSub }}>❌ 거부</span>
          <strong
            style={{
              fontSize: 22,
              fontWeight: 800,
              color: result.rejected > 0 ? "#B91C1C" : T.textMuted,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {int(result.rejected)}
          </strong>
          <span style={{ fontSize: 12, color: T.textMuted }}>건</span>
        </div>
      </div>

      {result.rejected > 0 ? (
        <>
          <div style={{ fontSize: 12, fontWeight: 600, color: T.text }}>
            거부 행 ({result.errors.length.toLocaleString()}건)
          </div>
          {/* 전체 목록을 보여준다 — 잘라내면 사용자가 무엇이 빠졌는지 알 수 없다 */}
          <div
            style={{
              maxHeight: 260,
              overflowY: "auto",
              border: `1px solid ${T.border}`,
              borderRadius: 8,
            }}
          >
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: T.surfaceSubtle }}>
                  <th
                    style={{
                      padding: "8px 12px",
                      textAlign: "right",
                      width: 70,
                      fontSize: 11,
                      fontWeight: 600,
                      color: T.textSub,
                      borderBottom: `1px solid ${T.border}`,
                      position: "sticky",
                      top: 0,
                      background: T.surfaceSubtle,
                    }}
                  >
                    행
                  </th>
                  <th
                    style={{
                      padding: "8px 12px",
                      textAlign: "left",
                      fontSize: 11,
                      fontWeight: 600,
                      color: T.textSub,
                      borderBottom: `1px solid ${T.border}`,
                      position: "sticky",
                      top: 0,
                      background: T.surfaceSubtle,
                    }}
                  >
                    오류 내용
                  </th>
                </tr>
              </thead>
              <tbody>
                {result.errors.map((e, i) => (
                  <tr key={`${e.row}-${i}`} style={{ borderBottom: `1px solid ${T.border}` }}>
                    <td
                      style={{
                        padding: "7px 12px",
                        textAlign: "right",
                        color: T.textSub,
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {e.row}
                    </td>
                    <td style={{ padding: "7px 12px", color: T.text }}>{e.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <span style={{ fontSize: 11.5, color: T.textMuted }}>
            거부된 행은 저장되지 않았습니다. 사유를 고쳐 다시 업로드하세요.
          </span>
        </>
      ) : (
        <span style={{ fontSize: 12.5, color: T.textSub }}>
          거부된 행 없이 모두 반영되었습니다.
        </span>
      )}
    </div>
  );
}
