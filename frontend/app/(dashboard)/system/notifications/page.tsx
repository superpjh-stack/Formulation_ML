"use client";

/**
 * FE-RT-28 · `/system/notifications` · 알림 설정 (FR-SY-03) — **`admin` 전용**
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * 🔴 이전 구현의 임계값 `1.5 / 0.1 / 0.05` 는 **틀린 값**이었다. 정본은 goal.md 2.3 의
 *   `2.0 / 0.3 / 0.1` 이고, 화면은 그 숫자를 **타이핑하지 않고 서버에서 읽는다**
 *   (`usePublicSettings()` → `deviation_warn`·`quality_pass_score`·`temp_warn_c`).
 *   `source === 'fallback'` 이면 배너로 그 사실을 밝힌다.
 *
 * 🔴 `recipients: ["품질팀 전체", "이배합"]` 도 삭제했다 — `notification_rules` 에
 *   `recipients` 컬럼이 없다. 수신자를 `system_settings` 키로 우회 저장하지 마라
 *   (이메일 목록은 `VARCHAR(255)` 를 쉽게 넘고 검증·중복제거·개별 삭제가 불가능해진다).
 *
 * ⚠ **임계값의 단일 원천은 `system_settings` 다** (§2.1). `notification_rules.threshold` 는
 *   v1 에서 `null` 로 둔다 — 둘 다 채우면 반드시 어긋나고, `deviation_exceed` 는 임계값이
 *   3개(Sn·Ag·Cu)인데 `threshold` 컬럼은 1개라 애초에 표현할 수도 없다.
 *   이 화면은 임계값을 **읽어서 보여주기만** 하고, 편집은 FE-RT-29 로 보낸다.
 *
 * ⚠ **`PUT /notification-rules` 는 전체 교체다.** 항상 6행(3×2)을 모두 보낸다.
 *   변경된 행만 보내면 나머지가 사라진다. (FE-RT-29 의 부분 upsert 와 의미가 다르다.)
 *
 * ⚠ 규칙 추가/삭제 UI 를 만들지 마라 — `event_type` 3값 × `channel` 2값 고정이다.
 * ══════════════════════════════════════════════════════════════════════════════
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import * as api from "@/lib/koryo-api";
import { useNotificationRules, usePublicSettings } from "@/hooks/useKoryoData";
import { resolveError } from "@/lib/error-contract";
import { StatusScreen } from "@/components/layout/StatusScreen";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { ErrorAlert } from "@/components/ui/ErrorAlert";
import { T } from "@/components/ui/tokens";
import type {
  NotificationChannel,
  NotificationEventType,
  NotificationRuleDto,
  PublicSettingsDto,
} from "@/types/api";

/** 3값 고정 (FR-SY-03 문장에서 그대로 온 값이다) */
const EVENTS: NotificationEventType[] = ["quality_fail", "deviation_exceed", "equipment_warning"];
/** 2값 고정 */
const CHANNELS: NotificationChannel[] = ["system", "email"];

const EVENT_LABELS: Record<NotificationEventType, string> = {
  quality_fail: "품질 이상",
  deviation_exceed: "성분 편차 초과",
  equipment_warning: "설비 경고",
};

const CHANNEL_LABELS: Record<NotificationChannel, string> = {
  system: "시스템",
  email: "이메일",
};

/** 조건 설명의 숫자는 **전부 서버 설정에서 렌더한다.** 문구에도 하드코딩하지 않는다 */
function conditionText(event: NotificationEventType, s: PublicSettingsDto | null): string {
  if (s === null) return "임계값을 불러오는 중입니다";
  switch (event) {
    case "quality_fail":
      return `품질 점수 ${s.quality_pass_score}점 미만`;
    case "deviation_exceed":
      return `Sn ±${s.deviation_warn.sn.toFixed(1)} · Ag ±${s.deviation_warn.ag.toFixed(1)} · Cu ±${s.deviation_warn.cu.toFixed(1)} %p 초과`;
    case "equipment_warning":
      return `설비 온도 ${s.temp_warn_c}°C 초과`;
  }
}

const keyOf = (e: NotificationEventType, c: NotificationChannel) => `${e}:${c}`;

/** 응답에 없는 조합은 기본 `enabled=false` 로 채운다. 6행을 항상 확보한다 */
function toMatrix(rules: NotificationRuleDto[] | null): Record<string, boolean> {
  const map: Record<string, boolean> = {};
  for (const e of EVENTS) {
    for (const c of CHANNELS) {
      map[keyOf(e, c)] = false;
    }
  }
  for (const r of rules ?? []) {
    map[keyOf(r.event_type, r.channel)] = r.enabled;
  }
  return map;
}

export default function NotificationSettingsPage() {
  const rules = useNotificationRules();
  const settings = usePublicSettings();

  const [draft, setDraft] = useState<Record<string, boolean> | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  useEffect(() => {
    if (rules.data) setDraft(toMatrix(rules.data));
  }, [rules.data]);

  const serverMatrix = useMemo(() => toMatrix(rules.data), [rules.data]);
  const dirty =
    draft !== null && Object.keys(serverMatrix).some((k) => serverMatrix[k] !== draft[k]);

  const publicSettings = settings.data?.settings ?? null;
  const thresholdFallback = settings.data?.source === "fallback";
  const allOff = draft !== null && Object.values(draft).every((v) => !v);

  async function save() {
    if (!draft) return;
    setSaving(true);
    setSaveError(null);
    setSavedAt(null);
    try {
      // 🔴 6행 전체를 보낸다. `threshold` 는 null 로 둔다 (§2.1 이중 원천 방지)
      const body: NotificationRuleDto[] = EVENTS.flatMap((e) =>
        CHANNELS.map((c) => ({
          event_type: e,
          channel: c,
          enabled: draft[keyOf(e, c)],
          threshold: null,
        }))
      );
      await api.putNotificationRules(body);
      setSavedAt(new Date());
      rules.refetch();
    } catch (err) {
      const entry = resolveError(err);
      setSaveError(err instanceof Error ? err.message : entry.detail);
    } finally {
      setSaving(false);
    }
  }

  if (rules.loading) return <StatusScreen tone="loading" title="알림 설정을 불러오는 중" />;

  if (rules.error) {
    const entry = resolveError({ status: null, message: rules.error });
    const forbidden = /\b403\b/.test(rules.error) || entry.status === 403;
    return (
      <StatusScreen
        tone="error"
        title={forbidden ? "접근 권한이 없습니다" : entry.title}
        detail={forbidden ? "알림 설정은 관리자(admin)만 변경할 수 있습니다." : entry.detail}
        code={rules.error}
        source={entry.source}
        actions={
          forbidden
            ? [{ label: "생산 현황으로", href: "/dashboard/production", primary: true }]
            : [{ label: "다시 시도", onClick: rules.refetch, primary: true }]
        }
      />
    );
  }

  if (!draft) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* [A] 헤더 */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: T.text, margin: 0 }}>알림 설정</h1>
          <p style={{ fontSize: 12.5, color: T.textSub, margin: "4px 0 0" }}>
            품질 이상 · 성분 편차 초과 · 설비 경고 알림 채널 (FR-SY-03 · 관리자 전용)
          </p>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {dirty && !saving && <StatusBadge variant="amber" label="저장되지 않은 변경사항" dot />}
          {/* 저장 완료 배지는 서버 응답 이후에만 뜬다 */}
          {savedAt && !dirty && (
            <StatusBadge
              variant="green"
              label={`저장되었습니다 (${savedAt.toLocaleTimeString("ko-KR", { hour12: false })})`}
              dot
            />
          )}
          <button type="button" className="btn pri" disabled={!dirty || saving} onClick={() => void save()}>
            {saving ? "저장 중…" : "저장"}
          </button>
        </div>
      </div>

      {saveError && <ErrorAlert message={`저장하지 못했습니다 — ${saveError}`} />}

      {thresholdFallback && (
        <div style={bannerStyle}>
          알림 조건의 임계값을 서버에서 불러오지 못해 기본값으로 표시하고 있습니다. 아래 숫자가 실제
          운영값과 다를 수 있습니다.
          {settings.data?.error ? ` (${settings.data.error})` : ""}
        </div>
      )}

      {allOff && (
        <div style={bannerStyle}>
          알림을 모두 끄면 품질 불합격·설비 이상을 놓칠 수 있습니다. 저장은 가능합니다.
        </div>
      )}

      {/* [B] 매트릭스 — 이벤트 3행 × 채널 2열 */}
      <div className="card">
        <div style={sectionTitle}>알림 규칙</div>
        <div style={tableWrapStyle}>
          <table style={tableStyle}>
            <thead>
              <tr style={{ background: T.surfaceSubtle }}>
                <th style={thStyle}>이벤트</th>
                <th style={thStyle}>조건</th>
                {CHANNELS.map((c) => (
                  <th key={c} style={{ ...thStyle, textAlign: "center", width: 120 }}>
                    {CHANNEL_LABELS[c]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {EVENTS.map((e) => (
                <tr key={e} style={{ borderBottom: `1px solid ${T.border}` }}>
                  <td style={{ ...tdStyle, fontWeight: 600 }}>{EVENT_LABELS[e]}</td>
                  <td style={{ ...tdStyle, color: T.textSub, whiteSpace: "normal" }}>
                    {conditionText(e, publicSettings)}
                  </td>
                  {CHANNELS.map((c) => {
                    const k = keyOf(e, c);
                    return (
                      <td key={c} style={{ ...tdStyle, textAlign: "center" }}>
                        <label style={{ display: "inline-flex", gap: 6, alignItems: "center", cursor: "pointer" }}>
                          <input
                            type="checkbox"
                            checked={draft[k]}
                            disabled={saving}
                            aria-label={`${EVENT_LABELS[e]} — ${CHANNEL_LABELS[c]} 알림`}
                            onChange={(ev) => {
                              setDraft((prev) => (prev ? { ...prev, [k]: ev.target.checked } : prev));
                              setSavedAt(null);
                              setSaveError(null);
                            }}
                          />
                          <span style={{ fontSize: 11.5, color: draft[k] ? T.success : T.textMuted, fontWeight: 600 }}>
                            {draft[k] ? "ON" : "OFF"}
                          </span>
                        </label>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p style={{ fontSize: 11.5, color: T.warning, margin: "12px 0 0" }}>
          ⚠ 이메일 발송은 준비 중입니다 — 발송 인프라(SMTP)가 아직 구성돼 있지 않아 이메일 채널을 켜도
          실제 메일이 나가지 않습니다.
        </p>
        <p style={{ fontSize: 11, color: T.textMuted, margin: "6px 0 0" }}>
          알림 수신자 지정은 제공하지 않습니다 — 수신자를 저장할 컬럼이 없습니다.
        </p>
      </div>

      {/* [C] 현재 임계값 (읽기 전용) */}
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, gap: 12 }}>
          <div style={{ ...sectionTitle, marginBottom: 0 }}>현재 임계값 (읽기 전용)</div>
          <Link href="/system/config" className="btn">
            시스템 설정에서 변경 →
          </Link>
        </div>
        {settings.loading ? (
          <p style={{ fontSize: 12.5, color: T.textSub, margin: 0 }}>임계값을 불러오는 중…</p>
        ) : publicSettings === null ? (
          <ErrorAlert message={settings.error ?? "임계값을 불러오지 못했습니다"} />
        ) : (
          <dl style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12, margin: 0, fontSize: 13 }}>
            <Item label="품질 합격선" value={`${publicSettings.quality_pass_score} 점`} />
            <Item label="Sn 편차 경고" value={`±${publicSettings.deviation_warn.sn.toFixed(1)} %p`} />
            <Item label="Ag 편차 경고" value={`±${publicSettings.deviation_warn.ag.toFixed(1)} %p`} />
            <Item label="Cu 편차 경고" value={`±${publicSettings.deviation_warn.cu.toFixed(1)} %p`} />
            <Item label="설비 온도 경고" value={`${publicSettings.temp_warn_c} °C`} />
          </dl>
        )}
        <p style={{ fontSize: 11, color: T.textMuted, margin: "12px 0 0", lineHeight: 1.6 }}>
          임계값은 시스템 설정(FR-SY-04)이 단일 원천입니다. 이 화면은 어떤 이벤트를 어떤 채널로 보낼지만
          관리합니다.
        </p>
      </div>
    </div>
  );
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt style={{ fontSize: 11, color: T.textMuted, fontWeight: 600 }}>{label}</dt>
      <dd style={{ margin: "2px 0 0", color: T.text, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
        {value}
      </dd>
    </div>
  );
}

// ─── 스타일 ───────────────────────────────────────────────────────────────────

const bannerStyle: React.CSSProperties = {
  background: "#FFFBEB",
  border: "1px solid #FCD34D",
  borderRadius: 10,
  padding: "10px 14px",
  fontSize: 12.5,
  color: "#92400E",
};

const sectionTitle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 700,
  color: T.text,
  marginBottom: 14,
};

const tableWrapStyle: React.CSSProperties = {
  overflowX: "auto",
  borderRadius: 12,
  border: `1px solid ${T.border}`,
  background: T.surface,
};

const tableStyle: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: 12.5,
};

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

const tdStyle: React.CSSProperties = {
  padding: "10px 14px",
  color: T.text,
  whiteSpace: "nowrap",
};
