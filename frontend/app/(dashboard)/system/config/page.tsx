"use client";

/**
 * FE-RT-29 · `/system/config` · 시스템 설정 (FR-SY-04) — **`admin` 전용**
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * 🔴 이전 구현은 **저장하지 않고 "저장 완료" 배지를 띄웠다.**
 *   `handleSave()` 가 `setSaved(true)` 뿐이었다. 서버 호출이 한 줄도 없었다.
 *   조용한 실패의 전형이다 (goal.md 3절). 지금은 `PUT /api/v1/settings` 의
 *   **응답이 온 뒤에만** 성공 표시가 뜨고, 실패는 화면에 그대로 남는다.
 *
 * 🔴 편차 기본값도 틀렸다 — `1.5 / 0.1 / 0.05` 로 그려져 있었으나 정본은
 *   goal.md 2.3 의 **`2.0 / 0.3 / 0.1`** 이다. 이제 값은 전부 서버에서 온다.
 *
 * 🔴 삭제한 것: 활성 ML 모델 카드 4장(모델 전환 API 가 계약에 없다) ·
 *   RMSE/R² 하드코딩 수치(실측과 다르다) · R²/재학습주기/배치주기 슬라이더 3종
 *   (`system_settings` 키에 없다) · 시스템 정보 6칸(전부 사실과 다른 값이었다 —
 *   버전을 보여주려면 `GET /health` 확장이 필요하다).
 *
 * 🔒 성분 목표값 3종은 **입력 컨트롤을 두지 않는다** (§2.1-1).
 *   `disabled input` 은 "권한이 없나?" 로 읽혀서 관리자가 권한을 올려 뚫으려 든다.
 *   실제 이유는 권한이 아니라 **모델 재학습이 필요**하다는 것이고, 서버도 이 3키를
 *   받으면 422 로 거부한다. 그래서 값 표시 + 자물쇠 + 이유 설명으로 그린다.
 * ══════════════════════════════════════════════════════════════════════════════
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import * as api from "@/lib/koryo-api";
import { useSystemSettings } from "@/hooks/useKoryoData";
import { resolveError } from "@/lib/error-contract";
import { StatusScreen } from "@/components/layout/StatusScreen";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { ErrorAlert } from "@/components/ui/ErrorAlert";
import { Modal } from "@/components/ui/Modal";
import { Spinner } from "@/components/ui/Spinner";
import { T } from "@/components/ui/tokens";
import type { SystemSettingsDto, SystemSettingsPatch } from "@/types/api";

// ─── 화면 라벨의 정본 (§2.4-b — DB `description` 이 아니다) ────────────────────

const SETTING_LABELS = {
  sn_target: "Sn 목표",
  ag_target: "Ag 목표",
  cu_target: "Cu 목표",
  quality_pass_score: "품질 합격 기준점",
  temp_warn_c: "설비 온도 경고",
  deviation_warn_sn: "Sn 편차 경고",
  deviation_warn_ag: "Ag 편차 경고",
  deviation_warn_cu: "Cu 편차 경고",
} as const;

/** 목표값 잠금 사유 — 툴팁 전문 (§2.1-3 수용 기준 2) */
const TARGET_LOCK_REASON =
  "이 값은 학습된 ML 모델의 파생 피처 기준입니다. 변경하면 저장된 예측 모델 4종이 모두 무효가 되고, " +
  "과거 성분 편차 데이터와 기준이 어긋납니다. 변경하려면 모델 재학습이 함께 필요합니다.";

/** 편집 가능한 5키. UI 가드 범위는 §6 (산출물에 상한이 없는 항목은 본 명세 판단값) */
type EditableKey = "quality_pass_score" | "temp_warn_c" | "dev_sn" | "dev_ag" | "dev_cu";

interface FieldSpec {
  key: EditableKey;
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  decimals: number;
  hint: string;
}

const QUALITY_FIELDS: FieldSpec[] = [
  {
    key: "quality_pass_score",
    label: SETTING_LABELS.quality_pass_score,
    unit: "점",
    min: 0,
    max: 100,
    step: 1,
    decimals: 0,
    hint: "이 점수 이상이면 합격으로 판정합니다 (판정은 서버가 저장 시점에 계산합니다).",
  },
];

const THRESHOLD_FIELDS: FieldSpec[] = [
  {
    key: "temp_warn_c",
    label: SETTING_LABELS.temp_warn_c,
    unit: "°C",
    min: 1,
    max: 500,
    step: 1,
    decimals: 0,
    hint: "이 온도를 초과하면 설비 카드에 온도 경고가 표시됩니다 (실시간 모니터).",
  },
  {
    key: "dev_sn",
    label: SETTING_LABELS.deviation_warn_sn,
    unit: "%p",
    min: 0.1,
    max: 10,
    step: 0.1,
    decimals: 1,
    hint: "목표값 대비 Sn 함량 편차가 이 값을 넘으면 경고합니다.",
  },
  {
    key: "dev_ag",
    label: SETTING_LABELS.deviation_warn_ag,
    unit: "%p",
    min: 0.1,
    max: 5,
    step: 0.1,
    decimals: 1,
    hint: "목표값 대비 Ag 함량 편차가 이 값을 넘으면 경고합니다.",
  },
  {
    key: "dev_cu",
    label: SETTING_LABELS.deviation_warn_cu,
    unit: "%p",
    min: 0.1,
    max: 1.5,
    step: 0.1,
    decimals: 1,
    hint: "목표값 대비 Cu 함량 편차가 이 값을 넘으면 경고합니다.",
  },
];

type Draft = Record<EditableKey, string>;

function draftOf(s: SystemSettingsDto): Draft {
  return {
    quality_pass_score: String(s.quality_pass_score),
    temp_warn_c: String(s.temp_warn_c),
    dev_sn: String(s.deviation_warn.sn),
    dev_ag: String(s.deviation_warn.ag),
    dev_cu: String(s.deviation_warn.cu),
  };
}

// ─── 잠금 값 카드 ─────────────────────────────────────────────────────────────

function LockedTarget({ label, value }: { label: string; value: number }) {
  return (
    <div
      style={{
        background: T.surfaceSubtle,
        border: `1px solid ${T.border}`,
        borderRadius: 8,
        padding: "12px 14px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 11.5, color: T.textSub, fontWeight: 600 }}>{label}</span>
        <span aria-hidden="true">🔒</span>
        <span
          tabIndex={0}
          role="note"
          aria-label={`${label} 잠금 사유`}
          title={TARGET_LOCK_REASON}
          style={{
            width: 16,
            height: 16,
            borderRadius: "50%",
            border: `1px solid ${T.border}`,
            fontSize: 10,
            lineHeight: "14px",
            textAlign: "center",
            color: T.textSub,
            cursor: "help",
          }}
        >
          ?
        </span>
      </div>
      {/* 🔒 입력 컨트롤이 아니다 — 값 표시다 (§2.1-1) */}
      <div
        style={{
          fontSize: 22,
          fontWeight: 700,
          color: T.text,
          marginTop: 4,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value.toFixed(1)}
        <span style={{ fontSize: 12, fontWeight: 500, color: T.textMuted, marginLeft: 4 }}>%</span>
      </div>
    </div>
  );
}

// ─── 슬라이더 + 숫자 이중 입력 ─────────────────────────────────────────────────

function ThresholdRow({
  spec,
  value,
  onChange,
  error,
  disabled,
}: {
  spec: FieldSpec;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  disabled: boolean;
}) {
  const num = Number(value);
  const sliderValue = Number.isFinite(num) ? Math.min(spec.max, Math.max(spec.min, num)) : spec.min;

  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          marginBottom: 6,
          gap: 12,
        }}
      >
        <div>
          <span style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{spec.label}</span>
          <span style={{ fontSize: 11.5, color: T.textMuted, marginLeft: 8 }}>{spec.hint}</span>
        </div>
        <span
          style={{
            fontSize: 14,
            fontWeight: 800,
            color: error ? T.error : T.primary,
            fontVariantNumeric: "tabular-nums",
            minWidth: 70,
            textAlign: "right",
          }}
        >
          {value === "" ? "—" : value}
          {spec.unit}
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: 11, color: T.textMuted, width: 36, textAlign: "right" }}>
          {spec.min}
        </span>
        <input
          type="range"
          aria-label={`${spec.label} 슬라이더`}
          min={spec.min}
          max={spec.max}
          step={spec.step}
          value={sliderValue}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          style={{ flex: 1, accentColor: T.primary, height: 4 }}
        />
        <span style={{ fontSize: 11, color: T.textMuted, width: 36 }}>{spec.max}</span>
        <input
          type="number"
          aria-label={spec.label}
          min={spec.min}
          max={spec.max}
          step={spec.step}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          style={{
            width: 84,
            height: 32,
            padding: "0 8px",
            border: `1px solid ${error ? T.error : T.border}`,
            borderRadius: 6,
            fontSize: 12.5,
            fontFamily: "inherit",
            textAlign: "right",
            outline: "none",
          }}
        />
      </div>
      {error && (
        <div role="alert" style={{ fontSize: 11.5, color: T.error, marginTop: 4 }}>
          {error}
        </div>
      )}
    </div>
  );
}

// ─── 페이지 ───────────────────────────────────────────────────────────────────

export default function SystemConfigPage() {
  const { data, loading, error, refetch } = useSystemSettings();

  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // 서버 값이 도착/재조회될 때만 폼을 초기화한다
  useEffect(() => {
    if (data) setDraft(draftOf(data));
  }, [data]);

  const dirtyKeys = useMemo<EditableKey[]>(() => {
    if (!data || !draft) return [];
    const base = draftOf(data);
    return (Object.keys(base) as EditableKey[]).filter(
      (k) => Number(base[k]) !== Number(draft[k]) || draft[k] === ""
    );
  }, [data, draft]);

  const fieldErrors = useMemo<Partial<Record<EditableKey, string>>>(() => {
    if (!draft) return {};
    const out: Partial<Record<EditableKey, string>> = {};
    for (const spec of [...QUALITY_FIELDS, ...THRESHOLD_FIELDS]) {
      const raw = draft[spec.key];
      if (raw === "") {
        out[spec.key] = "값을 입력하세요";
        continue;
      }
      const n = Number(raw);
      if (!Number.isFinite(n)) {
        out[spec.key] = "숫자를 입력하세요";
      } else if (n < spec.min || n > spec.max) {
        out[spec.key] = `${spec.label}은(는) ${spec.min} ~ ${spec.max}${spec.unit} 사이여야 합니다`;
      } else if (spec.decimals === 0 && !Number.isInteger(n)) {
        out[spec.key] = "정수로 입력하세요";
      }
    }
    return out;
  }, [draft]);

  const hasFieldError = Object.keys(fieldErrors).length > 0;
  const dirty = dirtyKeys.length > 0;
  const passScoreChanged = dirtyKeys.includes("quality_pass_score");

  // 미저장 변경 이탈 경고 (§9)
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  const setField = useCallback((k: EditableKey, v: string) => {
    setDraft((prev) => (prev ? { ...prev, [k]: v } : prev));
    setSavedAt(null);
    setSaveError(null);
  }, []);

  /**
   * 🔴 **`sn_target`/`ag_target`/`cu_target` 은 body 에 들어가지 않는다.**
   * 타입(`SystemSettingsPatch`)에서도 제외돼 있고, 서버는 받으면 422 를 낸다.
   * 화면 상태(`Draft`)에 아예 없으므로 실수로 실릴 경로가 없다.
   */
  function buildPatch(): SystemSettingsPatch {
    if (!draft) return {};
    const patch: SystemSettingsPatch = {};
    if (dirtyKeys.includes("quality_pass_score")) {
      patch.quality_pass_score = Number(draft.quality_pass_score);
    }
    if (dirtyKeys.includes("temp_warn_c")) {
      patch.temp_warn_c = Number(draft.temp_warn_c);
    }
    if (dirtyKeys.some((k) => k === "dev_sn" || k === "dev_ag" || k === "dev_cu")) {
      // `deviation_warn` 은 객체 단위 필드다 — 3값을 함께 보낸다
      patch.deviation_warn = {
        sn: Number(draft.dev_sn),
        ag: Number(draft.dev_ag),
        cu: Number(draft.dev_cu),
      };
    }
    return patch;
  }

  async function doSave() {
    setConfirmOpen(false);
    setSaving(true);
    setSaveError(null);
    try {
      // 🔴 서버 응답을 받은 **뒤에만** 성공 표시를 낸다
      await api.putSettings(buildPatch());
      setSavedAt(new Date());
      refetch();
    } catch (err) {
      const entry = resolveError(err);
      setSaveError(err instanceof Error ? err.message : entry.detail);
      setSavedAt(null);
    } finally {
      setSaving(false);
    }
  }

  function handleSaveClick() {
    if (!draft || hasFieldError || !dirty) return;
    // 합격 기준점 변경은 부작용이 있다 (§2.2) — 저장 전 확인
    if (passScoreChanged) {
      setConfirmOpen(true);
      return;
    }
    void doSave();
  }

  // ── 상태 갈래 ───────────────────────────────────────────────────────────────

  if (loading) return <StatusScreen tone="loading" title="설정을 불러오는 중" />;

  if (error) {
    const entry = resolveError({ status: null, message: error });
    const forbidden = /\b403\b/.test(error) || entry.status === 403;
    return (
      <StatusScreen
        tone="error"
        title={forbidden ? "접근 권한이 없습니다" : entry.title}
        detail={
          forbidden
            ? "시스템 설정은 관리자(admin)만 조회·변경할 수 있습니다."
            : entry.detail
        }
        code={error}
        source={entry.source}
        actions={
          forbidden
            ? [{ label: "생산 현황으로", href: "/dashboard/production", primary: true }]
            : [{ label: "다시 시도", onClick: refetch, primary: true }]
        }
      />
    );
  }

  if (!data || !draft) {
    return (
      <StatusScreen
        tone="empty"
        title="아직 저장된 설정이 없습니다"
        detail="system_settings 테이블이 비어 있습니다. 기본값으로 저장해 초기화하세요."
        actions={[{ label: "다시 조회", onClick: refetch }]}
      />
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* [A] 헤더 */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: T.text, margin: 0 }}>시스템 설정</h1>
          <p style={{ fontSize: 12.5, color: T.textSub, margin: "4px 0 0" }}>
            ML 목표값 · 품질 합격 기준점 · 알림 임계값 (관리자 전용)
            {data.updated_at && (
              <>
                {" · "}최종 수정: {data.updated_by_username ?? "알 수 없음"}{" "}
                {data.updated_at.replace("T", " ")}
              </>
            )}
          </p>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {dirty && !saving && <StatusBadge variant="amber" label="저장되지 않은 변경사항" dot />}
          {/* 저장 완료 배지는 **서버 응답 이후에만** 뜬다 */}
          {savedAt && !dirty && (
            <StatusBadge
              variant="green"
              label={`저장되었습니다 (${savedAt.toLocaleTimeString("ko-KR", { hour12: false })})`}
              dot
            />
          )}
          <button
            type="button"
            className="btn pri"
            onClick={handleSaveClick}
            disabled={saving || !dirty || hasFieldError}
          >
            {saving ? "저장 중…" : "설정 저장"}
          </button>
        </div>
      </div>

      {saveError && <ErrorAlert message={`저장하지 못했습니다 — ${saveError}`} />}

      {/* [B] 🔒 ML 성분 목표값 */}
      <div className="card">
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 14,
            gap: 12,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: T.text }}>ML 성분 목표값</span>
            <StatusBadge variant="gray" label="🔒 모델 종속 · 변경 불가" />
          </div>
          <button
            type="button"
            className="btn"
            disabled
            title="준비 중 — 재학습 트리거 엔드포인트가 API 계약에 아직 없습니다"
          >
            모델 재학습 요청 (준비 중)
          </button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
          <LockedTarget label={SETTING_LABELS.sn_target} value={data.sn_target} />
          <LockedTarget label={SETTING_LABELS.ag_target} value={data.ag_target} />
          <LockedTarget label={SETTING_LABELS.cu_target} value={data.cu_target} />
        </div>
        <p style={{ fontSize: 11.5, color: T.textSub, margin: "12px 0 0", lineHeight: 1.6 }}>
          ⓘ {TARGET_LOCK_REASON} 권한 문제가 아니므로 계정 권한을 올려도 변경할 수 없습니다 —
          서버도 이 세 값이 요청에 포함되면 거부합니다.
        </p>
      </div>

      {/* [C] 품질 기준 */}
      <div className="card">
        <div style={{ fontSize: 13, fontWeight: 700, color: T.text, marginBottom: 16 }}>품질 기준</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {QUALITY_FIELDS.map((spec) => (
            <ThresholdRow
              key={spec.key}
              spec={spec}
              value={draft[spec.key]}
              onChange={(v) => setField(spec.key, v)}
              error={fieldErrors[spec.key]}
              disabled={saving}
            />
          ))}
        </div>
        <p style={{ fontSize: 11.5, color: T.textSub, margin: "14px 0 0", lineHeight: 1.6 }}>
          ⚠ 합격 기준을 바꿔도 <b>이미 저장된 검사 결과의 합격 판정은 재계산되지 않습니다.</b> 앞으로
          등록되는 검사부터 새 기준이 적용됩니다. 또한 LOT 상태 경계(경고 80점)는 이 설정과 연동되지
          않습니다.
        </p>
      </div>

      {/* [D] 알림 임계값 */}
      <div className="card">
        <div style={{ fontSize: 13, fontWeight: 700, color: T.text, marginBottom: 16 }}>알림 임계값</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {THRESHOLD_FIELDS.map((spec) => (
            <ThresholdRow
              key={spec.key}
              spec={spec}
              value={draft[spec.key]}
              onChange={(v) => setField(spec.key, v)}
              error={fieldErrors[spec.key]}
              disabled={saving}
            />
          ))}
        </div>
        <p style={{ fontSize: 11.5, color: T.textSub, margin: "14px 0 0" }}>
          알림 채널 on/off 는 <Link href="/system/notifications">알림 설정</Link> 에서 관리합니다.
          외부 시스템 연동(ERP·XRF) 설정은 이 화면이 다루지 않습니다 —{" "}
          <Link href="/data/integrate">데이터 연동</Link> 화면입니다.
        </p>
      </div>

      {saving && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: T.textSub }}>
          <Spinner size="sm" /> 서버에 저장하는 중입니다
        </div>
      )}

      {/* 합격 기준점 변경 확인 (§2.2) */}
      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="품질 합격 기준을 변경합니다"
        footer={
          <>
            <button type="button" className="btn" onClick={() => setConfirmOpen(false)}>
              취소
            </button>
            <button type="button" className="btn pri" onClick={() => void doSave()}>
              변경하고 저장
            </button>
          </>
        }
      >
        <p style={{ fontSize: 13, color: T.text, margin: 0, lineHeight: 1.7 }}>
          합격 기준을 <b>{data.quality_pass_score}</b> → <b>{draft.quality_pass_score}</b> 로
          변경합니다.
        </p>
        <p style={{ fontSize: 13, color: T.textSub, margin: "10px 0 0", lineHeight: 1.7 }}>
          <b>이미 저장된 검사 결과의 합격 판정은 바뀌지 않습니다.</b> 앞으로 등록되는 검사부터 새
          기준이 적용됩니다. 합격률 KPI 는 변경 시점을 경계로 기준이 달라집니다.
        </p>
      </Modal>
    </div>
  );
}
