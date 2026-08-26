"use client";

/**
 * 그룹3(FE-RT-30~45) 16화면 공용 조각.
 *
 * ⚠ `components/` · `lib/` · `hooks/` · `types/` 는 라운드 2 에서 **수정 금지**다.
 *    `app/(dashboard)/_g1/ui.tsx` 는 개발1 담당이라 **읽기만** 한다.
 *    그래서 내 16화면만 쓰는 것은 라우트 그룹 내부 비공개 폴더(`_g3`)에 둔다.
 *    `_` 로 시작하는 폴더는 Next.js App Router 가 라우트로 만들지 않는다.
 *
 * 여기 있는 것은 전부 **표시 로직 + 요청 상태 관리**다.
 * 판정값·임계값·오류 문구는 하나도 만들지 않는다 — 각각 `lib/quality.ts` ·
 * `usePublicSettings()` · `lib/error-contract.ts` 가 정본이다.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { T } from "@/components/ui/tokens";
import { ApiError } from "@/lib/api";

// ══════════════════════════════════════════════════════════════════════════════
// 1. 요청 상태 — `hooks/useKoryoData.ts` 의 `useAsyncData` 와 같은 3상태 규약
//    (그 파일은 개발1·2 가 동시에 읽고 있어 라운드 2 에서 건드리지 않는다)
// ══════════════════════════════════════════════════════════════════════════════

export interface ApiState<T> {
  data: T | null;
  loading: boolean;
  /** 사람이 읽을 오류 문장. **절대 삼키지 않는다** */
  error: string | null;
  /** HTTP 상태 — 501/403 처럼 화면이 분기해야 하는 코드를 위해 보존한다 */
  status: number | null;
  refetch: () => void;
}

export function errText(err: unknown): string {
  if (err instanceof Error) return err.message;
  return "데이터를 불러오지 못했습니다";
}

export function errStatus(err: unknown): number | null {
  if (err instanceof ApiError) return err.status;
  if (typeof err === "object" && err !== null) {
    const s = (err as { status?: unknown }).status;
    if (typeof s === "number") return s;
  }
  return null;
}

/**
 * `enabled: false` 면 요청을 보내지 않고 `loading:false` 로 대기한다
 * (조회 버튼을 눌러야 나가는 화면 — FE-RT-34·36·42).
 */
export function useApi<T>(
  fetcher: () => Promise<T>,
  deps: unknown[] = [],
  enabled = true
): ApiState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<number | null>(null);
  const [tick, setTick] = useState(0);

  const refetch = useCallback(() => setTick((t) => t + 1), []);

  const ref = useRef(fetcher);
  ref.current = fetcher;

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setStatus(null);

    ref
      .current()
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setData(null); // 실패했는데 직전 값을 남기면 오래된 값이 현재값으로 오독된다
        setError(errText(err));
        setStatus(errStatus(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, enabled, ...deps]);

  return { data, loading, error, status, refetch };
}

/** 쿼리 객체를 deps 로 쓸 때의 안정 키 */
export const qkey = (q: unknown) => JSON.stringify(q ?? null);

// ══════════════════════════════════════════════════════════════════════════════
// 2. 501 — "미구현" 판정과 배너
// ══════════════════════════════════════════════════════════════════════════════

/**
 * 501 인가. 백엔드는 `{"detail":"미구현 — v1 범위 밖"}` 을 준다.
 * `status` 가 살아 있으면 그것이 1순위이고, 문자열은 보조 경로다.
 */
export function isNotImplemented(status: number | null, message?: string | null): boolean {
  if (status === 501) return true;
  return /미구현|501/.test(message ?? "");
}

/**
 * §0.6.1 501 배너 규격 — FE-RT-37 · 38~42 **전용**.
 * 배경 `#FEF6E7` / 테두리 `#F59E0B` / 텍스트 `#1A2035`. 문구는 명세 그대로다.
 *
 * 🔴 이 배너가 떠 있는 동안 **모든 쓰기 버튼은 `disabled`**, 목록·차트는 빈 상태다.
 *    배너 아래에 표본 데이터·예시 숫자를 남기지 마라.
 */
export function PendingBanner({ note }: { note?: string }) {
  return (
    <div
      role="status"
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        padding: "14px 16px",
        borderRadius: 10,
        border: `1px solid ${T.warning}`,
        background: "#FEF6E7",
        color: "#1A2035",
      }}
    >
      <span aria-hidden="true" style={{ fontSize: 15, lineHeight: "20px" }}>
        ⚠
      </span>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
        <strong style={{ fontSize: 13, fontWeight: 600 }}>
          미구현 — 저장 테이블 없음 (선택 요구사항, CR-DB-002 후보)
        </strong>
        <span style={{ fontSize: 12.5, lineHeight: 1.6 }}>
          v1 범위에서는 데이터를 저장·조회하지 않습니다.
        </span>
        {note && (
          <span style={{ fontSize: 11.5, color: "#B45309", lineHeight: 1.6 }}>{note}</span>
        )}
      </div>
    </div>
  );
}

/**
 * 결과 영역의 "준비 중" 안내. **답변·리포트처럼 보이는 문장을 만들지 않는다.**
 * 서버가 준 `detail` 원문을 그대로 덧붙여 무엇을 받았는지 감추지 않는다.
 */
export function PendingResult({
  title = "준비 중입니다",
  detail,
  serverMessage,
}: {
  title?: string;
  detail: string;
  serverMessage?: string | null;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 6,
        padding: "18px 16px",
        borderRadius: 10,
        border: `1px dashed ${T.border}`,
        background: T.surfaceSubtle,
      }}
    >
      <strong style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{title}</strong>
      <span style={{ fontSize: 12.5, lineHeight: 1.6, color: T.textSub }}>{detail}</span>
      {serverMessage && (
        <code style={{ fontSize: 11, color: T.textMuted, wordBreak: "break-all" }}>
          서버 응답: {serverMessage}
        </code>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// 3. 알림 — 저장 결과처럼 사라지는 짧은 문장
// ══════════════════════════════════════════════════════════════════════════════

export type NoticeTone = "ok" | "warn" | "error";

const NOTICE_STYLE: Record<NoticeTone, { bg: string; fg: string; bd: string }> = {
  ok: { bg: "#ECFDF3", fg: "#15803D", bd: T.success },
  warn: { bg: "#FEF6E7", fg: "#B45309", bd: T.warning },
  error: { bg: "#FEF3F2", fg: "#B42318", bd: T.error },
};

export function Notice({ tone, children }: { tone: NoticeTone; children: React.ReactNode }) {
  const s = NOTICE_STYLE[tone];
  return (
    <div
      role="status"
      style={{
        padding: "10px 14px",
        borderRadius: 8,
        border: `1px solid ${s.bd}`,
        background: s.bg,
        color: s.fg,
        fontSize: 12.5,
        lineHeight: 1.6,
      }}
    >
      {children}
    </div>
  );
}

/** 입력 아래 인라인 오류 (422 필드 오류 등) */
export function FieldError({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <span style={{ fontSize: 11.5, color: T.error, lineHeight: 1.5 }}>{message}</span>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// 4. 읽기 전용 콜아웃 (FE-RT-30 피처 목표값 등)
// ══════════════════════════════════════════════════════════════════════════════

export function Callout({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        padding: "10px 14px",
        borderRadius: 8,
        border: `1px solid ${T.border}`,
        background: T.surfaceSubtle,
        fontSize: 12.5,
        color: T.textSub,
        lineHeight: 1.6,
      }}
    >
      {children}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// 5. 칩 필터 — 값이 서버 데이터에서 파생될 때 쓴다 (하드코딩 목록이 아니다)
// ══════════════════════════════════════════════════════════════════════════════

export function Chips({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            style={{
              height: 30,
              padding: "0 12px",
              borderRadius: 999,
              fontSize: 12.5,
              fontFamily: "inherit",
              cursor: "pointer",
              border: `1px solid ${active ? T.primary : T.border}`,
              background: active ? T.primary : T.surface,
              color: active ? "#fff" : T.textSub,
              fontWeight: active ? 600 : 400,
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// 6. 목표 대비 게이지 — FE-RT-43·44 (SF-AD3 기능대비표가 명시한 구성요소)
// ══════════════════════════════════════════════════════════════════════════════

/**
 * 🔴 **달성 판정을 프론트가 하지 않는다.** `achieved` 는 서버가 준 boolean 이다.
 * 지표별 판정 방향(불량률·클레임률만 낮을수록 좋음)을 프론트가 하드코딩하면
 * 지표가 추가될 때 반대로 판정한다 (plan-g3 FE-RT-43 §4).
 *
 * 🚨 `getQualityBadgeVariant()` 를 쓰지 않는다 — 그건 품질 **점수 등급**(4값)용이고
 *    KPI 달성 여부와 무관하다.
 *
 * `target` 이 `null` 이면 **아무것도 그리지 않는다.** 0 으로 채우거나 자리만
 * 차지하게 두지 않는다 (수용 기준 4).
 */
export function TargetGauge({
  label,
  actual,
  target,
  achieved,
  unit,
  digits,
}: {
  label: string;
  actual: number | null;
  target: number | null;
  achieved: boolean | null;
  unit: string;
  digits: number;
}) {
  if (target === null || target === undefined) return null;

  const hasActual = actual !== null && actual !== undefined && Number.isFinite(actual);
  // 순수 시각 비율이다 — 판정이 아니다. 실적과 목표 중 큰 값을 100% 로 둔다
  const span = Math.max(hasActual ? Math.abs(actual as number) : 0, Math.abs(target)) || 1;
  const actualPct = hasActual ? Math.min((Math.abs(actual as number) / span) * 100, 100) : 0;
  const targetPct = Math.min((Math.abs(target) / span) * 100, 100);

  const tone = achieved === null ? T.textMuted : achieved ? T.success : T.error;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: T.textSub }}>{label}</span>
        <div style={{ flex: 1 }} />
        <strong style={{ fontSize: 15, fontWeight: 700, color: T.text }}>
          {hasActual ? `${(actual as number).toFixed(digits)}${unit === "LOT" ? " " : ""}${unit}` : "—"}
        </strong>
        <span style={{ fontSize: 11.5, color: T.textMuted }}>
          / 목표 {target.toFixed(digits)}
          {unit === "LOT" ? " " : ""}
          {unit}
        </span>
        {achieved !== null && (
          <span style={{ fontSize: 11.5, fontWeight: 600, color: tone }}>
            {achieved ? "달성" : "미달"}
          </span>
        )}
      </div>

      <div
        style={{
          position: "relative",
          height: 10,
          borderRadius: 999,
          background: T.surfaceSubtle,
          border: `1px solid ${T.border}`,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${actualPct}%`,
            height: "100%",
            background: achieved === null ? T.primary : tone,
          }}
        />
        {/* 목표선 마커 */}
        <div
          style={{
            position: "absolute",
            left: `${targetPct}%`,
            top: -2,
            width: 2,
            height: 14,
            background: T.text,
          }}
        />
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// 7. 값 포맷 — `_g1/ui.tsx` 와 같은 규약. "값 없음" 과 "0" 을 섞지 않는다
// ══════════════════════════════════════════════════════════════════════════════

/** 현재 월 `YYYY-MM` (로컬 기준) */
export function thisMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, "0")}`;
}

/** 최근 N개월의 `YYYY-MM` 목록 (내림차순) */
export function recentMonths(n: number): string[] {
  const out: string[] = [];
  const d = new Date();
  for (let i = 0; i < n; i += 1) {
    out.push(`${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, "0")}`);
    d.setMonth(d.getMonth() - 1);
  }
  return out;
}

/** 알 수 없는 값을 표에 그릴 때 — 객체는 JSON, `null` 은 `—` */
export function cell(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "—";
  if (typeof v === "boolean") return v ? "예" : "아니오";
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}
