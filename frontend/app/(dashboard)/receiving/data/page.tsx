"use client";

/**
 * FE-RT-08 — 성분 데이터 관리 · `/receiving/data` · FR-R-03
 *
 * 명세: `specs/plan-g1.md` FE-RT-08 · 계약: `api-contract.md` §8.3 (G2) · db-schema §3.2.
 *
 * 🔴 **전면 재작성 — 주제가 달랐다.**
 *    현 구현은 "원자재 재고·입고금액 관리" 화면이었다. 재고 게이지 4종, 월별 입고량 캔버스
 *    차트, 단가/합계금액/검수자 열이 전부였고 **성분(Sn/Ag/Cu/Pb) 값이 화면에 하나도 없었다.**
 *    FR-R-03 은 "성분 분석 데이터 등록/조회 + 목표값 대비 편차 자동 계산" 이다.
 *
 * 라운드 2 에서 고친 것:
 *   - `STOCK` 4행 · `MOCK_RECEIVING` 10행 · `MONTHLY` 6행 · `MATERIAL_COLORS` 제거
 *   - `GET /components` (`useComponents`) 실 연동 + 서버 필터 4종 + `Page<T>` 페이징
 *   - **성분 4값 + 편차 3종 표시 신규** — 편차는 **서버 계산값**(`sn_deviation` 등)이다
 *   - **`POST /components` 등록 모달 신규** — 편차는 **요청 본문에 넣지 않는다**
 *   - 월별 입고량 차트 제거 (SN 기준으로 `AG×18`/`CU×25`/`PB×6` 임의 정규화 = 데이터 왜곡)
 *   - 단가·합계금액·검수자 제거 (DB 컬럼 없음) · `SUP_D` 제거
 *   - CSV 내보내기 연결 — `components` 는 `/data/export` 화이트리스트에 있다 (api-contract §8.9)
 *
 * 🔴 **편차 임계값을 화면에 하드코딩하지 않는다.** `usePublicSettings()` 의 `deviation_warn`
 *    을 `isDeviationWarning()` 에 넘긴다. 서버 값을 못 읽으면 상단 배너로 그 사실을 드러낸다.
 */

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { ErrorAlert } from "@/components/ui/ErrorAlert";
import { Modal } from "@/components/ui/Modal";
import { NumericField } from "@/components/ui/NumericField";
import { T } from "@/components/ui/tokens";
import { useComponents, usePublicSettings } from "@/hooks/useKoryoData";
import {
  ApiError,
  createComponent,
  exportData,
  type ComponentQuery,
} from "@/lib/koryo-api";
import { isDeviationWarning } from "@/lib/quality";
import { COMPONENT_BOUNDS } from "@/types/api";
import type { AnalysisMethod, ComponentDto, ComponentIn, SupplierCode } from "@/types/api";
import {
  DASH,
  DateInput,
  Field,
  FilterBar,
  PAGE_SIZE_OPTIONS,
  PageHeader,
  PageShell,
  Pagination,
  SUPPLIER_FILTER_OPTIONS,
  ScreenError,
  SectionState,
  Select,
  SettingsFallbackBanner,
  TextInput,
  dateTime,
  hasRole,
  num,
  signed,
  today,
  useRole,
  daysAgo,
} from "../../_g1/ui";

/** goal.md 2.3 — 성분 합계 허용 오차. 한 곳에만 둔다 */
const SUM_TOLERANCE = 0.05;

const ANALYSIS_METHODS: AnalysisMethod[] = ["XRF", "ICP", "AAS"];

const DEFAULT_DAYS = 90;

// ── 등록 폼 ──────────────────────────────────────────────────────────────────

interface ComponentForm {
  lot_id: string;
  date: string;
  sn: string;
  ag: string;
  cu: string;
  pb: string;
  analysis_method: AnalysisMethod;
}

/** 기본값 62.000 / 3.000 / 0.500 / 34.500 — 합계가 정확히 100.000 이다 */
function emptyForm(): ComponentForm {
  return {
    lot_id: "",
    date: today(),
    sn: "62.000",
    ag: "3.000",
    cu: "0.500",
    pb: "34.500",
    analysis_method: "XRF",
  };
}

function parse(v: string): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

function rangeError(v: number, [lo, hi]: readonly [number, number], unit = "%"): string | undefined {
  if (!Number.isFinite(v)) return "숫자를 입력하세요";
  if (v < lo || v > hi) return `허용 범위 ${lo} ~ ${hi}${unit} 를 벗어났습니다`;
  return undefined;
}

// ── 페이지 ────────────────────────────────────────────────────────────────────

export default function ComponentDataPage() {
  const role = useRole();
  // FE-RT-06/07 과 달리 **`quality` 도 쓰기 권한을 갖는다** — 성분 분석은 품질 업무다
  const canWrite = hasRole(role, "admin", "manufacture", "quality");

  const settings = usePublicSettings();
  const pub = settings.data?.settings ?? null;
  const snTarget = pub?.sn_target ?? 62.0;
  const agTarget = pub?.ag_target ?? 3.0;
  const cuTarget = pub?.cu_target ?? 0.5;

  const [draft, setDraft] = useState({
    lotId: "",
    supplier: "",
    dateFrom: daysAgo(DEFAULT_DAYS),
    dateTo: today(),
    pageSize: "50",
  });
  const [applied, setApplied] = useState(draft);
  const [page, setPage] = useState(1);

  const rangeInverted =
    draft.dateFrom !== "" && draft.dateTo !== "" && draft.dateFrom > draft.dateTo;

  const query: ComponentQuery = useMemo(
    () => ({
      page,
      page_size: Number(applied.pageSize),
      lot_id: applied.lotId || undefined,
      supplier: (applied.supplier || undefined) as SupplierCode | undefined,
      date_from: applied.dateFrom || undefined,
      date_to: applied.dateTo || undefined,
    }),
    [page, applied]
  );

  const { data, loading, error, refetch } = useComponents(query);
  const items = data?.items ?? [];

  function applyFilters() {
    if (rangeInverted) return;
    setApplied(draft);
    setPage(1);
  }

  function resetFilters() {
    const next = {
      lotId: "",
      supplier: "",
      dateFrom: daysAgo(DEFAULT_DAYS),
      dateTo: today(),
      pageSize: "50",
    };
    setDraft(next);
    setApplied(next);
    setPage(1);
  }

  // ── CSV 내보내기 ────────────────────────────────────────────────────────────
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  async function handleExport() {
    setExporting(true);
    setExportError(null);
    try {
      // 🔴 `<a href>` 로 받으면 인증 헤더가 안 붙는다 — `exportData()` 를 쓴다 (§8.9)
      const file = await exportData("components", "csv", {
        date_from: applied.dateFrom || undefined,
        date_to: applied.dateTo || undefined,
        supplier: applied.supplier || undefined,
      });
      const url = URL.createObjectURL(file.blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = file.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success(`${file.filename} 내려받기를 시작했습니다`);
    } catch (err) {
      // 실패를 삼키지 않는다
      setExportError(err instanceof Error ? err.message : "내보내기에 실패했습니다");
    } finally {
      setExporting(false);
    }
  }

  // ── 등록 모달 ───────────────────────────────────────────────────────────────
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<ComponentForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [lotIdError, setLotIdError] = useState<string | null>(null);

  const snV = parse(form.sn);
  const agV = parse(form.ag);
  const cuV = parse(form.cu);
  const pbV = parse(form.pb);

  const snErr = rangeError(snV, COMPONENT_BOUNDS.sn);
  const agErr = rangeError(agV, COMPONENT_BOUNDS.ag);
  const cuErr = rangeError(cuV, COMPONENT_BOUNDS.cu);
  const pbErr = rangeError(pbV, COMPONENT_BOUNDS.pb);

  const formSum = snV + agV + cuV + pbV;
  const sumOk = Number.isFinite(formSum) && Math.abs(formSum - 100) <= SUM_TOLERANCE;

  const canSave =
    canWrite &&
    !saving &&
    form.lot_id.trim() !== "" &&
    form.date !== "" &&
    !snErr &&
    !agErr &&
    !cuErr &&
    !pbErr &&
    sumOk;

  function openModal() {
    setForm(emptyForm());
    setFormError(null);
    setLotIdError(null);
    setModalOpen(true);
  }

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    setFormError(null);
    setLotIdError(null);
    try {
      // 🔴 편차 3종(`sn_deviation` 등)을 **보내지 않는다.** 서버가 계산해 저장한다 (§8.3)
      const body: ComponentIn = {
        lot_id: form.lot_id.trim(),
        date: form.date,
        sn: snV,
        ag: agV,
        cu: cuV,
        pb: pbV,
        analysis_method: form.analysis_method,
      };
      await createComponent(body);
      setModalOpen(false);
      refetch();
      toast.success("성분 데이터가 등록되었습니다");
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 0;
      const message = err instanceof Error ? err.message : "성분 등록에 실패했습니다";
      if (status === 404) {
        setLotIdError(`${form.lot_id.trim()} 을(를) 찾을 수 없습니다`);
      } else if (status === 422) {
        setFormError(message);
      } else if (status === 403) {
        setFormError("접근 권한이 없습니다");
      } else if (status === 503) {
        setFormError("서비스 일시 중단");
      } else {
        setFormError(message);
      }
    } finally {
      setSaving(false);
    }
  }

  // ── 표 ──────────────────────────────────────────────────────────────────────

  /**
   * 실측값 + **서버 편차**를 한 셀에 병기한다: `62.140 (+0.140)`.
   * 색 판정은 `isDeviationWarning()` 이 하고, 임계값은 `/settings/public` 에서 온다.
   * **프론트에서 `- 62.0` 같은 뺄셈을 하지 않는다.**
   */
  function devCell(component: "sn" | "ag" | "cu", value: number, deviation: number) {
    const warn = isDeviationWarning(component, deviation, pub);
    return (
      <span
        style={{
          fontVariantNumeric: "tabular-nums",
          color: warn ? T.error : T.text,
          fontWeight: warn ? 600 : 400,
        }}
        title={warn ? "편차 경고 임계 초과" : undefined}
      >
        {num(value, 3)}{" "}
        <span style={{ fontSize: 11.5, color: warn ? T.error : T.textMuted }}>
          ({signed(deviation, 3)})
        </span>
      </span>
    );
  }

  const columns: Column<ComponentDto>[] = [
    { key: "lot_id", header: "LOT ID", width: 150 },
    { key: "date", header: "측정일", width: 110 },
    {
      key: "sn",
      header: `Sn (목표 ${num(snTarget, 1)})`,
      width: 150,
      align: "right",
      render: (_v, row) => devCell("sn", row.sn, row.sn_deviation),
    },
    {
      key: "ag",
      header: `Ag (목표 ${num(agTarget, 1)})`,
      width: 150,
      align: "right",
      render: (_v, row) => devCell("ag", row.ag, row.ag_deviation),
    },
    {
      key: "cu",
      header: `Cu (목표 ${num(cuTarget, 1)})`,
      width: 150,
      align: "right",
      render: (_v, row) => devCell("cu", row.cu, row.cu_deviation),
    },
    {
      // Pb 에는 목표값이 없다 (goal.md 2.3 은 Sn/Ag/Cu 3종만 정의) — 편차를 표시하지 않는다
      key: "pb",
      header: "Pb (잔량)",
      width: 110,
      align: "right",
      render: (_v, row) => (
        <span style={{ fontVariantNumeric: "tabular-nums" }}>{num(row.pb, 3)}</span>
      ),
    },
    {
      key: "sum",
      header: "합계",
      width: 100,
      align: "right",
      render: (_v, row) => {
        const sum = row.sn + row.ag + row.cu + row.pb;
        const violated = Math.abs(sum - 100) > SUM_TOLERANCE;
        return (
          <span
            style={{
              fontVariantNumeric: "tabular-nums",
              color: violated ? T.error : T.text,
              fontWeight: violated ? 600 : 400,
            }}
            title={violated ? "성분 합계는 100%여야 합니다" : undefined}
          >
            {violated && "⚠ "}
            {num(sum, 1)}
          </span>
        );
      },
    },
    {
      key: "analysis_method",
      header: "분석법",
      width: 90,
      render: (_v, row) =>
        row.analysis_method ?? <span style={{ color: T.textMuted }}>{DASH}</span>,
    },
    {
      key: "created_at",
      header: "등록일시",
      width: 140,
      render: (_v, row) => dateTime(row.created_at),
    },
  ];

  if (error) return <ScreenError message={error} onRetry={refetch} />;

  return (
    <PageShell>
      <PageHeader
        title="성분 데이터 관리"
        subtitle="입고 원재료 성분 분석 데이터(Sn/Ag/Cu/Pb %) 등록·조회 · 목표값 대비 편차는 서버가 계산합니다 (FR-R-03)"
        actions={
          <>
            <button type="button" className="btn" onClick={handleExport} disabled={exporting}>
              {exporting ? "내보내는 중…" : "CSV 내보내기"}
            </button>
            <button
              type="button"
              className="btn pri"
              onClick={openModal}
              disabled={!canWrite}
              title={canWrite ? undefined : "등록 권한이 없습니다 (admin·manufacture·quality)"}
            >
              성분 데이터 등록
            </button>
          </>
        }
      />

      {/* 임계값을 서버에서 못 읽었으면 숨기지 않고 드러낸다 */}
      <SettingsFallbackBanner settings={settings.data} />

      {exportError && <ErrorAlert message={`내보내기 실패 — ${exportError}`} />}

      <FilterBar>
        <Field label="LOT ID" htmlFor="cd-lot">
          <TextInput
            id="cd-lot"
            value={draft.lotId}
            onChange={(v) => setDraft((d) => ({ ...d, lotId: v }))}
            placeholder="LOT-2026-001"
          />
        </Field>
        <Field label="공급사" htmlFor="cd-supplier">
          <Select
            id="cd-supplier"
            value={draft.supplier}
            onChange={(v) => setDraft((d) => ({ ...d, supplier: v }))}
            options={SUPPLIER_FILTER_OPTIONS}
            width={130}
          />
        </Field>
        <Field label="시작일" htmlFor="cd-from">
          <DateInput
            id="cd-from"
            value={draft.dateFrom}
            onChange={(v) => setDraft((d) => ({ ...d, dateFrom: v }))}
            invalid={rangeInverted}
          />
        </Field>
        <Field label="종료일" htmlFor="cd-to">
          <DateInput
            id="cd-to"
            value={draft.dateTo}
            onChange={(v) => setDraft((d) => ({ ...d, dateTo: v }))}
            invalid={rangeInverted}
          />
        </Field>
        <Field label="페이지 크기" htmlFor="cd-size">
          <Select
            id="cd-size"
            value={draft.pageSize}
            onChange={(v) => setDraft((d) => ({ ...d, pageSize: v }))}
            options={PAGE_SIZE_OPTIONS}
            width={110}
          />
        </Field>
        <button type="button" className="btn pri" onClick={applyFilters} disabled={rangeInverted}>
          조회
        </button>
        <button type="button" className="btn" onClick={resetFilters}>
          초기화
        </button>
        {rangeInverted && (
          <span style={{ fontSize: 11.5, color: T.error, fontWeight: 600, alignSelf: "center" }}>
            종료일이 시작일보다 앞설 수 없습니다
          </span>
        )}
      </FilterBar>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <SectionState
          loading={loading}
          error={null}
          empty={items.length === 0}
          emptyText="조회 조건에 해당하는 성분 데이터가 없습니다"
          minHeight={220}
        >
          <DataTable columns={columns} data={items} rowKey={(r) => r.id} />
        </SectionState>

        {items.length === 0 && !loading && (
          <button type="button" className="btn" style={{ alignSelf: "center" }} onClick={resetFilters}>
            필터 초기화
          </button>
        )}

        {data && (
          <Pagination page={data.page} pageSize={data.page_size} total={data.total} onPage={setPage} />
        )}

        <p style={{ fontSize: 11.5, color: T.textMuted, lineHeight: 1.7, margin: 0 }}>
          ※ 괄호 안 값은 <strong>서버가 계산한 목표값 대비 편차</strong>입니다. 경고 임계는
          시스템 설정(`deviation_warn`)에서 읽어 적용하며 화면에 고정된 숫자가 아닙니다. 공급사
          열은 `ComponentOut` 에 `supplier_code` 가 없어 제공하지 않습니다 (필터는 가능 —
          TODO-G1-009).
        </p>
      </div>

      {/* 등록 모달 */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="성분 데이터 등록"
        description="POST /api/v1/components · 편차는 서버가 계산합니다"
        width={560}
        footerVariant="surface"
        footer={
          <>
            <button type="button" className="btn" onClick={() => setModalOpen(false)} disabled={saving}>
              취소
            </button>
            <button type="button" className="btn pri" onClick={handleSave} disabled={!canSave}>
              {saving ? "저장 중…" : "저장"}
            </button>
          </>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {formError && <ErrorAlert message={formError} />}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              <label
                htmlFor="cd-form-lot"
                style={{ fontSize: 12, fontWeight: 600, color: T.textSub, letterSpacing: "0.02em" }}
              >
                LOT ID
              </label>
              <TextInput
                id="cd-form-lot"
                value={form.lot_id}
                onChange={(v) => {
                  setForm((f) => ({ ...f, lot_id: v }));
                  setLotIdError(null);
                }}
                placeholder="LOT-2026-001"
                width={undefined}
                invalid={Boolean(lotIdError)}
              />
              {lotIdError && (
                <span role="alert" style={{ fontSize: 11, color: T.error }}>
                  {lotIdError}
                </span>
              )}
            </div>

            <Field label="측정일">
              <DateInput
                value={form.date}
                onChange={(v) => setForm((f) => ({ ...f, date: v }))}
                width={undefined}
              />
            </Field>

            <NumericField
              label="Sn"
              value={form.sn}
              onChange={(v) => setForm((f) => ({ ...f, sn: v }))}
              min={COMPONENT_BOUNDS.sn[0]}
              max={COMPONENT_BOUNDS.sn[1]}
              step="0.001"
              labelSuffix={`목표 ${num(snTarget, 1)}%`}
              error={snErr}
            />
            <NumericField
              label="Ag"
              value={form.ag}
              onChange={(v) => setForm((f) => ({ ...f, ag: v }))}
              min={COMPONENT_BOUNDS.ag[0]}
              max={COMPONENT_BOUNDS.ag[1]}
              step="0.001"
              labelSuffix={`목표 ${num(agTarget, 1)}%`}
              error={agErr}
            />
            <NumericField
              label="Cu"
              value={form.cu}
              onChange={(v) => setForm((f) => ({ ...f, cu: v }))}
              min={COMPONENT_BOUNDS.cu[0]}
              max={COMPONENT_BOUNDS.cu[1]}
              step="0.001"
              labelSuffix={`목표 ${num(cuTarget, 1)}%`}
              error={cuErr}
            />
            <NumericField
              label="Pb"
              value={form.pb}
              onChange={(v) => setForm((f) => ({ ...f, pb: v }))}
              min={COMPONENT_BOUNDS.pb[0]}
              max={COMPONENT_BOUNDS.pb[1]}
              step="0.001"
              labelSuffix="잔량 (목표값 없음)"
              error={pbErr}
            />

            <Field label="분석법">
              <Select
                value={form.analysis_method}
                onChange={(v) => setForm((f) => ({ ...f, analysis_method: v as AnalysisMethod }))}
                options={ANALYSIS_METHODS.map((m) => ({ value: m, label: m }))}
              />
            </Field>
          </div>

          {/* 합계 실시간 검증 — 위반이면 저장 버튼이 잠기고 요청이 나가지 않는다 */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "10px 14px",
              borderRadius: 8,
              background: sumOk ? "#ECFDF3" : "#FEF1F2",
              border: `1px solid ${sumOk ? "#16A34A" : T.error}`,
            }}
          >
            <span style={{ fontSize: 12.5, fontWeight: 600, color: sumOk ? "#15803D" : "#B91C1C" }}>
              합계: {Number.isFinite(formSum) ? num(formSum, 3) : DASH}%
            </span>
            <span style={{ fontSize: 11.5, color: sumOk ? "#15803D" : "#B91C1C" }}>
              {sumOk ? "✅ 정상" : "성분 합계는 100%여야 합니다"}
            </span>
          </div>

          {/* 편차 **미리보기** — 표시 전용이다. 요청 본문에는 넣지 않는다 */}
          <div className="card" style={{ background: T.surfaceSubtle, padding: "12px 14px" }}>
            <div style={{ fontSize: 11.5, fontWeight: 600, color: T.textSub, marginBottom: 8 }}>
              편차 미리보기 (표시 전용 — 저장값은 서버가 다시 계산합니다)
            </div>
            <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
              {(
                [
                  { key: "sn" as const, label: "Sn", value: snV, target: snTarget, digits: 3 },
                  { key: "ag" as const, label: "Ag", value: agV, target: agTarget, digits: 3 },
                  { key: "cu" as const, label: "Cu", value: cuV, target: cuTarget, digits: 3 },
                ]
              ).map(({ key, label, value, target, digits }) => {
                const dev = Number.isFinite(value) ? value - target : NaN;
                const warn = Number.isFinite(dev) && isDeviationWarning(key, dev, pub);
                return (
                  <span
                    key={key}
                    style={{
                      fontSize: 12.5,
                      fontVariantNumeric: "tabular-nums",
                      color: warn ? T.error : T.text,
                      fontWeight: warn ? 600 : 400,
                    }}
                  >
                    {label}: {signed(dev, digits)}
                  </span>
                );
              })}
            </div>
          </div>
        </div>
      </Modal>
    </PageShell>
  );
}
