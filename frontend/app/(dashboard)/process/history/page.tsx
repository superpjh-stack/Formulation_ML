"use client";

/**
 * FE-RT-24 · `/process/history` · 이력 조회 (FR-P-04)
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * 🔴 **화면 정체성 자체가 틀려 있었다 — 전면 재작성이다.**
 *   이전 구현은 "공정 실행 이력"(교대·생산량·실제 RPM)을 그렸다. 그 세 값은
 *   **저장 컬럼이 아예 없다.** FR-P-04 가 요구한 것은
 *   **① 공정 조건 변경 이력 ② 설비 알람 이력** 두 가지이고, 둘 다 없었다.
 *
 * 🔴 **`row.kind` 로 좁힌다.** 응답이 판별 유니온(`ConditionHistoryDto | AlarmHistoryDto`)이라
 *   자기 종류를 스스로 알려준다. 내가 보낸 `kind` 쿼리를 기억해서 해석하면
 *   탭을 바꾸는 사이 도착한 이전 응답을 **틀린 컬럼으로 렌더하는 경쟁 조건**이 생긴다.
 *   `api.isConditionRow` / `api.isAlarmRow` 로 거른 뒤 표에 넣는다.
 *
 * 🔴 **설비 알람에 설비ID 열을 만들지 마라** (§2.2). `alerts` 에 설비 FK 가 없고
 *   설비ID 는 `message` 자유 텍스트 안에만 있다. `EQ-\d+` 를 정규식으로 파싱해 열을
 *   만들면 메시지 형식이 바뀌는 순간 조용히 깨진다. `message` 를 그대로 보여준다.
 * ══════════════════════════════════════════════════════════════════════════════
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import * as api from "@/lib/koryo-api";
import { useProcessHistory } from "@/hooks/useKoryoData";
import { resolveError } from "@/lib/error-contract";
import { StatusScreen } from "@/components/layout/StatusScreen";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { PillFilter } from "@/components/ui/PillFilter";
import { Modal } from "@/components/ui/Modal";
import { Spinner } from "@/components/ui/Spinner";
import { T } from "@/components/ui/tokens";
import type {
  AlarmHistoryDto,
  AlertLevel,
  ConditionHistoryDto,
  ProcessHistoryKind,
} from "@/types/api";

const PAGE_SIZE = 50;
/** `created_at DESC` 인덱스와 일치하는 고정 정렬. 오름차순 옵션을 만들면 인덱스를 못 탄다 */
const SORT = "created_at:desc";
const MAX_RANGE_DAYS = 366;

const KIND_TABS: { value: ProcessHistoryKind; label: string }[] = [
  { value: "condition", label: "공정 조건 변경" },
  { value: "alarm", label: "설비 알람" },
];

const LEVEL_META: Record<AlertLevel, { label: string; variant: "gray" | "amber" | "red" }> = {
  info: { label: "정보", variant: "gray" },
  warning: { label: "경고", variant: "amber" },
  critical: { label: "심각", variant: "red" },
};

type LevelFilter = "all" | AlertLevel;

const LEVEL_OPTIONS: { value: LevelFilter; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "info", label: "정보" },
  { value: "warning", label: "경고" },
  { value: "critical", label: "심각" },
];

// ─── diff 표시 규약 ───────────────────────────────────────────────────────────

interface DiffSpec {
  key: string;
  label: string;
  format: (v: unknown) => string;
}

const num = (decimals: number, unit = "") => (v: unknown) =>
  v === null || v === undefined || v === "" ? "—" : `${Number(v).toFixed(decimals)}${unit}`;

const DIFF_SPECS: DiffSpec[] = [
  { key: "temp_min", label: "온도 하한", format: num(1, " °C") },
  { key: "temp_max", label: "온도 상한", format: num(1, " °C") },
  { key: "time_min", label: "시간 하한", format: num(0, " 분") },
  { key: "time_max", label: "시간 상한", format: num(0, " 분") },
  { key: "speed", label: "속도", format: num(2) },
  { key: "version", label: "버전", format: num(0) },
  {
    key: "active",
    label: "적용여부",
    format: (v) => (v === null || v === undefined ? "—" : v ? "적용중" : "미적용"),
  },
];

const DIFF_LABEL = new Map(DIFF_SPECS.map((s) => [s.key, s.label]));

/** `before` 와 `after` 의 키 합집합에서 값이 다른 키만 모은다 */
function changedKeys(row: ConditionHistoryDto): string[] {
  if (row.before === null) return [];
  const before = row.before;
  const after = row.after;
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
}

function changeSummary(row: ConditionHistoryDto): string {
  if (row.before === null) return "신규 등록";
  const changed = changedKeys(row).map((k) => DIFF_LABEL.get(k) ?? k);
  return changed.length > 0 ? changed.join(", ") : "변경된 항목 없음";
}

// ─── 날짜 유틸 ────────────────────────────────────────────────────────────────

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return iso(d);
}
function dayDiff(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
}
const dt = (s: string) => s.replace("T", " ").slice(0, 19);

// ─── 페이지 ───────────────────────────────────────────────────────────────────

/**
 * FE-RT-23 의 [이력] 버튼이 `?condition_id=` 로 넘어온다. `useSearchParams()` 를 쓰면
 * 이 페이지 전체가 Suspense 경계를 요구하므로, 최초 마운트 시 1회만 읽는다.
 */
function initialConditionId(): number | null {
  if (typeof window === "undefined") return null;
  const raw = new URLSearchParams(window.location.search).get("condition_id");
  const n = raw === null ? NaN : Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export default function ProcessHistoryPage() {
  const [conditionId, setConditionId] = useState<number | null>(initialConditionId);
  const [kind, setKind] = useState<ProcessHistoryKind>("condition");
  const [dateFrom, setDateFrom] = useState(daysAgo(29));
  const [dateTo, setDateTo] = useState(iso(new Date()));
  const [productCode, setProductCode] = useState("");
  const [level, setLevel] = useState<LevelFilter>("all");
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<ConditionHistoryDto | null>(null);

  const rangeError =
    dateFrom > dateTo
      ? "시작일이 종료일보다 늦습니다"
      : dayDiff(dateFrom, dateTo) > MAX_RANGE_DAYS
        ? `조회 기간은 ${MAX_RANGE_DAYS}일을 넘을 수 없습니다`
        : null;

  const query = useMemo(
    () => ({
      kind,
      date_from: dateFrom,
      date_to: dateTo,
      page,
      page_size: PAGE_SIZE,
      sort: SORT,
      ...(kind === "condition" && productCode ? { product_code: productCode } : {}),
      ...(kind === "condition" && conditionId !== null ? { condition_id: conditionId } : {}),
      ...(kind === "alarm" && level !== "all" ? { level } : {}),
    }),
    [kind, dateFrom, dateTo, page, productCode, level, conditionId]
  );

  const { data, loading, error, refetch } = useProcessHistory(rangeError ? {} : query);

  const items = useMemo(() => data?.items ?? [], [data]);

  /**
   * 🔴 여기가 핵심이다. **응답 원소의 `kind` 로 좁힌다.**
   * 탭을 바꾼 직후 이전 탭의 응답이 도착해도, 그 행들은 `kind` 가 달라서 걸러진다.
   */
  const conditionRows = useMemo(() => items.filter(api.isConditionRow), [items]);
  const alarmRows = useMemo(() => items.filter(api.isAlarmRow), [items]);

  /** 현재 탭과 응답 종류가 어긋난 상태 (전환 중) — 이전 탭 데이터를 그리지 않는다 */
  const visibleRows = kind === "condition" ? conditionRows : alarmRows;
  const switching = !loading && items.length > 0 && visibleRows.length === 0 && !error;

  const total = data?.total ?? 0;
  const maxPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function resetFilters() {
    setDateFrom(daysAgo(29));
    setDateTo(iso(new Date()));
    setProductCode("");
    setLevel("all");
    setConditionId(null);
    setPage(1);
  }

  function widenToYear() {
    setDateFrom(daysAgo(365));
    setDateTo(iso(new Date()));
    setPage(1);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* [A] 헤더 */}
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: T.text, margin: 0 }}>이력 조회</h1>
        <p style={{ fontSize: 12.5, color: T.textSub, margin: "4px 0 0" }}>
          공정 조건 변경 이력 · 설비 알람 이력 (FR-P-04)
        </p>
      </div>

      {/* [B] 이력 종류 세그먼트 + 기간 */}
      <div className="card" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <PillFilter
          options={KIND_TABS}
          value={kind}
          onChange={(v) => {
            setKind(v);
            setPage(1);
            setDetail(null);
          }}
          label="이력 종류:"
          size="lg"
          shape="rounded"
        />

        <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 11.5, fontWeight: 600, color: T.textSub }}>기간 시작</span>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => {
                setDateFrom(e.target.value);
                setPage(1);
              }}
              style={inputStyle}
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 11.5, fontWeight: 600, color: T.textSub }}>기간 종료</span>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => {
                setDateTo(e.target.value);
                setPage(1);
              }}
              style={inputStyle}
            />
          </label>

          {kind === "condition" ? (
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 11.5, fontWeight: 600, color: T.textSub }}>제품코드</span>
              <input
                type="text"
                value={productCode}
                placeholder="전체"
                onChange={(e) => {
                  setProductCode(e.target.value.trim());
                  setPage(1);
                }}
                style={{ ...inputStyle, width: 140 }}
              />
            </label>
          ) : (
            <PillFilter
              options={LEVEL_OPTIONS}
              value={level}
              onChange={(v) => {
                setLevel(v);
                setPage(1);
              }}
              label="등급:"
            />
          )}

          <button type="button" className="btn" onClick={widenToYear}>
            최근 1년
          </button>
          <button type="button" className="btn" onClick={resetFilters}>
            필터 초기화
          </button>
        </div>

        {conditionId !== null && kind === "condition" && (
          <div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12, color: T.textSub }}>
            공정 조건 #{conditionId} 의 이력만 보고 있습니다.
            <button type="button" className="btn" onClick={() => { setConditionId(null); setPage(1); }}>
              전체 보기
            </button>
          </div>
        )}

        {rangeError && (
          <div role="alert" style={{ fontSize: 12, color: T.error }}>
            {rangeError}
          </div>
        )}

        <p style={{ fontSize: 11, color: T.textMuted, margin: 0 }}>
          {kind === "condition"
            ? "공정 조건 변경 이력은 무기한 보관됩니다. 기본 조회 기간은 최근 30일입니다."
            : "설비 알람은 6개월간 보관됩니다 (해소된 알람 중 6개월 초과분은 삭제됩니다)."}
        </p>
      </div>

      {/* 상태 갈래 */}
      {rangeError ? null : loading ? (
        <StatusScreen tone="loading" title="이력을 불러오는 중" />
      ) : error ? (
        <HistoryError kind={kind} message={error} onRetry={refetch} />
      ) : switching ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: T.textSub }}>
          <Spinner size="sm" /> 탭을 전환하는 중입니다
        </div>
      ) : visibleRows.length === 0 ? (
        <StatusScreen
          tone="empty"
          title={
            kind === "condition"
              ? "선택한 기간에 공정 조건 변경 이력이 없습니다"
              : "선택한 기간에 설비 알람이 없습니다"
          }
          detail={
            kind === "condition"
              ? "공정 조건 화면에서 조건을 등록·수정하면 여기에 기록됩니다."
              : "설비 알람은 6개월간 보관됩니다. 그 이전 알람은 조회되지 않는 것이 정상입니다."
          }
          actions={[
            { label: "최근 1년으로 확대", onClick: widenToYear, primary: true },
            { label: "필터 초기화", onClick: resetFilters },
          ]}
        />
      ) : kind === "condition" ? (
        <ConditionTable rows={conditionRows} onDetail={setDetail} />
      ) : (
        <AlarmTable rows={alarmRows} />
      )}

      {/* 페이지네이션 */}
      {!rangeError && !loading && !error && total > PAGE_SIZE && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 10 }}>
          <span style={{ fontSize: 12, color: T.textSub }}>
            총 {total.toLocaleString("ko-KR")}건 · {page} / {maxPage}
          </span>
          <button
            type="button"
            className="btn"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            이전
          </button>
          <button
            type="button"
            className="btn"
            disabled={page >= maxPage}
            onClick={() => setPage((p) => Math.min(maxPage, p + 1))}
          >
            다음
          </button>
        </div>
      )}

      {/* [D] diff 모달 — 목록 응답의 before/after 를 재사용한다 (추가 호출 없음) */}
      <DiffModal row={detail} onClose={() => setDetail(null)} />
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  height: 32,
  padding: "0 8px",
  border: `1px solid ${T.border}`,
  borderRadius: 6,
  fontSize: 12.5,
  fontFamily: "inherit",
  outline: "none",
};

// ─── 오류 ─────────────────────────────────────────────────────────────────────

/**
 * ⚠ 501 은 **탭별로 다를 수 있다.** `condition` 은 CR-DB-001 테이블에 의존하고
 * `alarm` 은 `alerts` 기반이라 한쪽만 미구현일 수 있다. 빈 배열로 위장하지 않는다.
 */
function HistoryError({
  kind,
  message,
  onRetry,
}: {
  kind: ProcessHistoryKind;
  message: string;
  onRetry: () => void;
}) {
  const entry = resolveError({ status: null, message });
  const notImplemented = entry.status === 501;
  return (
    <StatusScreen
      tone="error"
      title={
        notImplemented
          ? `${kind === "condition" ? "공정 조건 변경" : "설비 알람"} 이력은 아직 제공되지 않습니다`
          : entry.title
      }
      detail={entry.detail}
      code={message}
      source={entry.source}
      actions={[{ label: "다시 시도", onClick: onRetry, primary: true }]}
    />
  );
}

// ─── [C-1] 공정 조건 변경 표 ───────────────────────────────────────────────────

function ConditionTable({
  rows,
  onDetail,
}: {
  rows: ConditionHistoryDto[];
  onDetail: (row: ConditionHistoryDto) => void;
}) {
  return (
    <div style={tableWrapStyle}>
      <table style={tableStyle}>
        <thead>
          <tr style={theadRowStyle}>
            <th style={thStyle}>변경일시</th>
            <th style={thStyle}>제품코드</th>
            <th style={{ ...thStyle, textAlign: "right" }}>버전</th>
            <th style={thStyle}>변경자</th>
            <th style={thStyle}>변경 항목 요약</th>
            <th style={{ ...thStyle, textAlign: "right" }}>상세</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} style={tbodyRowStyle}>
              <td style={tdStyle}>{dt(row.created_at)}</td>
              <td style={{ ...tdStyle, fontWeight: 600 }}>{row.product_code}</td>
              <td style={{ ...tdStyle, textAlign: "right" }}>
                {row.after.version === null || row.after.version === undefined
                  ? "—"
                  : String(row.after.version)}
              </td>
              {/* changed_by 가 null 이면 시스템 변경이다 */}
              <td style={tdStyle}>{row.changed_by_username ?? "시스템"}</td>
              <td style={tdStyle}>
                {row.before === null ? (
                  <StatusBadge variant="blue" label="신규 등록" />
                ) : (
                  changeSummary(row)
                )}
              </td>
              <td style={{ ...tdStyle, textAlign: "right" }}>
                <button type="button" className="btn" onClick={() => onDetail(row)}>
                  상세
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── [C-2] 설비 알람 표 ────────────────────────────────────────────────────────

function AlarmTable({ rows }: { rows: AlarmHistoryDto[] }) {
  return (
    <div style={tableWrapStyle}>
      <table style={tableStyle}>
        <thead>
          {/* ⚠ 설비ID 열이 없다 — `alerts` 에 설비 FK 가 없고 메시지 파싱은 금지다 (§2.2) */}
          <tr style={theadRowStyle}>
            <th style={thStyle}>발생일시</th>
            <th style={thStyle}>등급</th>
            <th style={thStyle}>메시지</th>
            <th style={thStyle}>관련 LOT</th>
            <th style={thStyle}>해소여부</th>
            <th style={thStyle}>해소일시</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const meta = LEVEL_META[row.level];
            return (
              <tr key={row.id} style={tbodyRowStyle}>
                <td style={tdStyle}>{dt(row.created_at)}</td>
                <td style={tdStyle}>
                  <StatusBadge variant={meta.variant} label={meta.label} dot />
                </td>
                <td style={{ ...tdStyle, whiteSpace: "normal" }}>{row.message}</td>
                <td style={tdStyle}>
                  {row.lot_id ? (
                    <Link href={`/shipping/lot?lot_id=${encodeURIComponent(row.lot_id)}`}>
                      {row.lot_id}
                    </Link>
                  ) : (
                    "—"
                  )}
                </td>
                <td style={tdStyle}>
                  <StatusBadge
                    variant={row.resolved ? "green" : "gray"}
                    label={row.resolved ? "해소" : "미해소"}
                  />
                </td>
                <td style={tdStyle}>{row.resolved_at ? dt(row.resolved_at) : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── [D] diff 모달 ────────────────────────────────────────────────────────────

function DiffModal({ row, onClose }: { row: ConditionHistoryDto | null; onClose: () => void }) {
  const isNew = row?.before === null;
  const changed = row && !isNew ? new Set(changedKeys(row)) : new Set<string>();

  return (
    <Modal
      open={row !== null}
      onClose={onClose}
      title="공정 조건 변경 상세"
      description={row ? `${row.product_code} · ${dt(row.created_at)} · ${row.changed_by_username ?? "시스템"}` : undefined}
      width={620}
      footer={
        <button type="button" className="btn" onClick={onClose}>
          닫기
        </button>
      }
    >
      {row && (
        <>
          {isNew && (
            <div style={{ marginBottom: 12 }}>
              <StatusBadge variant="blue" label="신규 등록 — 이전 값이 없습니다" />
            </div>
          )}
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
            <thead>
              <tr style={theadRowStyle}>
                <th style={thStyle}>항목</th>
                <th style={{ ...thStyle, textAlign: "right" }}>변경 전</th>
                <th style={{ ...thStyle, textAlign: "right" }}>변경 후</th>
              </tr>
            </thead>
            <tbody>
              {DIFF_SPECS.map((spec) => {
                const isChanged = changed.has(spec.key);
                const color = isChanged ? T.text : T.textMuted;
                return (
                  <tr key={spec.key} style={tbodyRowStyle}>
                    <td style={{ ...tdStyle, color, fontWeight: isChanged ? 700 : 400 }}>
                      {spec.label}
                    </td>
                    <td style={{ ...tdStyle, textAlign: "right", color }}>
                      {/* `before === null` 은 "신규 등록" 이다. 0 이나 "null" 로 채우지 않는다 */}
                      {row.before === null ? "" : spec.format(row.before[spec.key])}
                    </td>
                    <td
                      style={{
                        ...tdStyle,
                        textAlign: "right",
                        color: isChanged ? T.primary : T.textMuted,
                        fontWeight: isChanged ? 700 : 400,
                      }}
                    >
                      {spec.format(row.after[spec.key])}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}
    </Modal>
  );
}

// ─── 표 스타일 (globals.css `.card` 와 같은 면 처리) ────────────────────────────

const tableWrapStyle: React.CSSProperties = {
  overflowX: "auto",
  borderRadius: 12,
  border: `1px solid ${T.border}`,
  background: T.surface,
  boxShadow: "0 1px 2px rgba(16,24,40,.03)",
};

const tableStyle: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: 12.5,
  fontVariantNumeric: "tabular-nums",
};

const theadRowStyle: React.CSSProperties = { background: T.surfaceSubtle };

const thStyle: React.CSSProperties = {
  padding: "10px 14px",
  textAlign: "left",
  fontSize: 11.5,
  fontWeight: 600,
  color: T.textSub,
  letterSpacing: "0.03em",
  borderBottom: `1px solid ${T.border}`,
  whiteSpace: "nowrap",
};

const tbodyRowStyle: React.CSSProperties = { borderBottom: `1px solid ${T.border}` };

const tdStyle: React.CSSProperties = {
  padding: "10px 14px",
  color: T.text,
  whiteSpace: "nowrap",
};
