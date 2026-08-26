"use client";

/**
 * FE-RT-06 — 입고 현황 · `/receiving` · FR-R-01
 *
 * 명세: `specs/plan-g1.md` FE-RT-06 · 계약: `api-contract.md` §8.3 (G2).
 * SF-TD3 에 와이어프레임 없음 — FR-R-01 본문 + `ReceiptIn`/`ReceiptDto` 에서 도출했다.
 *
 * 라운드 2 에서 고친 것:
 *   - `MOCK_RECEIVING` 8행 하드코딩 제거 → `GET /receipts` (`useReceipts`) 실 연동
 *   - 상태 5값(대기/검사중/합격/불합격/보류) → 계약 **3값** (`accepted`/`rejected`/`inspecting`)
 *   - `SUP_D (글로벌메탈)` 제거 — 공급사는 `SUP_A`/`SUP_B`/`SUP_C` 3개뿐이다
 *   - 재료 자유 문자열 → **4종 select** (`Sn ingot`/`Ag powder`/`Cu wire`/`Pb ingot`, db-schema §6.3)
 *   - 서버 필터(공급사·상태·기간) + `Page<T>` 페이징 **신규**
 *   - `입고 등록` 모달 **신규** (`POST /receipts`)
 *   - 행별 합격/불합격/보류 3버튼 + `일괄 저장` 제거 — 상태 변경 엔드포인트가 아직 없다 (TODO-G1-006).
 *     저장되지 않는 버튼을 남겨두면 "저장한 줄 알았는데 안 된" 상태가 된다
 *   - 예정시간 열 제거 (`receipts` 에 컬럼 없음) · 하드코딩 `"검사 대기 중인 항목 2건"` 배너 제거
 */

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { ErrorAlert } from "@/components/ui/ErrorAlert";
import { KpiCard } from "@/components/ui/KpiCard";
import { Modal } from "@/components/ui/Modal";
import { NumericField } from "@/components/ui/NumericField";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { T } from "@/components/ui/tokens";
import { useReceipts } from "@/hooks/useKoryoData";
import { ApiError, createReceipt, type ReceiptQuery } from "@/lib/koryo-api";
import { RECEIPT_STATUS_LABELS } from "@/types/api";
import type {
  ReceiptDto,
  ReceiptIn,
  ReceiptMaterial,
  ReceiptStatus,
  SupplierCode,
} from "@/types/api";
import {
  DateInput,
  Field,
  FilterBar,
  PAGE_SIZE_OPTIONS,
  PageHeader,
  PageShell,
  Pagination,
  SUPPLIER_CODES,
  SUPPLIER_FILTER_OPTIONS,
  ScreenError,
  SectionState,
  Select,
  hasRole,
  int,
  num,
  today,
  useRole,
} from "../_g1/ui";

// ── 계약 고정값 ───────────────────────────────────────────────────────────────

/** FR-R-01 의 3상태. `대기`·`보류` 는 요구사항에 없다 */
const STATUS_VARIANT: Record<ReceiptStatus, "green" | "red" | "amber"> = {
  accepted: "green",
  rejected: "red",
  inspecting: "amber",
};

const STATUS_FILTER_OPTIONS = [
  { value: "", label: "전체" },
  ...(Object.keys(RECEIPT_STATUS_LABELS) as ReceiptStatus[]).map((s) => ({
    value: s,
    label: RECEIPT_STATUS_LABELS[s],
  })),
];

/** db-schema §6.3 이 `material VARCHAR(50)` 설명에 명시한 4종 */
const MATERIALS: ReceiptMaterial[] = ["Sn ingot", "Ag powder", "Cu wire", "Pb ingot"];

/** `receipts.unit VARCHAR(10) DEFAULT 'kg'` */
const UNITS = ["kg", "g", "ton"];

// ── 등록 폼 ──────────────────────────────────────────────────────────────────

interface ReceiptForm {
  date: string;
  supplier_code: SupplierCode;
  material: ReceiptMaterial;
  quantity: string;
  unit: string;
  status: ReceiptStatus;
}

function emptyForm(): ReceiptForm {
  return {
    date: today(),
    supplier_code: "SUP_A",
    material: "Sn ingot",
    quantity: "",
    unit: "kg",
    status: "inspecting",
  };
}

// ── 페이지 ────────────────────────────────────────────────────────────────────

export default function ReceivingPage() {
  const role = useRole();
  const canWrite = hasRole(role, "admin", "manufacture");

  // 편집 중인 필터(draft) 와 조회에 실제로 쓰인 필터(applied)를 나눈다.
  // 날짜를 타이핑하는 중간 상태로 요청이 나가지 않게 한다.
  const [draft, setDraft] = useState({
    supplier: "",
    status: "",
    dateFrom: "",
    dateTo: "",
    pageSize: "50",
  });
  const [applied, setApplied] = useState(draft);
  const [page, setPage] = useState(1);

  const rangeInverted =
    draft.dateFrom !== "" && draft.dateTo !== "" && draft.dateFrom > draft.dateTo;

  const query: ReceiptQuery = useMemo(
    () => ({
      page,
      page_size: Number(applied.pageSize),
      supplier: (applied.supplier || undefined) as SupplierCode | undefined,
      status: (applied.status || undefined) as ReceiptStatus | undefined,
      date_from: applied.dateFrom || undefined,
      date_to: applied.dateTo || undefined,
    }),
    [page, applied]
  );

  const { data, loading, error, refetch } = useReceipts(query);
  const items = data?.items ?? [];

  /** 필터를 바꾸면 항상 1페이지로 되돌린다 (plan-g1 §5) */
  function applyFilters() {
    if (rangeInverted) return;
    setApplied(draft);
    setPage(1);
  }

  function resetFilters() {
    const next = { supplier: "", status: "", dateFrom: "", dateTo: "", pageSize: "50" };
    setDraft(next);
    setApplied(next);
    setPage(1);
  }

  // ── 등록 모달 ───────────────────────────────────────────────────────────────
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<ReceiptForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const quantityNum = Number(form.quantity);
  const quantityValid = form.quantity.trim() !== "" && Number.isFinite(quantityNum) && quantityNum > 0;
  const canSave = canWrite && quantityValid && form.date !== "" && !saving;

  function openModal() {
    setForm(emptyForm());
    setFormError(null);
    setModalOpen(true);
  }

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    setFormError(null);
    try {
      const body: ReceiptIn = {
        date: form.date,
        supplier_code: form.supplier_code,
        material: form.material,
        quantity: quantityNum,
        unit: form.unit,
        status: form.status,
      };
      await createReceipt(body);
      // 🔴 저장이 **실제로 성공한 뒤에만** 토스트를 띄운다.
      setModalOpen(false);
      refetch();
      toast.success("입고가 등록되었습니다");
    } catch (err) {
      // 실패 시 모달을 닫지 않는다 — 사용자가 방금 친 값 옆에 오류가 붙어야 고칠 수 있다
      const status = err instanceof ApiError ? err.status : 0;
      const message = err instanceof Error ? err.message : "입고 등록에 실패했습니다";
      setFormError(
        status === 409
          ? "입고번호가 중복됩니다"
          : status === 403
            ? "접근 권한이 없습니다"
            : status === 503
              ? "서비스 일시 중단"
              : message
      );
    } finally {
      setSaving(false);
    }
  }

  // ── 표 ──────────────────────────────────────────────────────────────────────
  const columns: Column<ReceiptDto>[] = [
    { key: "receipt_no", header: "입고번호", width: 130 },
    { key: "date", header: "입고일", width: 110 },
    { key: "supplier_code", header: "공급사", width: 90 },
    { key: "material", header: "재료", width: 120 },
    {
      key: "quantity",
      header: "수량",
      width: 100,
      align: "right",
      render: (_v, row) => num(row.quantity, 2),
    },
    { key: "unit", header: "단위", width: 70 },
    {
      key: "status",
      header: "상태",
      width: 90,
      render: (_v, row) => (
        <StatusBadge
          variant={STATUS_VARIANT[row.status]}
          label={RECEIPT_STATUS_LABELS[row.status] ?? row.status}
        />
      ),
    },
  ];

  /**
   * 응답에 요약 집계 필드가 없다 (`Page<T>` 는 `total` 만 준다).
   * 그래서 **현재 페이지의 `items`** 로만 센다 — 라벨에 그 사실을 반드시 적는다.
   */
  const counts = useMemo(
    () => ({
      total: items.length,
      accepted: items.filter((r) => r.status === "accepted").length,
      inspecting: items.filter((r) => r.status === "inspecting").length,
      rejected: items.filter((r) => r.status === "rejected").length,
    }),
    [items]
  );

  // 화면 전체가 실패했다 — 계약 문구 + 원문 메시지 + 재시도
  if (error) return <ScreenError message={error} onRetry={refetch} />;

  return (
    <PageShell>
      <PageHeader
        title="입고 현황"
        subtitle="공급사별 원재료 입고 현황 조회 · 상태(수락/거부/검사중) 필터 (FR-R-01)"
        actions={
          <button
            type="button"
            className="btn pri"
            onClick={openModal}
            disabled={!canWrite}
            title={canWrite ? undefined : "입고 등록 권한이 없습니다 (admin·manufacture)"}
          >
            입고 등록
          </button>
        }
      />

      {/* 요약 — 현재 페이지 기준임을 라벨에 명시한다 */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
        <KpiCard label="총 입고 (현재 페이지 기준)" value={int(counts.total)} unit="건" />
        <KpiCard label="수락 (현재 페이지 기준)" value={int(counts.accepted)} unit="건" />
        <KpiCard label="검사중 (현재 페이지 기준)" value={int(counts.inspecting)} unit="건" />
        <KpiCard label="거부 (현재 페이지 기준)" value={int(counts.rejected)} unit="건" />
      </div>

      <FilterBar>
        <Field label="공급사" htmlFor="rc-supplier">
          <Select
            id="rc-supplier"
            value={draft.supplier}
            onChange={(v) => setDraft((d) => ({ ...d, supplier: v }))}
            options={SUPPLIER_FILTER_OPTIONS}
            width={130}
          />
        </Field>
        <Field label="상태" htmlFor="rc-status">
          <Select
            id="rc-status"
            value={draft.status}
            onChange={(v) => setDraft((d) => ({ ...d, status: v }))}
            options={STATUS_FILTER_OPTIONS}
            width={130}
          />
        </Field>
        <Field label="시작일" htmlFor="rc-from">
          <DateInput
            id="rc-from"
            value={draft.dateFrom}
            onChange={(v) => setDraft((d) => ({ ...d, dateFrom: v }))}
            invalid={rangeInverted}
          />
        </Field>
        <Field label="종료일" htmlFor="rc-to">
          <DateInput
            id="rc-to"
            value={draft.dateTo}
            onChange={(v) => setDraft((d) => ({ ...d, dateTo: v }))}
            invalid={rangeInverted}
          />
        </Field>
        <Field label="페이지 크기" htmlFor="rc-size">
          <Select
            id="rc-size"
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
          emptyText="조회 조건에 해당하는 입고 내역이 없습니다"
          minHeight={220}
        >
          <DataTable columns={columns} data={items} rowKey={(r) => r.receipt_no} />
        </SectionState>

        {items.length === 0 && !loading && (
          <button type="button" className="btn" style={{ alignSelf: "center" }} onClick={resetFilters}>
            필터 초기화
          </button>
        )}

        {data && (
          <Pagination page={data.page} pageSize={data.page_size} total={data.total} onPage={setPage} />
        )}
      </div>

      {/* 등록 모달 — 상태 변경 엔드포인트가 없으므로 상태는 **등록 시점에만** 지정한다 */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="입고 등록"
        description="POST /api/v1/receipts"
        width={520}
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
            <Field label="입고일">
              <DateInput
                value={form.date}
                onChange={(v) => setForm((f) => ({ ...f, date: v }))}
                width={undefined}
              />
            </Field>
            <Field label="공급사">
              <Select
                value={form.supplier_code}
                onChange={(v) => setForm((f) => ({ ...f, supplier_code: v as SupplierCode }))}
                options={SUPPLIER_CODES.map((c) => ({ value: c, label: c }))}
              />
            </Field>
            <Field label="재료">
              <Select
                value={form.material}
                onChange={(v) => setForm((f) => ({ ...f, material: v as ReceiptMaterial }))}
                options={MATERIALS.map((m) => ({ value: m, label: m }))}
              />
            </Field>
            <NumericField
              label="수량"
              value={form.quantity}
              onChange={(v) => setForm((f) => ({ ...f, quantity: v }))}
              unit={form.unit}
              min={0}
              step="0.01"
              placeholder="0.00"
              error={
                form.quantity.trim() !== "" && !quantityValid ? "수량은 0보다 커야 합니다" : undefined
              }
            />
            <Field label="단위">
              <Select
                value={form.unit}
                onChange={(v) => setForm((f) => ({ ...f, unit: v }))}
                options={UNITS.map((u) => ({ value: u, label: u }))}
              />
            </Field>
            <Field label="상태">
              <Select
                value={form.status}
                onChange={(v) => setForm((f) => ({ ...f, status: v as ReceiptStatus }))}
                options={(Object.keys(RECEIPT_STATUS_LABELS) as ReceiptStatus[]).map((s) => ({
                  value: s,
                  label: RECEIPT_STATUS_LABELS[s],
                }))}
              />
            </Field>
          </div>

          <span style={{ fontSize: 11.5, color: T.textMuted, lineHeight: 1.6 }}>
            입고번호(`receipt_no`)는 서버가 채번합니다. 등록 후 상태 변경 기능은 대응
            엔드포인트가 확정되면 제공됩니다 (TODO-G1-006).
          </span>
        </div>
      </Modal>
    </PageShell>
  );
}
