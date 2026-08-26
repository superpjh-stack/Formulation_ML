"use client";

/**
 * FE-RT-23 · `/process/condition` · 공정 조건 (FR-P-03)
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * 🔴 하드코딩 배열을 `GET /api/v1/process/conditions` 로 교체했다.
 *
 * 개정 방식은 **(B) 현행 1행 + 갱신형**이다 (§2.1).
 *   POST  → 신규 등록. `version=1`
 *   PATCH → 같은 행 갱신 + 서버가 `version+1` + `condition_history` 에 이력 1행
 *   GET   → 제품별 **현행 1행씩**. 과거 버전은 오지 않는다
 * **폼에 `version` 입력란을 두지 마라.** 서버가 증가시킨다.
 *
 * ⚠ 표에서 `active` 를 인라인 토글하지 않는다. 모든 변경이 버전 증가 + 이력 기록을
 *   유발하므로 **의도적인 [편집] 모달 안에서만** 저장한다. 실수 클릭 한 번이 이력을 오염시킨다.
 *
 * ⚠ `speed` 는 **선택 입력이고 단위가 산출물에 없다.** `speed_min`/`speed_max` 를 임의로
 *   만들지 마라 — 컬럼이 없다. 미입력은 `—` 다.
 *
 * ⚠ 삭제 기능을 만들지 마라. `DELETE` 가 계약에 없다. 미적용(`active=false`)으로 대신한다.
 *
 * 🔴 온도 상한 주의 기준(설비 온도 경고 임계)은 `usePublicSettings()` 의 `temp_warn_c` 다.
 *   숫자를 이 소스에 쓰지 않는다 — FE-RT-29 에서 운영 중 바뀔 수 있다.
 * ══════════════════════════════════════════════════════════════════════════════
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import * as api from "@/lib/koryo-api";
import { useProcessConditions, usePublicSettings } from "@/hooks/useKoryoData";
import { useRole } from "@/hooks/useRole";
import { resolveError } from "@/lib/error-contract";
import { StatusScreen } from "@/components/layout/StatusScreen";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { ErrorAlert } from "@/components/ui/ErrorAlert";
import { PillFilter } from "@/components/ui/PillFilter";
import { Modal } from "@/components/ui/Modal";
import { KpiCard } from "@/components/ui/KpiCard";
import { T } from "@/components/ui/tokens";
import type { ProcessConditionDto } from "@/types/api";

/** goal.md 2.3 — 용해 온도 입력 200~320 °C */
const TEMP_MIN_ALLOWED = 200;
const TEMP_MAX_ALLOWED = 320;
/** INTEGER · 산출물 상한 규정 없음 (UI 가드) */
const TIME_MIN_ALLOWED = 1;
const TIME_MAX_ALLOWED = 999;
/** DECIMAL(6,2) */
const SPEED_MAX = 9999.99;

const ACTIVE_OPTIONS: { value: "all" | "active" | "inactive"; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "active", label: "적용중" },
  { value: "inactive", label: "미적용" },
];

/** 공정 조건을 쓸 수 있는 역할 */
const CAN_WRITE = new Set(["admin", "manufacture"]);

const dt = (s: string) => s.replace("T", " ").slice(0, 19);

export default function ProcessConditionPage() {
  const [activeFilter, setActiveFilter] = useState<"all" | "active" | "inactive">("all");
  const [productCode, setProductCode] = useState("");
  const [editing, setEditing] = useState<ProcessConditionDto | null>(null);
  const [creating, setCreating] = useState(false);

  const settings = usePublicSettings();
  const tempWarnC = settings.data?.settings.temp_warn_c ?? null;
  const thresholdFallback = settings.data?.source === "fallback";

  // SSR 에서는 sessionStorage 가 없어 `currentRole()` 이 항상 null 이다 — 훅으로 읽는다
  const role = useRole();
  const canWrite = role !== null && CAN_WRITE.has(role);

  const query = useMemo(
    () => ({
      page_size: 200,
      ...(activeFilter === "all" ? {} : { active: activeFilter === "active" }),
      ...(productCode ? { product_code: productCode } : {}),
    }),
    [activeFilter, productCode]
  );

  const { data, loading, error, refetch } = useProcessConditions(query);
  const rows = data?.items ?? [];

  const activeCount = rows.filter((r) => r.active).length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* [A] 헤더 */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: T.text, margin: 0 }}>공정 조건</h1>
          <p style={{ fontSize: 12.5, color: T.textSub, margin: "4px 0 0" }}>
            제품별 표준 공정 조건 등록 및 관리 (FR-P-03)
          </p>
        </div>
        <button
          type="button"
          className="btn pri"
          disabled={!canWrite}
          title={canWrite ? undefined : "현재 계정 권한으로는 공정 조건을 등록할 수 없습니다"}
          onClick={() => setCreating(true)}
        >
          + 신규 등록
        </button>
      </div>

      {thresholdFallback && (
        <div style={bannerStyle}>
          설비 온도 경고 기준값을 서버에서 불러오지 못했습니다. 온도 상한 주의 표시가 기본값
          ({tempWarnC ?? "—"}°C) 기준으로 그려집니다.
          {settings.data?.error ? ` (${settings.data.error})` : ""}
        </div>
      )}

      {/* [B] 요약 3장 */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
        <KpiCard label="전체 조건" value={loading ? "—" : rows.length.toLocaleString("ko-KR")} unit="건" />
        <KpiCard label="적용중" value={loading ? "—" : activeCount.toLocaleString("ko-KR")} unit="건" />
        <KpiCard label="미적용" value={loading ? "—" : (rows.length - activeCount).toLocaleString("ko-KR")} unit="건" />
      </div>

      <div className="card" style={{ display: "flex", gap: 14, alignItems: "flex-end", flexWrap: "wrap" }}>
        <PillFilter options={ACTIVE_OPTIONS} value={activeFilter} onChange={setActiveFilter} label="적용여부:" />
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={labelStyle}>제품코드</span>
          <input
            type="text"
            value={productCode}
            placeholder="전체"
            onChange={(e) => setProductCode(e.target.value.trim())}
            style={{ ...inputStyle, width: 160 }}
          />
        </label>
      </div>

      {/* [C] 표 */}
      {loading ? (
        <StatusScreen tone="loading" title="공정 조건을 불러오는 중" />
      ) : error ? (
        <StatusScreen
          tone="error"
          title="공정 조건을 불러오지 못했습니다"
          code={error}
          actions={[{ label: "다시 시도", onClick: refetch, primary: true }]}
        />
      ) : rows.length === 0 ? (
        <StatusScreen
          tone="empty"
          title="등록된 공정 조건이 없습니다"
          detail="제품별 표준 온도·시간 범위를 등록하세요."
          actions={
            canWrite ? [{ label: "신규 등록", onClick: () => setCreating(true), primary: true }] : []
          }
        />
      ) : (
        <div style={tableWrapStyle}>
          <table style={tableStyle}>
            <thead>
              <tr style={{ background: T.surfaceSubtle }}>
                <th style={thStyle}>제품코드</th>
                <th style={{ ...thStyle, textAlign: "right" }}>온도 (°C)</th>
                <th style={{ ...thStyle, textAlign: "right" }}>시간 (분)</th>
                <th style={{ ...thStyle, textAlign: "right" }}>속도</th>
                <th style={{ ...thStyle, textAlign: "right" }}>버전</th>
                <th style={thStyle}>적용여부</th>
                <th style={thStyle}>등록일</th>
                <th style={{ ...thStyle, textAlign: "right" }}>작업</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const overWarn = tempWarnC !== null && r.temp_max > tempWarnC;
                return (
                  <tr key={r.id} style={{ borderBottom: `1px solid ${T.border}` }}>
                    <td style={{ ...tdStyle, fontWeight: 600 }}>{r.product_code}</td>
                    <td
                      style={{
                        ...tdStyle,
                        textAlign: "right",
                        color: overWarn ? T.warning : T.text,
                        fontWeight: overWarn ? 700 : 400,
                      }}
                      title={overWarn ? `설비 온도 경고 임계(${tempWarnC}°C)를 넘는 상한입니다` : undefined}
                    >
                      {r.temp_min.toFixed(1)} ~ {r.temp_max.toFixed(1)}
                      {overWarn ? " ⚠" : ""}
                    </td>
                    <td style={{ ...tdStyle, textAlign: "right" }}>
                      {r.time_min} ~ {r.time_max}
                    </td>
                    {/* 단위가 산출물에 없다 — 라벨에 단위를 붙이지 않는다 */}
                    <td style={{ ...tdStyle, textAlign: "right" }} title={r.speed === null ? "미설정" : undefined}>
                      {r.speed === null ? "—" : r.speed.toFixed(2)}
                    </td>
                    <td style={{ ...tdStyle, textAlign: "right" }}>v{r.version}</td>
                    <td style={tdStyle}>
                      <StatusBadge
                        variant={r.active ? "green" : "gray"}
                        label={r.active ? "적용중" : "미적용"}
                        dot
                      />
                    </td>
                    <td style={tdStyle}>{dt(r.created_at)}</td>
                    <td style={{ ...tdStyle, textAlign: "right" }}>
                      <div style={{ display: "inline-flex", gap: 6 }}>
                        <Link href={`/process/history?condition_id=${r.id}`} className="btn">
                          이력
                        </Link>
                        <button
                          type="button"
                          className="btn"
                          disabled={!canWrite}
                          onClick={() => setEditing(r)}
                        >
                          편집
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p style={{ fontSize: 11, color: T.textMuted, margin: 0 }}>
        ※ 조건을 삭제할 수 없습니다 — 사용하지 않는 조건은 [편집] 에서 <b>미적용</b>으로 바꿉니다.
        속도는 선택 항목이며 단위가 아직 정의돼 있지 않습니다.
      </p>

      {/* [D] 등록/편집 모달 */}
      <ConditionModal
        mode="create"
        open={creating}
        tempWarnC={tempWarnC}
        onClose={() => setCreating(false)}
        onSaved={() => {
          setCreating(false);
          refetch();
        }}
      />
      <ConditionModal
        mode="edit"
        open={editing !== null}
        row={editing}
        tempWarnC={tempWarnC}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          refetch();
        }}
      />
    </div>
  );
}

// ─── [D] 등록/편집 ────────────────────────────────────────────────────────────

function ConditionModal({
  mode,
  open,
  row,
  tempWarnC,
  onClose,
  onSaved,
}: {
  mode: "create" | "edit";
  open: boolean;
  row?: ProcessConditionDto | null;
  tempWarnC: number | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    product_code: "",
    temp_min: "",
    temp_max: "",
    time_min: "",
    time_max: "",
    speed: "",
    active: true,
  });
  const [initialised, setInitialised] = useState<number | "new" | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 모달이 열릴 때 한 번만 폼을 채운다
  const targetKey = mode === "edit" ? (row?.id ?? null) : ("new" as const);
  if (open && targetKey !== null && initialised !== targetKey) {
    setInitialised(targetKey);
    setError(null);
    setForm(
      mode === "edit" && row
        ? {
            product_code: row.product_code,
            temp_min: String(row.temp_min),
            temp_max: String(row.temp_max),
            time_min: String(row.time_min),
            time_max: String(row.time_max),
            speed: row.speed === null ? "" : String(row.speed),
            active: row.active,
          }
        : { product_code: "", temp_min: "", temp_max: "", time_min: "", time_max: "", speed: "", active: true }
    );
  }

  const tempMin = Number(form.temp_min);
  const tempMax = Number(form.temp_max);
  const timeMin = Number(form.time_min);
  const timeMax = Number(form.time_max);
  const speed = form.speed.trim() === "" ? null : Number(form.speed);

  const errors: Record<string, string | null> = {
    product_code:
      form.product_code.trim() === ""
        ? "제품코드를 입력하세요"
        : form.product_code.trim().length > 30
          ? "제품코드는 30자 이하여야 합니다"
          : null,
    temp:
      form.temp_min === "" || form.temp_max === ""
        ? "온도 하한·상한을 입력하세요"
        : !Number.isFinite(tempMin) || !Number.isFinite(tempMax)
          ? "숫자를 입력하세요"
          : tempMin < TEMP_MIN_ALLOWED || tempMax > TEMP_MAX_ALLOWED
            ? `온도는 ${TEMP_MIN_ALLOWED} ~ ${TEMP_MAX_ALLOWED}°C 범위여야 합니다`
            : tempMin >= tempMax
              ? "온도 하한은 상한보다 작아야 합니다"
              : null,
    time:
      form.time_min === "" || form.time_max === ""
        ? "시간 하한·상한을 입력하세요"
        : !Number.isInteger(timeMin) || !Number.isInteger(timeMax)
          ? "시간은 정수로 입력하세요"
          : timeMin < TIME_MIN_ALLOWED || timeMax > TIME_MAX_ALLOWED
            ? `시간은 ${TIME_MIN_ALLOWED} ~ ${TIME_MAX_ALLOWED}분 범위여야 합니다`
            : timeMin >= timeMax
              ? "시간 하한은 상한보다 작아야 합니다"
              : null,
    speed:
      speed === null
        ? null
        : !Number.isFinite(speed) || speed < 0 || speed > SPEED_MAX
          ? `속도는 0 ~ ${SPEED_MAX} 범위여야 합니다`
          : null,
  };

  const invalid = Object.values(errors).some(Boolean);
  const tempWarn = tempWarnC !== null && Number.isFinite(tempMax) && tempMax > tempWarnC;

  async function submit() {
    if (invalid) return;
    setSaving(true);
    setError(null);
    try {
      // `version` 은 보내지 않는다 — 서버가 결정한다
      const body = {
        product_code: form.product_code.trim(),
        temp_min: tempMin,
        temp_max: tempMax,
        time_min: timeMin,
        time_max: timeMax,
        speed,
        active: form.active,
      };
      if (mode === "edit" && row) {
        await api.patchProcessCondition(row.id, body);
      } else {
        await api.createProcessCondition(body);
      }
      setInitialised(null);
      onSaved();
    } catch (err) {
      const entry = resolveError(err);
      setError(
        entry.status === 409
          ? "이미 등록된 제품코드입니다"
          : err instanceof Error
            ? err.message
            : entry.detail
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        setInitialised(null);
        onClose();
      }}
      title={mode === "edit" ? "공정 조건 편집" : "공정 조건 신규 등록"}
      description={mode === "edit" && row ? `${row.product_code} · 현재 v${row.version}` : undefined}
      width={560}
      footer={
        <>
          <button
            type="button"
            className="btn"
            onClick={() => {
              setInitialised(null);
              onClose();
            }}
          >
            취소
          </button>
          <button type="button" className="btn pri" disabled={invalid || saving} onClick={() => void submit()}>
            {saving ? "저장 중…" : "저장"}
          </button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {error && <ErrorAlert message={error} />}

        {mode === "edit" && row && (
          <div style={bannerStyle}>
            저장하면 버전이 <b>v{row.version} → v{row.version + 1}</b> 로 올라가고 변경 이력이
            기록됩니다.
          </div>
        )}

        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={labelStyle}>제품코드 * (1~30자)</span>
          <input
            type="text"
            value={form.product_code}
            maxLength={30}
            // UK 구성요소다. 바꾸려면 신규 등록해야 한다
            readOnly={mode === "edit"}
            onChange={(e) => setForm((f) => ({ ...f, product_code: e.target.value }))}
            style={{ ...inputStyle, background: mode === "edit" ? T.surfaceSubtle : undefined }}
          />
          {mode === "edit" && (
            <span style={{ fontSize: 11, color: T.textMuted }}>
              제품코드는 식별자라 변경할 수 없습니다. 다른 제품이면 신규 등록하세요.
            </span>
          )}
          {errors.product_code && <span style={fieldErrorStyle}>{errors.product_code}</span>}
        </label>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={labelStyle}>온도 하한 * (°C)</span>
            <input
              type="number"
              step={0.1}
              min={TEMP_MIN_ALLOWED}
              max={TEMP_MAX_ALLOWED}
              value={form.temp_min}
              onChange={(e) => setForm((f) => ({ ...f, temp_min: e.target.value }))}
              style={inputStyle}
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={labelStyle}>온도 상한 * (°C)</span>
            <input
              type="number"
              step={0.1}
              min={TEMP_MIN_ALLOWED}
              max={TEMP_MAX_ALLOWED}
              value={form.temp_max}
              onChange={(e) => setForm((f) => ({ ...f, temp_max: e.target.value }))}
              style={inputStyle}
            />
          </label>
        </div>
        {errors.temp && <span style={fieldErrorStyle}>{errors.temp}</span>}
        {!errors.temp && tempWarn && (
          <span style={{ fontSize: 11.5, color: T.warning }}>
            ⚠ 설비 온도 경고 임계({tempWarnC}°C)를 넘는 상한입니다. 저장은 가능합니다.
          </span>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={labelStyle}>시간 하한 * (분)</span>
            <input
              type="number"
              step={1}
              min={TIME_MIN_ALLOWED}
              max={TIME_MAX_ALLOWED}
              value={form.time_min}
              onChange={(e) => setForm((f) => ({ ...f, time_min: e.target.value }))}
              style={inputStyle}
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={labelStyle}>시간 상한 * (분)</span>
            <input
              type="number"
              step={1}
              min={TIME_MIN_ALLOWED}
              max={TIME_MAX_ALLOWED}
              value={form.time_max}
              onChange={(e) => setForm((f) => ({ ...f, time_max: e.target.value }))}
              style={inputStyle}
            />
          </label>
        </div>
        {errors.time && <span style={fieldErrorStyle}>{errors.time}</span>}

        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={labelStyle}>속도 (선택 · 단위 미정)</span>
          <input
            type="number"
            step={0.01}
            min={0}
            max={SPEED_MAX}
            value={form.speed}
            placeholder="비우면 미설정"
            onChange={(e) => setForm((f) => ({ ...f, speed: e.target.value }))}
            style={inputStyle}
          />
          {errors.speed && <span style={fieldErrorStyle}>{errors.speed}</span>}
        </label>

        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            type="checkbox"
            checked={form.active}
            onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))}
          />
          <span style={{ fontSize: 12.5, color: T.text }}>이 조건을 현재 생산에 적용 (적용중)</span>
        </label>

        <p style={{ fontSize: 11, color: T.textMuted, margin: 0 }}>
          버전은 입력하지 않습니다 — 서버가 결정합니다.
        </p>
      </div>
    </Modal>
  );
}

// ─── 스타일 ───────────────────────────────────────────────────────────────────

const labelStyle: React.CSSProperties = { fontSize: 11.5, fontWeight: 600, color: T.textSub };
const fieldErrorStyle: React.CSSProperties = { fontSize: 11.5, color: T.error };

const bannerStyle: React.CSSProperties = {
  background: "#FFFBEB",
  border: "1px solid #FCD34D",
  borderRadius: 10,
  padding: "10px 14px",
  fontSize: 12.5,
  color: "#92400E",
};

const inputStyle: React.CSSProperties = {
  height: 32,
  padding: "0 8px",
  border: `1px solid ${T.border}`,
  borderRadius: 6,
  fontSize: 12.5,
  fontFamily: "inherit",
  outline: "none",
};

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
