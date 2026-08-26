"use client";

/**
 * FE-RT-04 — 설비 현황 대시보드 · `/dashboard/equipment` · FR-D-03
 *
 * 명세: `specs/plan-g1.md` FE-RT-04. **SF-TD3 에 와이어프레임이 없어서**
 * 구성은 FR-D-03 본문 + `EquipmentDto` 필드 + 응답 `summary` 4값에서 도출했다.
 *
 * 라운드 2 에서 고친 것:
 *   - 🚨 **가짜 실시간 제거.** 이전 구현은 `setInterval` 로 `Math.random()` 을 3초마다 더해
 *     "실시간"을 흉내냈다 — 가짜 데이터를 실시간으로 위장하는 것이라 goal.md 3절 위반이다.
 *     → `GET /dashboard/equipment` **10초 폴링**으로 교체 (api-contract §8.6. WebSocket 금지)
 *   - 하드코딩 mock 삭제 (`EQUIPMENT` 8줄 · `ALARMS` 12줄 · `ALARM_COLUMNS` 17줄)
 *   - 🚨 **온도 경고 판정을 프론트에서 하지 않는다.** 이전 구현은 설비별 `normalMin~normalMax`
 *     (예 `1150~1200°C`)로 판정했는데 계약값 `255°C` 와 **두 자릿수 차이**였다 (부록 C).
 *     → 서버 `temp_warning` 그대로 사용. **이 파일에 `255` 리터럴이 없다**
 *   - 요약 카운트: 프론트 `filter().length` 3구분 → **서버 `summary` 4구분**
 *   - RPM·설비 유형 아이콘·경보 이력 표 제거 (DB 컬럼·엔드포인트 없음 — `TODO-G1-002`)
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useDashboardEquipment, usePublicSettings } from "@/hooks/useKoryoData";
import {
  EQUIPMENT_TEMP_WARN_C,
  type DashboardEquipmentDto,
  type EquipmentDto,
  type EquipmentState,
} from "@/types/api";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { ErrorAlert } from "@/components/ui/ErrorAlert";
import { T } from "@/components/ui/tokens";
import {
  CenterBox,
  DASH,
  PageHeader,
  PageShell,
  ScreenError,
  SettingsFallbackBanner,
  classifyHookError,
  dateOnly,
  int,
  num,
} from "../../_g1/ui";

/** api-contract §8.6 이 FE-RT-22 에 규정한 값. 같은 데이터원이므로 동일 적용 */
const POLL_MS = 10_000;

/** 연속 실패 이 횟수에 도달하면 폴링을 멈추고 사용자에게 알린다 (plan-g1 §9) */
const FAILURE_LIMIT = 3;

/** 응답에 `temp_warn_c` 가 실려 오는데 계약 타입에는 없다. 읽기만 확장한다 */
type EquipmentResponse = DashboardEquipmentDto & { temp_warn_c?: number };

const STATE_BADGE: Record<EquipmentState, { variant: "green" | "amber" | "red" | "gray"; label: string }> = {
  normal: { variant: "green", label: "정상" },
  warning: { variant: "amber", label: "경고" },
  error: { variant: "red", label: "이상" },
  maintenance: { variant: "gray", label: "점검중" },
};

const SUMMARY_ITEMS: { key: keyof DashboardEquipmentDto["summary"]; label: string; color: string }[] = [
  { key: "normal", label: "정상", color: "#22C55E" },
  { key: "warning", label: "경고", color: "#F59E0B" },
  { key: "error", label: "이상", color: "#EF4444" },
  { key: "maintenance", label: "점검중", color: "#687182" },
];

// ── 온도 게이지 ───────────────────────────────────────────────────────────────

/**
 * 경고 임계값 기준 게이지. 임계값은 **응답 `temp_warn_c` → `/settings/public`** 순으로
 * 받는다. 정상범위 min/max 컬럼은 DB 에 없으므로 단일 임계값만 쓴다.
 */
function TempGauge({ temperature, warnAt, warning }: { temperature: number; warnAt: number; warning: boolean }) {
  // 임계값을 눈금의 80% 지점에 두어 초과분이 보이게 한다
  const full = warnAt / 0.8;
  const ratio = Math.max(0, Math.min(1, temperature / full));
  const markAt = Math.max(0, Math.min(1, warnAt / full));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ position: "relative", height: 6, borderRadius: 3, background: T.border }}>
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: `${ratio * 100}%`,
            borderRadius: 3,
            background: warning ? T.error : T.primary,
          }}
        />
        {/* 경고 임계 눈금 */}
        <div
          style={{
            position: "absolute",
            left: `${markAt * 100}%`,
            top: -3,
            bottom: -3,
            width: 2,
            background: T.textSub,
            borderRadius: 1,
          }}
        />
      </div>
      <span style={{ fontSize: 10, color: T.textMuted }}>경고 임계 {warnAt}°C</span>
    </div>
  );
}

// ── 설비 카드 ─────────────────────────────────────────────────────────────────

function EquipmentCard({ eq, warnAt, stale }: { eq: EquipmentDto; warnAt: number; stale: boolean }) {
  const badge = STATE_BADGE[eq.status] ?? { variant: "gray" as const, label: eq.status };
  // 🔴 서버 판정값이다. 프론트에서 온도를 임계값과 다시 비교하지 않는다
  const warning = eq.temp_warning;

  return (
    <div
      className="card"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
        // 온도 경고 설비는 상단 Warning 스트라이프로 구분한다
        borderTop: warning ? `3px solid ${T.warning}` : `3px solid transparent`,
        opacity: stale ? 0.55 : 1,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: T.text }}>{eq.name}</span>
          <span style={{ fontSize: 11.5, color: T.textMuted, fontVariantNumeric: "tabular-nums" }}>
            {eq.eq_id}
          </span>
        </div>
        <StatusBadge variant={badge.variant} label={badge.label} dot />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <span style={{ fontSize: 11.5, fontWeight: 600, color: T.textSub }}>현재 온도</span>
          {warning && <StatusBadge variant="amber" label="온도 경고" />}
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
          <span
            style={{
              fontSize: 24,
              fontWeight: 800,
              color: warning ? T.error : T.text,
              lineHeight: 1,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {num(eq.temperature, 1)}
          </span>
          {eq.temperature !== null && (
            <span style={{ fontSize: 12, color: T.textMuted }}>°C</span>
          )}
        </div>
        {/* `null` 이면 게이지를 그리지 않는다. `0` 은 유효한 온도이므로 그린다 */}
        {eq.temperature !== null && (
          <TempGauge temperature={eq.temperature} warnAt={warnAt} warning={warning} />
        )}
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 8,
          paddingTop: 10,
          borderTop: `1px solid ${T.border}`,
          fontSize: 11.5,
          color: T.textSub,
        }}
      >
        <span>
          가동시간 <strong style={{ color: T.text }}>{num(eq.uptime, 1)}</strong>
          {eq.uptime !== null ? "h" : ""}
        </span>
        <span>
          점검 <strong style={{ color: T.text }}>{eq.last_maintenance ? dateOnly(eq.last_maintenance) : DASH}</strong>
        </span>
      </div>
      <span style={{ fontSize: 10.5, color: T.textMuted }}>
        갱신 {eq.updated_at.replace("T", " ").slice(0, 19)}
      </span>
    </div>
  );
}

// ── 페이지 ────────────────────────────────────────────────────────────────────

export default function EquipmentDashboardPage() {
  const { data, loading, error, refetch } = useDashboardEquipment();
  const settings = usePublicSettings();

  /** 연속 실패 횟수. 1~2회는 조용히 재시도하고 3회에서 폴링을 멈춘다 */
  const [failures, setFailures] = useState(0);
  const [lastSuccessAt, setLastSuccessAt] = useState<string | null>(null);
  const wasLoading = useRef(loading);

  // 요청 1건이 끝날 때마다 성공/실패를 센다 (`loading` 의 true→false 전이가 완료 신호다)
  useEffect(() => {
    if (wasLoading.current && !loading) {
      if (error) {
        setFailures((f) => f + 1);
      } else {
        setFailures(0);
        setLastSuccessAt(new Date().toLocaleTimeString("ko-KR", { hour12: false }));
      }
    }
    wasLoading.current = loading;
  }, [loading, error]);

  const pollingStopped = failures >= FAILURE_LIMIT;

  // 10초 폴링. 언마운트 시 `clearInterval`, 탭이 백그라운드면 건너뛴다
  useEffect(() => {
    if (pollingStopped) return;
    const id = setInterval(() => {
      if (typeof document === "undefined" || document.visibilityState === "visible") {
        refetch();
      }
    }, POLL_MS);
    return () => clearInterval(id);
  }, [pollingStopped, refetch]);

  // 탭으로 돌아오면 즉시 한 번 갱신한다 (백그라운드 동안 건너뛴 틱 보상)
  useEffect(() => {
    if (pollingStopped || typeof document === "undefined") return;
    const onVisible = () => {
      if (document.visibilityState === "visible") refetch();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [pollingStopped, refetch]);

  const reconnect = useCallback(() => {
    setFailures(0);
    refetch();
  }, [refetch]);

  // 임계값: 응답이 주면 응답, 없으면 `/settings/public`, 그것도 없으면 계약 상수.
  // 어느 경로든 **판정은 서버 `temp_warning`** 이고 이 값은 게이지 눈금에만 쓴다.
  const warnAt =
    (data as EquipmentResponse | null)?.temp_warn_c ??
    settings.data?.settings.temp_warn_c ??
    EQUIPMENT_TEMP_WARN_C;

  // 첫 로드 실패 — 보여줄 값이 아예 없다
  if (!data && error) return <ScreenError message={error} onRetry={reconnect} />;

  const polling = !pollingStopped && !!data;

  return (
    <PageShell>
      <PageHeader
        title="설비 현황 대시보드"
        subtitle="솔더링 머신·용해로·배합기 등 설비별 상태 실시간 표시 (FR-D-03 · 10초 폴링)"
        actions={
          <>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                fontSize: 12,
                color: polling ? "#15803D" : T.textMuted,
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: "50%",
                  background: polling ? "#22C55E" : "#9AA4B2",
                  animation: polling ? "koryo-pulse 1.6s ease-in-out infinite" : undefined,
                }}
              />
              {pollingStopped ? "폴링 중단됨" : "실시간"}
              {lastSuccessAt && (
                <span style={{ color: T.textMuted }}>· 마지막 갱신 {lastSuccessAt}</span>
              )}
            </span>
            <button type="button" className="btn" onClick={reconnect}>
              새로고침
            </button>
          </>
        }
      />

      <SettingsFallbackBanner settings={settings.data} />

      {/* 연속 3회 실패 — 폴링을 멈추고 실패를 드러낸다. 값은 stale 로 표시한다 */}
      {pollingStopped && error && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <ErrorAlert
            message={`${classifyHookError(error).title} — ${error} (연속 ${failures}회 실패, 자동 갱신을 중단했습니다)`}
          />
          <button type="button" className="btn pri" style={{ alignSelf: "flex-start" }} onClick={reconnect}>
            재연결
          </button>
        </div>
      )}

      {/* 폴링 1~2회 실패는 조용히 재시도하되 사실은 남긴다 */}
      {!pollingStopped && error && data && (
        <span style={{ fontSize: 11.5, color: T.warning }}>
          갱신 실패 {failures}회 — 표시된 값은 {lastSuccessAt ?? "이전"} 기준입니다. 재시도 중…
        </span>
      )}

      {!data ? (
        <CenterBox minHeight={420}>
          <span style={{ fontSize: 13, color: T.textMuted }}>불러오는 중…</span>
        </CenterBox>
      ) : (
        <>
          {/* ── 요약 스트립 — **서버 `summary`** 4값 ────────────────────── */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
            {SUMMARY_ITEMS.map((item) => (
              <div
                key={item.key}
                className="card"
                style={{ display: "flex", flexDirection: "column", gap: 8, borderTop: `3px solid ${item.color}` }}
              >
                <span
                  style={{
                    fontSize: 11.5,
                    fontWeight: 600,
                    color: T.textSub,
                    letterSpacing: "0.03em",
                    textTransform: "uppercase",
                  }}
                >
                  {item.label}
                </span>
                <div style={{ display: "flex", alignItems: "flex-end", gap: 4 }}>
                  <span
                    style={{
                      fontSize: 26,
                      fontWeight: 800,
                      color: item.color,
                      lineHeight: 1,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {int(data.summary[item.key])}
                  </span>
                  <span style={{ fontSize: 13, color: T.textMuted, marginBottom: 2 }}>대</span>
                </div>
              </div>
            ))}
          </div>

          {/* ── 설비 카드 그리드 (3열) ──────────────────────────────────── */}
          {data.items.length === 0 ? (
            <CenterBox minHeight={240}>
              <span style={{ fontSize: 13, color: T.textMuted }}>등록된 설비가 없습니다</span>
            </CenterBox>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 20 }}>
              {data.items.map((eq) => (
                <EquipmentCard key={eq.eq_id} eq={eq} warnAt={warnAt} stale={pollingStopped} />
              ))}
            </div>
          )}
        </>
      )}

      <style>{`
        @keyframes koryo-pulse {
          0%, 100% { opacity: 1; }
          50%      { opacity: 0.35; }
        }
      `}</style>
    </PageShell>
  );
}
