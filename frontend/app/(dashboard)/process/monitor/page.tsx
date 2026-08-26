"use client";

/**
 * FE-RT-22 · `/process/monitor` · 실시간 모니터 (FR-P-02)
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * 🔴 이 화면은 웨이브 B 이전에 **센서값을 발명하고 있었다.**
 *   `INITIAL_SENSORS` 6종 + `driftValue()` 의 **난수 생성기**로 2초마다 값을 만들어
 *   **백엔드가 죽어도 화면이 계속 움직였다.** RPM·압력·유량은 저장 컬럼조차 없다.
 *   센서별 `critical`/`low` 임계값 역시 산출물 어디에도 없는 수치였다.
 *
 * 지금은 `GET /api/v1/equipment` **10초 폴링**만이 값의 출처다 (api-contract §8.6).
 *   - WebSocket 금지 — SF-TD2 에 설계가 없다
 *   - 탭이 숨겨지면 폴링 중단, 복귀 시 즉시 1회 조회 후 재개
 *   - 이전 요청이 안 끝났으면 이번 틱은 건너뛴다 (요청 중첩 금지)
 *   - **연속 3회 실패 → 폴링 정지 + "연결이 끊어졌습니다" 배너.** 계속 움직이면 실패다
 *
 * 🔴 **온도 임계값 숫자를 이 소스에 쓰지 마라.** 경고는 응답의 `temp_warning`(서버 판정)만 쓴다.
 *   게이지 눈금 기준선은 `GET /settings/public` 의 `temp_warn_c` 를 읽는다 —
 *   프론트가 임계값을 알고 있으면 FE-RT-29 의 설정 변경이 화면에 반영되지 않는다.
 *
 * 🔴 온도 시계열 테이블이 없다 → **라이브 스파크라인은 삭제됐다.**
 *   `equipment` 는 현재값 1행만 보관한다. 페이지를 연 뒤부터 쌓은 배열을 그리면
 *   그건 "가짜 추이"다. 되살리려면 `equipment_readings` 테이블이 필요하다 (CR-DB-002).
 * ══════════════════════════════════════════════════════════════════════════════
 */

import { useCallback, useEffect, useRef, useState } from "react";
import * as api from "@/lib/koryo-api";
import { usePublicSettings } from "@/hooks/useKoryoData";
import { resolveError } from "@/lib/error-contract";
import { StatusScreen } from "@/components/layout/StatusScreen";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { PillFilter } from "@/components/ui/PillFilter";
import { Spinner } from "@/components/ui/Spinner";
import { T } from "@/components/ui/tokens";
import type { EquipmentDto, EquipmentState } from "@/types/api";

// ─── 규약 상수 ────────────────────────────────────────────────────────────────

/** api-contract §8.6. 사용자가 바꿀 수 없다 (2초는 NFR-P-04 에서 초당 10요청이 된다) */
const POLL_INTERVAL_MS = 10_000;

/** 연속 실패가 이 횟수에 도달하면 폴링을 **정지**한다 */
const MAX_CONSECUTIVE_FAILURES = 3;

const STATE_META: Record<EquipmentState, { label: string; variant: "green" | "amber" | "red" | "gray"; color: string }> = {
  normal: { label: "정상", variant: "green", color: T.success },
  warning: { label: "경고", variant: "amber", color: T.warning },
  error: { label: "이상", variant: "red", color: T.error },
  maintenance: { label: "점검", variant: "gray", color: T.textSub },
};

const STATE_ORDER: EquipmentState[] = ["normal", "warning", "error", "maintenance"];

type StatusFilter = "all" | EquipmentState;

const FILTER_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "전체" },
  ...STATE_ORDER.map((s) => ({ value: s as StatusFilter, label: STATE_META[s].label })),
];

// ─── 폴링 훅 ──────────────────────────────────────────────────────────────────

interface PollState {
  data: EquipmentDto[] | null;
  /** 서버가 보고한 전체 건수 — 표시 건수와 다르면 화면이 경고한다 */
  total: number | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
  /** 마지막 **성공** 시각 */
  lastSuccessAt: Date | null;
  /** 연속 실패 3회로 폴링이 멈춘 상태 */
  stopped: boolean;
  /** 폴링 중 갱신 요청이 진행 중 */
  refreshing: boolean;
  /** 마지막 오류의 HTTP 상태 (있으면) */
  errorStatus: number | null;
  paused: boolean;
  setPaused: (v: boolean) => void;
}

/**
 * `GET /equipment` 10초 폴링.
 *
 * `useKoryoData` 의 `useEquipment(status, pollMs)` 를 쓰지 않는 이유:
 * 그 훅은 `setInterval(refetch)` 만 걸어서 ① 탭 비활성 중단 ② 요청 중첩 방지
 * ③ 연속 실패 시 정지 ④ 폴링 갱신 중 스켈레톤 억제 를 모두 하지 않는다.
 * FE-RT-22 §2.1 의 4개 규칙이 이 화면의 수용 기준이라 여기서 직접 관리한다.
 * (`hooks/` 는 개발3 소유라 수정하지 않는다.)
 */
function useEquipmentPolling(status: StatusFilter): PollState {
  const [data, setData] = useState<EquipmentDto[] | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [lastSuccessAt, setLastSuccessAt] = useState<Date | null>(null);
  const [stopped, setStopped] = useState(false);
  const [paused, setPaused] = useState(false);
  const [tick, setTick] = useState(0);

  /** 진행 중 요청 — 중첩 금지 가드 */
  const inFlight = useRef(false);
  const failures = useRef(0);
  const alive = useRef(true);
  const hasData = useRef(false);

  const load = useCallback(async () => {
    if (inFlight.current) return; // 이전 응답이 아직이면 이번 틱은 건너뛴다
    inFlight.current = true;
    if (hasData.current) setRefreshing(true);
    try {
      const page = await api.getEquipment(status === "all" ? undefined : status);
      if (!alive.current) return;
      failures.current = 0;
      hasData.current = true;
      setData(page.items);
      setTotal(page.total);
      setLastSuccessAt(new Date());
      setError(null);
      setErrorStatus(null);
      setStopped(false);
    } catch (err) {
      if (!alive.current) return;
      failures.current += 1;
      setError(err instanceof Error ? err.message : "설비 정보를 불러오지 못했습니다");
      setErrorStatus(
        typeof err === "object" && err !== null && typeof (err as { status?: unknown }).status === "number"
          ? (err as { status: number }).status
          : null
      );
      // 🔴 실패해도 mock 으로 대체하지 않는다. 3회 연속이면 폴링을 **정지**한다.
      if (failures.current >= MAX_CONSECUTIVE_FAILURES) setStopped(true);
    } finally {
      inFlight.current = false;
      if (alive.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [status]);

  // 최초 로드 + 필터 변경 + 수동 재연결
  useEffect(() => {
    alive.current = true;
    failures.current = 0;
    hasData.current = false;
    setLoading(true);
    setStopped(false);
    void load();
    return () => {
      alive.current = false;
    };
  }, [load, tick]);

  // 폴링 타이머 — 정지·일시정지·탭 비활성이면 돌지 않는다
  useEffect(() => {
    if (stopped || paused) return;

    let timer: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (timer !== null) return;
      timer = setInterval(() => void load(), POLL_INTERVAL_MS);
    };
    const stop = () => {
      if (timer === null) return;
      clearInterval(timer);
      timer = null;
    };

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        stop(); // 숨겨진 탭에서는 요청을 내지 않는다
      } else {
        void load(); // 복귀 즉시 1회 조회 후 재개
        start();
      }
    };

    if (document.visibilityState !== "hidden") start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [load, stopped, paused]);

  const refetch = useCallback(() => setTick((t) => t + 1), []);

  return {
    data,
    total,
    loading,
    error,
    refetch,
    lastSuccessAt,
    stopped,
    refreshing,
    errorStatus,
    paused,
    setPaused,
  };
}

// ─── 온도 게이지 ──────────────────────────────────────────────────────────────

/**
 * SVG 아크 게이지. **경고 판정은 하지 않는다** — 색은 서버 `temp_warning` 이 정한다.
 * 눈금 상한은 `/settings/public` 의 `temp_warn_c` 에서 파생시킨다 (하드코딩 금지).
 */
function TempGauge({
  temperature,
  warn,
  warnThreshold,
}: {
  temperature: number | null;
  warn: boolean;
  warnThreshold: number;
}) {
  const scaleMax = warnThreshold * 1.2 || 1;
  const ratio =
    temperature === null ? 0 : Math.min(1, Math.max(0, temperature / scaleMax));
  const arcColor = warn ? T.error : T.primary;

  const r = 36;
  const cx = 50;
  const cy = 54;
  const strokeW = 7;
  const startAngle = -210;
  const sweep = 240;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const arcX = (a: number) => cx + r * Math.cos(toRad(a));
  const arcY = (a: number) => cy + r * Math.sin(toRad(a));
  const arcPath = (a1: number, a2: number) => {
    const large = Math.abs(a2 - a1) > 180 ? 1 : 0;
    return `M ${arcX(a1)} ${arcY(a1)} A ${r} ${r} 0 ${large} 1 ${arcX(a2)} ${arcY(a2)}`;
  };

  // 경고 기준선 눈금 (서버 임계값 위치)
  const markAngle = startAngle + sweep * Math.min(1, warnThreshold / scaleMax);

  return (
    <div style={{ textAlign: "center" }}>
      <svg width="100" height="70" viewBox="0 0 100 70" role="img" aria-label="설비 온도">
        <path
          d={arcPath(startAngle, startAngle + sweep)}
          fill="none"
          stroke={T.surfaceSubtle}
          strokeWidth={strokeW}
          strokeLinecap="round"
        />
        {ratio > 0 && (
          <path
            d={arcPath(startAngle, startAngle + sweep * ratio)}
            fill="none"
            stroke={arcColor}
            strokeWidth={strokeW}
            strokeLinecap="round"
          />
        )}
        <line
          x1={cx + (r - strokeW) * Math.cos(toRad(markAngle))}
          y1={cy + (r - strokeW) * Math.sin(toRad(markAngle))}
          x2={cx + (r + strokeW) * Math.cos(toRad(markAngle))}
          y2={cy + (r + strokeW) * Math.sin(toRad(markAngle))}
          stroke={T.warning}
          strokeWidth="1.5"
        />
        {temperature === null ? (
          <text x={cx} y={cy} textAnchor="middle" fontSize="10" fill={T.textMuted}>
            측정값 없음
          </text>
        ) : (
          <>
            <text
              x={cx}
              y={cy - 4}
              textAnchor="middle"
              fontSize="13"
              fontWeight="800"
              fill={arcColor}
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {temperature.toFixed(1)}
            </text>
            <text x={cx} y={cy + 10} textAnchor="middle" fontSize="9" fill={T.textMuted}>
              °C
            </text>
          </>
        )}
      </svg>
    </div>
  );
}

// ─── 설비 카드 ────────────────────────────────────────────────────────────────

/**
 * ⚠ `status` 배지와 온도 경고 아이콘은 **독립**이다 (§6).
 * `status='normal'` 인데 `temp_warning=true` 일 수 있으므로 하나로 합치지 않는다.
 */
function EquipmentCard({
  eq,
  warnThreshold,
  stale,
  onSelect,
}: {
  eq: EquipmentDto;
  warnThreshold: number;
  stale: boolean;
  onSelect: (eqId: string) => void;
}) {
  const meta = STATE_META[eq.status];
  const alarm = eq.status === "error" || eq.temp_warning;

  return (
    <button
      type="button"
      onClick={() => onSelect(eq.eq_id)}
      className="card"
      style={{
        textAlign: "left",
        cursor: "pointer",
        background: alarm ? "#FEF1F2" : eq.status === "warning" ? "#FFFBEB" : T.surface,
        borderColor: alarm ? "#FCA5A5" : eq.status === "warning" ? "#FCD34D" : T.border,
        position: "relative",
        overflow: "hidden",
        opacity: stale ? 0.55 : 1,
        transition: "opacity .2s",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: 6,
          gap: 8,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontSize: 11.5,
              fontWeight: 600,
              color: T.textSub,
              letterSpacing: "0.03em",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {eq.eq_id}
          </div>
          <div
            style={{
              fontSize: 13,
              fontWeight: 700,
              color: T.text,
              marginTop: 2,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {eq.name}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
          <StatusBadge variant={meta.variant} label={meta.label} dot />
          {/* 온도 경고는 서버 판정(`temp_warning`). 상태 배지와 별개로 표시한다 */}
          {eq.temp_warning && (
            <span
              title="온도 경고 — 서버 판정 (temp_warning)"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                padding: "2px 8px",
                borderRadius: 20,
                fontSize: 11,
                fontWeight: 700,
                color: "#B91C1C",
                background: "#FEE2E2",
              }}
            >
              🌡 온도 경고
            </span>
          )}
        </div>
      </div>

      <TempGauge
        temperature={eq.temperature}
        warn={eq.temp_warning}
        warnThreshold={warnThreshold}
      />

      <div
        style={{
          marginTop: 8,
          display: "flex",
          justifyContent: "space-between",
          fontSize: 10.5,
          color: T.textMuted,
        }}
      >
        <span>가동 {eq.uptime === null ? "—" : `${eq.uptime.toLocaleString("ko-KR")}h`}</span>
        <span>점검 {eq.last_maintenance ?? "—"}</span>
      </div>
    </button>
  );
}

// ─── 페이지 ───────────────────────────────────────────────────────────────────

export default function ProcessMonitorPage() {
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<EquipmentDto | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);

  const settings = usePublicSettings();
  const poll = useEquipmentPolling(filter);

  const warnThreshold = settings.data?.settings.temp_warn_c ?? 0;
  const thresholdFallback = settings.data?.source === "fallback";

  // 설비 상세 — `eq_id`(VARCHAR UK)로 조회한다. 내부 BIGINT id 를 쓰지 않는다.
  useEffect(() => {
    if (!selected) {
      setDetail(null);
      setDetailError(null);
      return;
    }
    let cancelled = false;
    setDetail(null);
    setDetailError(null);
    api
      .getEquipmentById(selected)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const entry = resolveError(err);
        setDetailError(
          entry.status === 404
            ? `${selected} 을(를) 찾을 수 없습니다`
            : err instanceof Error
              ? err.message
              : entry.title
        );
      });
    return () => {
      cancelled = true;
    };
  }, [selected]);

  const items = poll.data;

  /**
   * 서버가 보고한 전체 건수보다 적게 받았으면 그 사실을 **숨기지 않는다.**
   * 이 화면은 페이지네이션이 없는 관제 화면이라, 잘린 설비는 조용히 사라진다.
   * (QA-B DEF-B-02 — 서버 `total:100` 인데 50대만 표시되고 안내가 없었다)
   */
  const truncated =
    items !== null && poll.total !== null && poll.total > items.length
      ? poll.total - items.length
      : null;

  // 최초 로드: 데이터가 아직 한 번도 없을 때만 전면 상태 화면을 쓴다
  if (poll.loading && items === null) {
    return <StatusScreen tone="loading" title="설비 상태를 불러오는 중" />;
  }
  if (items === null && poll.error) {
    const entry = resolveError({ status: poll.errorStatus, message: poll.error });
    return (
      <StatusScreen
        tone="error"
        title={entry.title}
        detail={entry.detail}
        code={poll.error}
        source={entry.source}
        actions={[{ label: "다시 시도", onClick: poll.refetch, primary: true }]}
      />
    );
  }

  const rows = items ?? [];
  const counts = STATE_ORDER.reduce<Record<EquipmentState, number>>(
    (acc, s) => {
      acc[s] = rows.filter((r) => r.status === s).length;
      return acc;
    },
    { normal: 0, warning: 0, error: 0, maintenance: 0 }
  );
  const tempWarned = rows.filter((r) => r.temp_warning);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* [A] 헤더 */}
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: T.text, margin: 0 }}>실시간 모니터</h1>
          <p style={{ fontSize: 12.5, color: T.textSub, margin: "4px 0 0" }}>
            설비 온도·작동 상태 · {POLL_INTERVAL_MS / 1000}초 폴링 (탭이 숨겨지면 중단)
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: T.textSub }}>
            {poll.refreshing ? (
              <Spinner size="sm" />
            ) : (
              <span
                aria-hidden="true"
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: poll.stopped ? T.error : poll.paused ? T.textMuted : T.success,
                  display: "inline-block",
                }}
              />
            )}
            마지막 갱신:{" "}
            <span style={{ fontVariantNumeric: "tabular-nums" }}>
              {poll.lastSuccessAt ? poll.lastSuccessAt.toLocaleTimeString("ko-KR", { hour12: false }) : "--:--:--"}
            </span>
            {poll.stopped && <span style={{ color: T.error, fontWeight: 600 }}>(연결 끊김)</span>}
          </div>
          <button
            type="button"
            className="btn"
            onClick={() => poll.setPaused(!poll.paused)}
            disabled={poll.stopped}
          >
            {poll.paused ? "재개" : "일시정지"}
          </button>
        </div>
      </div>

      {/* 폴링 정지 배너 — 3회 연속 실패. 여기서 화면이 **멈춘다** */}
      {poll.stopped && (
        <div
          role="alert"
          style={{
            background: "#FEF1F2",
            border: `1px solid ${T.error}`,
            borderRadius: 10,
            padding: "12px 16px",
            display: "flex",
            gap: 12,
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#B91C1C" }}>연결이 끊어졌습니다</div>
            <div style={{ fontSize: 12, color: "#991B1B", marginTop: 4 }}>
              {MAX_CONSECUTIVE_FAILURES}회 연속 실패로 자동 갱신을 중단했습니다. 아래 값은{" "}
              {poll.lastSuccessAt
                ? `${poll.lastSuccessAt.toLocaleTimeString("ko-KR", { hour12: false })} 기준`
                : "마지막 성공 시점 기준"}{" "}
              이며 현재 상태가 아닙니다. ({poll.error})
            </div>
          </div>
          <button type="button" className="btn pri" onClick={poll.refetch} style={{ flexShrink: 0 }}>
            재연결
          </button>
        </div>
      )}

      {/* 폴링 중 단발 실패 (아직 3회 미만) — 조용히 넘기지 않는다 */}
      {!poll.stopped && poll.error && items !== null && (
        <div
          role="alert"
          style={{
            background: "#FFFBEB",
            border: "1px solid #FCD34D",
            borderRadius: 10,
            padding: "10px 14px",
            fontSize: 12.5,
            color: "#92400E",
          }}
        >
          최근 갱신에 실패했습니다 — {poll.error} (연속 {MAX_CONSECUTIVE_FAILURES}회 실패 시 자동 갱신을 중단합니다)
        </div>
      )}

      {/* 임계값 출처 배너 — 게이지 눈금 기준선을 서버에서 못 읽었다는 사실을 숨기지 않는다 */}
      {thresholdFallback && (
        <div
          style={{
            background: "#FFFBEB",
            border: "1px solid #FCD34D",
            borderRadius: 10,
            padding: "10px 14px",
            fontSize: 12.5,
            color: "#92400E",
          }}
        >
          온도 기준값을 서버에서 불러오지 못해 기본값({warnThreshold}°C)으로 눈금을 그리고 있습니다.
          경고 판정 자체는 서버의 <code>temp_warning</code> 을 그대로 사용합니다.
          {settings.data?.error ? ` (${settings.data.error})` : ""}
        </div>
      )}

      {/* [B] 온도 경고 배너 — temp_warning 서버 판정 기준 */}
      {tempWarned.length > 0 && (
        <div
          role="alert"
          style={{
            background: "#FEF1F2",
            border: "1px solid #FCA5A5",
            borderRadius: 10,
            padding: "12px 16px",
            display: "flex",
            gap: 12,
            alignItems: "flex-start",
          }}
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" style={{ flexShrink: 0, marginTop: 1 }}>
            <path d="M9 1L17 16H1L9 1z" stroke={T.error} strokeWidth="1.5" strokeLinejoin="round" />
            <path d="M9 7v4M9 12.5v.5" stroke={T.error} strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#B91C1C", marginBottom: 4 }}>
              온도 경고 {tempWarned.length}건{truncated !== null ? ` · 표시되지 않은 설비 ${truncated}대` : ""}
            </div>
            <div style={{ fontSize: 12, color: "#991B1B" }}>
              {tempWarned
                .map((e) => `${e.name} (${e.temperature === null ? "측정값 없음" : `${e.temperature.toFixed(1)}°C`})`)
                .join(" · ")}
            </div>
          </div>
        </div>
      )}

      {/* [C] 상태 요약 4장 + 필터 */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <PillFilter
          options={FILTER_OPTIONS}
          value={filter}
          onChange={(v) => {
            setFilter(v);
            setSelected(null);
          }}
          label="상태:"
        />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
          {STATE_ORDER.map((s) => (
            <div key={s} className="card" style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: "50%",
                  background: STATE_META[s].color,
                  flexShrink: 0,
                }}
              />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, color: T.textSub, fontWeight: 600, letterSpacing: "0.03em" }}>
                  {STATE_META[s].label}
                </div>
                <div
                  style={{
                    fontSize: 22,
                    fontWeight: 800,
                    color: STATE_META[s].color,
                    fontVariantNumeric: "tabular-nums",
                    lineHeight: 1.2,
                  }}
                >
                  {counts[s]}
                  <span style={{ fontSize: 12, fontWeight: 500, color: T.textMuted, marginLeft: 3 }}>대</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* [D] 설비 카드 그리드 */}
      {rows.length === 0 ? (
        <StatusScreen
          tone="empty"
          title={filter === "all" ? "등록된 설비가 없습니다" : "해당 상태의 설비가 없습니다"}
          detail={filter === "all" ? "설비 마스터에 등록된 항목이 없습니다." : undefined}
          actions={filter === "all" ? [] : [{ label: "전체 보기", onClick: () => setFilter("all") }]}
        />
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
          {rows.map((eq) => (
            <EquipmentCard
              key={eq.eq_id}
              eq={eq}
              warnThreshold={warnThreshold}
              stale={poll.stopped}
              onSelect={(id) => setSelected((prev) => (prev === id ? null : id))}
            />
          ))}
        </div>
      )}

      {/* 설비 상세 — 표시 전용. 계약에 쓰기 API 가 없으므로 수정 UI 를 만들지 않는다 */}
      {selected && (
        <div className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h2 style={{ fontSize: 16, fontWeight: 600, color: T.text, margin: 0 }}>
              설비 상세 · {selected}
            </h2>
            <button type="button" className="btn" onClick={() => setSelected(null)}>
              닫기
            </button>
          </div>
          {detailError ? (
            <div role="alert" style={{ fontSize: 13, color: T.error }}>
              {detailError}
            </div>
          ) : detail === null ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: T.textSub }}>
              <Spinner size="sm" /> 불러오는 중
            </div>
          ) : (
            <dl
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(4, 1fr)",
                gap: 12,
                margin: 0,
                fontSize: 13,
              }}
            >
              {[
                ["설비명", detail.name],
                ["상태", STATE_META[detail.status].label],
                ["온도", detail.temperature === null ? "측정값 없음" : `${detail.temperature.toFixed(1)} °C`],
                ["온도 경고", detail.temp_warning ? "예 (서버 판정)" : "아니오"],
                ["가동시간", detail.uptime === null ? "—" : `${detail.uptime.toLocaleString("ko-KR")} 시간`],
                ["최근 점검일", detail.last_maintenance ?? "—"],
                ["갱신시각", detail.updated_at.replace("T", " ")],
              ].map(([label, value]) => (
                <div key={label as string}>
                  <dt style={{ fontSize: 11, color: T.textMuted, fontWeight: 600 }}>{label}</dt>
                  <dd style={{ margin: "2px 0 0", color: T.text }}>{value}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      )}

      <p style={{ fontSize: 11, color: T.textMuted, margin: 0 }}>
        온도 추이 그래프는 제공하지 않습니다 — <code>equipment</code> 는 현재값 1행만 보관하며 시계열
        테이블이 없습니다 (CR-DB-002 대상). 온도 경고는 서버가 판정한 <code>temp_warning</code> 입니다.
      </p>
    </div>
  );
}
