"use client";

/**
 * 그룹1(FE-RT-02~15) 14화면 공용 조각.
 *
 * ⚠ `components/` · `lib/` · `hooks/` · `types/` 는 라운드 2 에서 **수정 금지**다.
 *    그래서 14화면이 공통으로 쓰는 것만 라우트 그룹 내부의 **비공개 폴더**(`_g1`)에 둔다.
 *    `_` 로 시작하는 폴더는 Next.js App Router 가 라우트로 만들지 않는다.
 *
 * 여기 있는 것은 전부 **표시 로직**이다. 판정값·임계값은 하나도 만들지 않는다 —
 * 합격 판정은 `lib/quality.ts`, 임계값은 `usePublicSettings()`, 오류 문구는
 * `lib/error-contract.ts` 가 정본이다.
 */

import React, { useEffect, useState } from "react";
import { ErrorAlert } from "@/components/ui/ErrorAlert";
import { Spinner } from "@/components/ui/Spinner";
import { StatusScreen, type StatusScreenAction } from "@/components/layout/StatusScreen";
import { T } from "@/components/ui/tokens";
import {
  ERROR_CONTRACT,
  UNKNOWN_ERROR,
  extractStatus,
  type ErrorContractEntry,
} from "@/lib/error-contract";
import { currentRole } from "@/lib/auth";
import type { UserRole } from "@/types/auth";
import type { PublicSettingsState } from "@/lib/koryo-api";

// ══════════════════════════════════════════════════════════════════════════════
// 1. 오류 분류 — 훅의 `error: string` 을 계약 6종에 맞춘다
// ══════════════════════════════════════════════════════════════════════════════

/**
 * `useKoryoData` 의 `error` 는 문자열이라 `ApiError.status` 가 남아 있지 않다.
 * 다만 백엔드가 내려주는 `detail` 이 **계약 문구 그대로**라서 문구로 되짚을 수 있다.
 *
 * 되짚지 못하면 `UNKNOWN_ERROR`("요청을 처리하지 못했습니다")로 두고
 * **원문 메시지를 화면에 그대로 노출한다.** 삼키지 않는다 (goal.md §3).
 */
export function classifyHookError(message: string | null | undefined): ErrorContractEntry {
  const text = message ?? "";

  const status = extractStatus(text);
  if (status !== null && ERROR_CONTRACT[status]) return ERROR_CONTRACT[status];

  // 네트워크 단절·타임아웃 → 계약 503. FE-RT-02 수용기준 3 이 이 문구를 요구한다.
  if (/서버에 연결할 수 없습니다|서버 응답이 없습니다|Failed to fetch|NetworkError/i.test(text)) {
    return ERROR_CONTRACT[503];
  }
  if (/로그인이 필요합니다/.test(text)) return ERROR_CONTRACT[401];
  if (/접근 권한이 없습니다/.test(text)) return ERROR_CONTRACT[403];
  if (/찾을 수 없습니다/.test(text)) return ERROR_CONTRACT[404];
  if (/미구현/.test(text)) return ERROR_CONTRACT[501];
  if (/서비스 일시 중단/.test(text)) return ERROR_CONTRACT[503];

  return UNKNOWN_ERROR;
}

/** 화면 전체가 실패했을 때. 계약 문구 + **원문 메시지** + 재시도. */
export function ScreenError({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  const entry = classifyHookError(message);
  const actions: StatusScreenAction[] = [];
  if (onRetry && entry.action !== "home") {
    actions.push({ label: "다시 시도", onClick: onRetry, primary: true });
  }
  if (entry.action === "home" || entry.action === "login") {
    actions.push({ label: "생산 현황으로", href: "/dashboard/production" });
  }
  return (
    <StatusScreen
      tone="error"
      title={entry.title}
      detail={entry.detail}
      code={message}
      actions={actions}
      source={entry.source}
    />
  );
}

/** 카드 하나만 실패했을 때. 화면 전체를 덮지 않는다 (design-standards §3.2). */
export function InlineError({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  const entry = classifyHookError(message);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <ErrorAlert message={`${entry.title} — ${message}`} />
      {onRetry && (
        <button type="button" className="btn" style={{ alignSelf: "flex-start" }} onClick={onRetry}>
          다시 시도
        </button>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// 2. 카드 단위 상태 — 로딩 / 오류 / 빈 데이터를 한 곳에서
// ══════════════════════════════════════════════════════════════════════════════

interface SectionStateProps {
  loading: boolean;
  error: string | null;
  /** true 면 "빈 데이터" 로 본다 */
  empty?: boolean;
  emptyText?: string;
  onRetry?: () => void;
  /** 자리를 유지할 최소 높이 (차트 자리 등) */
  minHeight?: number;
  children: React.ReactNode;
}

/**
 * 세 갈래를 **전부** 렌더한다. 하나라도 빠뜨리면 라운드 2 의 의미가 없다.
 * 로딩 중에는 직전 값을 남기지 않는다 — 오래된 값이 현재값으로 오독된다 (plan-g1 §0.4).
 */
export function SectionState({
  loading,
  error,
  empty = false,
  emptyText = "조회 조건에 해당하는 데이터가 없습니다",
  onRetry,
  minHeight = 160,
  children,
}: SectionStateProps) {
  if (loading) return <CenterBox minHeight={minHeight}><Spinner size="md" /></CenterBox>;
  if (error)
    return (
      <CenterBox minHeight={minHeight}>
        <div style={{ width: "100%", maxWidth: 520 }}>
          <InlineError message={error} onRetry={onRetry} />
        </div>
      </CenterBox>
    );
  if (empty)
    return (
      <CenterBox minHeight={minHeight}>
        <span style={{ fontSize: 13, color: T.textMuted }}>{emptyText}</span>
      </CenterBox>
    );
  return <>{children}</>;
}

export function CenterBox({
  minHeight = 160,
  children,
}: {
  minHeight?: number;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        minHeight,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      {children}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// 3. 설정 폴백 배너 — `usePublicSettings()` 가 서버 값을 못 읽었을 때
// ══════════════════════════════════════════════════════════════════════════════

/**
 * `source === 'fallback'` 이면 임계값(합격선·온도경고·편차임계)이 **서버 값이 아니다.**
 * 화면이 정상으로 보이면서 판정 기준만 다를 수 있으므로 **반드시 드러낸다.**
 */
export function SettingsFallbackBanner({ settings }: { settings: PublicSettingsState | null }) {
  if (!settings || settings.source !== "fallback") return null;
  return (
    <div
      role="status"
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 8,
        padding: "10px 14px",
        borderRadius: 8,
        border: `1px solid ${T.warning}`,
        background: "#FEF6E7",
        fontSize: 12.5,
        lineHeight: 1.6,
        color: "#B45309",
      }}
    >
      <span aria-hidden="true">⚠</span>
      <span>
        기준값을 불러오지 못해 <strong>기본값</strong>으로 표시 중입니다 (합격선{" "}
        {settings.settings.quality_pass_score}점 · 온도 경고 {settings.settings.temp_warn_c}℃ · 편차
        임계 {settings.settings.deviation_warn.sn}/{settings.settings.deviation_warn.ag}/
        {settings.settings.deviation_warn.cu}). 서버 설정이 다르면 판정이 어긋날 수 있습니다.
        {settings.error ? ` (${settings.error})` : ""}
      </span>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// 4. 501 배너 — AI Agent 2화면
// ══════════════════════════════════════════════════════════════════════════════

export function NotImplementedBanner({ reason }: { reason: string }) {
  const entry = ERROR_CONTRACT[501];
  return (
    <div
      role="status"
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        padding: "14px 16px",
        borderRadius: 10,
        border: `1px solid ${T.border}`,
        background: T.surfaceSubtle,
        color: T.textSub,
      }}
    >
      <span aria-hidden="true" style={{ fontSize: 15, lineHeight: "20px" }}>
        🚧
      </span>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <strong style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{entry.title}</strong>
        <span style={{ fontSize: 12.5, lineHeight: 1.6 }}>{reason}</span>
        <span style={{ fontSize: 11, color: T.textMuted }}>{entry.source}</span>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// 5. 페이지 골격 (design-standards §1.2 — 세로 리듬 24)
// ══════════════════════════════════════════════════════════════════════════════

export function PageShell({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>{children}</div>;
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "space-between",
        gap: 16,
        flexWrap: "wrap",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: T.text, margin: 0, lineHeight: 1.3 }}>
          {title}
        </h1>
        {subtitle && (
          <span style={{ fontSize: 12.5, color: T.textSub, lineHeight: 1.5 }}>{subtitle}</span>
        )}
      </div>
      {actions && <div style={{ display: "flex", alignItems: "center", gap: 8 }}>{actions}</div>}
    </div>
  );
}

export function Section({
  title,
  right,
  children,
  padded = true,
}: {
  title?: React.ReactNode;
  right?: React.ReactNode;
  children: React.ReactNode;
  padded?: boolean;
}) {
  return (
    <section
      className={padded ? "card" : undefined}
      style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}
    >
      {(title || right) && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          {typeof title === "string" ? (
            <h2 style={{ fontSize: 16, fontWeight: 600, color: T.text, margin: 0 }}>{title}</h2>
          ) : (
            title
          )}
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// 6. 필터 바 · 입력 조각
// ══════════════════════════════════════════════════════════════════════════════

export function FilterBar({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="card"
      style={{
        display: "flex",
        alignItems: "flex-end",
        gap: 12,
        flexWrap: "wrap",
      }}
    >
      {children}
    </div>
  );
}

const CONTROL_STYLE: React.CSSProperties = {
  height: 34,
  padding: "0 10px",
  borderRadius: 8,
  border: `1px solid ${T.border}`,
  background: T.surface,
  fontSize: 12.5,
  color: T.text,
  fontFamily: "inherit",
};

export function Field({
  label,
  htmlFor,
  children,
  width,
}: {
  label: string;
  htmlFor?: string;
  children: React.ReactNode;
  width?: number;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5, width }}>
      <label
        htmlFor={htmlFor}
        style={{ fontSize: 12, fontWeight: 600, color: T.textSub, letterSpacing: "0.02em" }}
      >
        {label}
      </label>
      {children}
    </div>
  );
}

export function Select({
  value,
  onChange,
  options,
  id,
  disabled,
  width = 150,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  id?: string;
  disabled?: boolean;
  width?: number;
}) {
  return (
    <select
      id={id}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      style={{ ...CONTROL_STYLE, width }}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function DateInput({
  value,
  onChange,
  id,
  invalid,
  width = 150,
}: {
  value: string;
  onChange: (v: string) => void;
  id?: string;
  invalid?: boolean;
  width?: number;
}) {
  return (
    <input
      id={id}
      type="date"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        ...CONTROL_STYLE,
        width,
        borderColor: invalid ? T.error : T.border,
      }}
    />
  );
}

export function TextInput({
  value,
  onChange,
  id,
  placeholder,
  width = 170,
  invalid,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  id?: string;
  placeholder?: string;
  width?: number;
  invalid?: boolean;
  disabled?: boolean;
}) {
  return (
    <input
      id={id}
      type="text"
      value={value}
      disabled={disabled}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      style={{ ...CONTROL_STYLE, width, borderColor: invalid ? T.error : T.border }}
    />
  );
}

export const PAGE_SIZE_OPTIONS = [
  { value: "20", label: "20개씩" },
  { value: "50", label: "50개씩" },
  { value: "100", label: "100개씩" },
  { value: "200", label: "200개씩" },
];

/** `SUP_D` 는 존재하지 않는다 — 3코드가 전부다 (ts-types §4 `SupplierCode`) */
export const SUPPLIER_CODES = ["SUP_A", "SUP_B", "SUP_C"] as const;

export const SUPPLIER_FILTER_OPTIONS = [
  { value: "", label: "전체" },
  ...SUPPLIER_CODES.map((c) => ({ value: c, label: c })),
];

// ══════════════════════════════════════════════════════════════════════════════
// 7. 페이지네이션 — `Page<T>` 봉투 전용
// ══════════════════════════════════════════════════════════════════════════════

export function Pagination({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (p: number) => void;
}) {
  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  // 한 페이지에 다 들어가면 **페이지 버튼만** 감춘다.
  // 초판은 컴포넌트를 통째로 `return null` 해서 "전체 N건" 건수까지 사라졌고,
  // 필터를 걸어 결과가 1건이 되면 총건수를 확인할 방법이 없었다 (QA-A D-02).
  const multiPage = total > pageSize;
  if (total === 0) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        flexWrap: "wrap",
      }}
    >
      <span style={{ fontSize: 12, color: T.textSub }}>
        전체 {total.toLocaleString()}건 중 {from.toLocaleString()}–{to.toLocaleString()}
      </span>
      {multiPage && (
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <button type="button" className="btn" disabled={page <= 1} onClick={() => onPage(1)}>
          « 처음
        </button>
        <button type="button" className="btn" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          ‹ 이전
        </button>
        <span style={{ fontSize: 12.5, color: T.text, padding: "0 6px" }}>
          {page} / {lastPage}
        </span>
        <button
          type="button"
          className="btn"
          disabled={page >= lastPage}
          onClick={() => onPage(page + 1)}
        >
          다음 ›
        </button>
        <button
          type="button"
          className="btn"
          disabled={page >= lastPage}
          onClick={() => onPage(lastPage)}
        >
          마지막 »
        </button>
      </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// 8. RBAC — 쓰기 버튼은 `disabled` 로 사전 차단한다 (ts-types §6.3)
// ══════════════════════════════════════════════════════════════════════════════

/**
 * JWT 에서 역할을 읽는다. **권한 판정의 정본은 서버의 403 이다** — 이건 이중 방어다.
 * `sessionStorage` 는 SSR 에 없으므로 마운트 후에 읽는다 (하이드레이션 불일치 방지).
 */
export function useRole(): UserRole | null {
  const [role, setRole] = useState<UserRole | null>(null);
  useEffect(() => {
    setRole(currentRole());
  }, []);
  return role;
}

/** 역할이 아직 안 읽혔으면(`null`) 쓰기를 막는다 — 낙관적으로 열어주지 않는다 */
export function hasRole(role: UserRole | null, ...allowed: UserRole[]): boolean {
  return role !== null && allowed.includes(role);
}

// ══════════════════════════════════════════════════════════════════════════════
// 9. 표시 포맷 — "값 없음" 과 "0" 을 절대 섞지 않는다 (ts-types §3.1)
// ══════════════════════════════════════════════════════════════════════════════

export const DASH = "—";

/** `null`/`undefined`/`NaN` → `—`. **0 으로 채우지 않는다.** */
export function num(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return DASH;
  return v.toFixed(digits);
}

export function pct(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return DASH;
  return `${v.toFixed(digits)}%`;
}

/** 부호를 항상 붙인다 (`+0.14` / `-0.35`) — 편차 표기용 */
export function signed(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return DASH;
  const s = v.toFixed(digits);
  return v > 0 ? `+${s}` : s;
}

export function int(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return DASH;
  return Math.round(v).toLocaleString();
}

/** ISO 8601 → `YYYY-MM-DD HH:mm` (문자열 절단 — 타임존 변환을 하지 않는다) */
export function dateTime(iso: string | null | undefined): string {
  if (!iso) return DASH;
  return iso.length >= 16 ? `${iso.slice(0, 10)} ${iso.slice(11, 16)}` : iso;
}

export function dateOnly(iso: string | null | undefined): string {
  if (!iso) return DASH;
  return iso.slice(0, 10);
}

/** 오늘 - N일 (`YYYY-MM-DD`, 로컬 기준) */
export function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return toYmd(d);
}

export function today(): string {
  return toYmd(new Date());
}

function toYmd(d: Date): string {
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}
