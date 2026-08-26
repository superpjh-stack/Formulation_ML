"use client";

/**
 * FE-RT-07 — 입고 이력 · `/receiving/history` · FR-R-02
 *
 * 명세: `specs/plan-g1.md` FE-RT-07 · 계약: `api-contract.md` §8.3 · **§8.3.1**.
 * 읽기 전용 화면이다 (쓰기 액션 없음, 전 역할 R).
 *
 * 라운드 2 에서 고친 것:
 *   - `MOCK_HISTORY` 12행 제거 → `GET /receipts/history` (`useReceiptHistory`) 실 연동
 *   - 클라이언트 `filter()` → **서버 쿼리**(`supplier`/`material`/`date_from`/`date_to`)
 *   - **기간 필터 신규** (FR-R-02 의 검색 3축 중 하나인데 현 구현에 없었다) · 기본 최근 90일
 *   - `Page<T>` 페이징 신규
 *   - `SUP_D` 제거 · 판정(합격/불합격/보류) 열 제거 → `status` 3값으로 통합
 *   - CSV 내보내기 버튼 제거 — `/data/export` 의 `entity` 화이트리스트에 `receipts` 가 없다 (TODO-G1-007)
 *   - LOT번호 열 제거 (`receipts` 에 LOT 컬럼 없음 — 입고와 LOT 은 다른 축이다)
 *
 * 🔴 **부록 C 값 오류 교정**: 현 구현의 편차 임계 `0.5`/`0.15`/`0.05` 를 그대로 쓰지 않았다.
 *    다만 이 화면은 **애초에 편차 경고를 적용하지 않는다** — 아래 §성분 참조.
 */

import { useMemo, useState } from "react";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { KpiCard } from "@/components/ui/KpiCard";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { T } from "@/components/ui/tokens";
import { useReceiptHistory } from "@/hooks/useKoryoData";
import type { ReceiptQuery } from "@/lib/koryo-api";
import { RECEIPT_STATUS_LABELS } from "@/types/api";
import type { ReceiptDto, ReceiptMaterial, ReceiptStatus, SupplierCode } from "@/types/api";
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
  daysAgo,
  int,
  num,
  today,
} from "../../_g1/ui";

const STATUS_VARIANT: Record<ReceiptStatus, "green" | "red" | "amber"> = {
  accepted: "green",
  rejected: "red",
  inspecting: "amber",
};

const MATERIAL_FILTER_OPTIONS = [
  { value: "", label: "전체" },
  ...(["Sn ingot", "Ag powder", "Cu wire", "Pb ingot"] as ReceiptMaterial[]).map((m) => ({
    value: m,
    label: m,
  })),
];

/**
 * 기간 기본값 90일 — FR-R-02 가 기본을 정하지 않았다.
 * 같은 그룹의 `/suppliers/{code}/stats?days=90` · `/deviation/*?days=90` 관례를 따랐다 (**판단**).
 */
const DEFAULT_DAYS = 90;

export default function ReceivingHistoryPage() {
  const [draft, setDraft] = useState({
    dateFrom: daysAgo(DEFAULT_DAYS),
    dateTo: today(),
    supplier: "",
    material: "",
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
      material: applied.material || undefined,
      date_from: applied.dateFrom || undefined,
      date_to: applied.dateTo || undefined,
    }),
    [page, applied]
  );

  const { data, loading, error, refetch } = useReceiptHistory(query);
  const items = data?.items ?? [];

  function applyFilters() {
    if (rangeInverted) return;
    setApplied(draft);
    setPage(1);
  }

  function resetFilters() {
    const next = {
      dateFrom: daysAgo(DEFAULT_DAYS),
      dateTo: today(),
      supplier: "",
      material: "",
      pageSize: "50",
    };
    setDraft(next);
    setApplied(next);
    setPage(1);
  }

  /**
   * 성분 실측 셀.
   *
   * ⚠ **편차 경고 색을 칠하지 않는다** (api-contract §8.3.1).
   * `material='Sn ingot'` 의 `sn_pct` 는 99% 대이고, 배합 목표 62.0% 와의 차이는
   * **품질 편차가 아니다.** `deviation_warn`(2.0/0.3/0.1)은 생산 LOT(`components`,
   * FE-RT-08)에만 적용한다. 여기서는 측정값을 **있는 그대로** 보여준다.
   */
  function pctCell(value: number | null, digits: number) {
    if (value === null || value === undefined) return <span style={{ color: T.textMuted }}>{DASH}</span>;
    return <span style={{ fontVariantNumeric: "tabular-nums" }}>{num(value, digits)}</span>;
  }

  const columns: Column<ReceiptDto>[] = [
    { key: "date", header: "입고일", width: 110 },
    { key: "receipt_no", header: "입고번호", width: 130 },
    { key: "supplier_code", header: "공급사", width: 90 },
    { key: "material", header: "재료", width: 110 },
    {
      key: "quantity",
      header: "수량",
      width: 110,
      align: "right",
      render: (_v, row) => (
        <span style={{ fontVariantNumeric: "tabular-nums" }}>
          {num(row.quantity, 2)} <span style={{ color: T.textMuted }}>{row.unit}</span>
        </span>
      ),
    },
    {
      key: "sn_pct",
      header: "Sn 실측 (%)",
      width: 110,
      align: "right",
      render: (_v, row) => pctCell(row.sn_pct, 2),
    },
    {
      key: "ag_pct",
      header: "Ag 실측 (%)",
      width: 110,
      align: "right",
      render: (_v, row) => pctCell(row.ag_pct, 3),
    },
    {
      key: "cu_pct",
      header: "Cu 실측 (%)",
      width: 110,
      align: "right",
      render: (_v, row) => pctCell(row.cu_pct, 3),
    },
    {
      key: "analysis_method",
      header: "분석법",
      width: 90,
      render: (_v, row) =>
        row.analysis_method ?? <span style={{ color: T.textMuted }}>{DASH}</span>,
    },
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

  /** `Page<T>` 봉투에 합격/불합격 카운트가 없다 → 현재 페이지 집계임을 라벨에 적는다 */
  const counts = useMemo(
    () => ({
      rows: items.length,
      accepted: items.filter((r) => r.status === "accepted").length,
      rejected: items.filter((r) => r.status === "rejected").length,
      measured: items.filter(
        (r) => r.sn_pct !== null || r.ag_pct !== null || r.cu_pct !== null
      ).length,
    }),
    [items]
  );

  if (error) return <ScreenError message={error} onRetry={refetch} />;

  return (
    <PageShell>
      <PageHeader
        title="입고 이력"
        subtitle="기간·공급사·재료별 입고 이력 검색 (FR-R-02) · 조회 전용"
      />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
        <KpiCard label="조회 건수 (현재 페이지 기준)" value={int(counts.rows)} unit="건" />
        <KpiCard label="수락 (현재 페이지 기준)" value={int(counts.accepted)} unit="건" />
        <KpiCard label="거부 (현재 페이지 기준)" value={int(counts.rejected)} unit="건" />
        <KpiCard label="성분 측정 완료 (현재 페이지 기준)" value={int(counts.measured)} unit="건" />
      </div>

      <FilterBar>
        <Field label="시작일" htmlFor="rh-from">
          <DateInput
            id="rh-from"
            value={draft.dateFrom}
            onChange={(v) => setDraft((d) => ({ ...d, dateFrom: v }))}
            invalid={rangeInverted}
          />
        </Field>
        <Field label="종료일" htmlFor="rh-to">
          <DateInput
            id="rh-to"
            value={draft.dateTo}
            onChange={(v) => setDraft((d) => ({ ...d, dateTo: v }))}
            invalid={rangeInverted}
          />
        </Field>
        <Field label="공급사" htmlFor="rh-supplier">
          <Select
            id="rh-supplier"
            value={draft.supplier}
            onChange={(v) => setDraft((d) => ({ ...d, supplier: v }))}
            options={SUPPLIER_FILTER_OPTIONS}
            width={130}
          />
        </Field>
        <Field label="재료" htmlFor="rh-material">
          <Select
            id="rh-material"
            value={draft.material}
            onChange={(v) => setDraft((d) => ({ ...d, material: v }))}
            options={MATERIAL_FILTER_OPTIONS}
            width={140}
          />
        </Field>
        <Field label="페이지 크기" htmlFor="rh-size">
          <Select
            id="rh-size"
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
          emptyText="조회 조건에 해당하는 입고 이력이 없습니다"
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

        {/* 성분 해석 주의 — 계약 §8.3.1 을 화면에도 적어둔다 */}
        <p style={{ fontSize: 11.5, color: T.textMuted, lineHeight: 1.7, margin: 0 }}>
          ※ 입고 성분은 <strong>입고 시점 원재료</strong>의 실측값입니다. 원재료는 단일 원소라
          배합 목표값(Sn 62.0% 등)과의 차이가 품질 편차를 뜻하지 않으므로{" "}
          <strong>편차 경고를 적용하지 않습니다</strong> (api-contract §8.3.1). 배합 LOT 의 성분
          편차는 <strong>성분 데이터 관리</strong> 화면에서 확인하세요. 검사 전(`검사중`) 항목은
          측정값이 없어 {DASH} 로 표시됩니다.
        </p>
      </div>
    </PageShell>
  );
}
