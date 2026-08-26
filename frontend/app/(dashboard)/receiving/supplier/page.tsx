"use client";

/**
 * FE-RT-09 `/receiving/supplier` — 공급사 관리 (FR-R-04, 필수)
 *
 * 서버가 주는 것만 그린다.
 *   GET /api/v1/suppliers                     공급사 목록 (code·name·contact·primary_material)
 *   GET /api/v1/suppliers/{code}/stats?days=  LOT수·평균품질·합격률·성분 표준편차
 *   GET /api/v1/deviation/by-supplier?days=   공급사별 성분 편차 + 권장 공급사
 *
 * ── 이전 구현에서 걷어낸 것 (전부 근거 없음) ──────────────────────────────────
 *  · `SUP_D` "글로벌메탈"      — DB 에 SUP_A/B/C 셋뿐이다
 *  · 공급사명 한국금속·동양금속·대성소재 — 지어낸 이름. `suppliers.name` 이 정본
 *  · A/B/C/D 등급 체계와 "합격률 ≥97%, 클레임 ≤1건" 등급 기준
 *                              — SF-TD5·SF-AD2 어디에도 등급 정의가 없다
 *  · 공급사별 클레임 건수      — `claims` 는 `lot_id` 로만 연결되고 공급사 집계 API 가 없다
 *  · 손으로 그린 canvas 막대차트 — 공용 `TrendChart` 로 대체
 *
 * 표기 주의: 서버가 주는 `sn_std`/`ag_std`/`cu_std` 는 **표준편차**다.
 * 이전 화면이 "평균 편차"로 이름 붙여 두었으나 다른 값이므로 그대로 쓰지 않는다.
 */

import { useCallback, useEffect, useState } from "react";
import { TrendChart } from "@/components/charts/TrendChart";
import { Modal } from "@/components/ui/Modal";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useDeviationBySupplier, usePublicSettings, useSuppliers } from "@/hooks/useKoryoData";
import * as api from "@/lib/koryo-api";
import { isQualityPassed, passScoreOf } from "@/lib/quality";
import type { PublicSettingsDto, SupplierCode, SupplierDto, SupplierStatsDto } from "@/types/api";
import {
  FilterBar,
  Field,
  PageHeader,
  PageShell,
  ScreenError,
  Section,
  SectionState,
  Select,
  SettingsFallbackBanner,
  TextInput,
  useRole,
} from "../../_g1/ui";

/** FR-R-04 등록/수정 권한. `api-contract.md` §8.3 기준. */
const WRITE_ROLES = ["admin", "manufacture"] as const;

const CODE_OPTIONS = [
  { value: "SUP_A", label: "SUP_A" },
  { value: "SUP_B", label: "SUP_B" },
  { value: "SUP_C", label: "SUP_C" },
];

// ── 조회 기간 ────────────────────────────────────────────────────────────────
// SF-TD3 에 기간 선택 규정이 없다 — 동 그룹(`/deviation/*`) 의 `?days=90` 관례를 따른다.
const DAYS_OPTIONS = [
  { value: "30", label: "최근 30일" },
  { value: "90", label: "최근 90일" },
  { value: "180", label: "최근 180일" },
  { value: "365", label: "최근 365일" },
];

const NUM = { fontVariantNumeric: "tabular-nums" as const };

function fmt(v: number | null | undefined, digits: number, unit = ""): string {
  return v === null || v === undefined ? "—" : `${v.toFixed(digits)}${unit}`;
}

// ── 공급사별 통계 (훅이 없어 화면에서 조립한다) ───────────────────────────────
// `hooks/useKoryoData.ts` 는 개발3 담당이라 수정하지 않고 여기서 처리한다.
interface StatsState {
  data: Record<string, SupplierStatsDto>;
  loading: boolean;
  error: string | null;
}

function useSupplierStatsMap(codes: SupplierCode[], days: number): StatsState & { refetch: () => void } {
  const [state, setState] = useState<StatsState>({ data: {}, loading: false, error: null });
  const [nonce, setNonce] = useState(0);
  const key = codes.join(",");

  useEffect(() => {
    if (codes.length === 0) {
      setState({ data: {}, loading: false, error: null });
      return;
    }
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));

    Promise.all(codes.map((c) => api.getSupplierStats(c, days).then((r) => [c, r] as const)))
      .then((pairs) => {
        if (cancelled) return;
        setState({ data: Object.fromEntries(pairs), loading: false, error: null });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setState({ data: {}, loading: false, error: e instanceof Error ? e.message : String(e) });
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, days, nonce]);

  return { ...state, refetch: () => setNonce((n) => n + 1) };
}

// ── 합격률 도넛 ──────────────────────────────────────────────────────────────
function PassRateDonut({ rate }: { rate: number | null }) {
  const r = 22;
  const circ = 2 * Math.PI * r;
  const pct = rate ?? 0;
  const dash = (pct / 100) * circ;

  return (
    <svg width="60" height="60" viewBox="0 0 60 60" role="img" aria-label={`합격률 ${fmt(rate, 1, "%")}`}>
      <circle cx={30} cy={30} r={r} fill="none" stroke="var(--badge-gray-bg, #F2F4F7)" strokeWidth={6} />
      {rate !== null && (
        <circle
          cx={30}
          cy={30}
          r={r}
          fill="none"
          stroke="var(--color-primary, #3A5BD9)"
          strokeWidth={6}
          strokeDasharray={`${dash} ${circ}`}
          strokeLinecap="round"
          transform="rotate(-90 30 30)"
        />
      )}
      <text
        x={30}
        y={34}
        textAnchor="middle"
        fontSize="10"
        fontWeight="700"
        fill={rate === null ? "var(--color-text-muted, #9AA4B2)" : "var(--color-primary, #3A5BD9)"}
      >
        {rate === null ? "—" : `${Math.round(rate)}%`}
      </text>
    </svg>
  );
}

// ── 공급사 카드 ──────────────────────────────────────────────────────────────
function SupplierCard({
  supplier,
  stats,
  settings,
  recommended,
  onEdit,
}: {
  supplier: SupplierDto;
  stats: SupplierStatsDto | undefined;
  settings: PublicSettingsDto | null | undefined;
  recommended: boolean;
  /** null = 수정 권한 없음 (버튼을 그리지 않는다) */
  onEdit: (() => void) | null;
}) {
  // 합격 판정은 `lib/quality.ts` 로만 한다.
  // `getQualityBadgeVariant()` 는 {90,75,60} 기준이라 합격선 70 을 표현하지 못한다.
  const avg = stats?.avg_quality ?? null;
  const passScore = passScoreOf(settings);
  const passed = avg === null ? null : isQualityPassed(avg, settings);

  return (
    <div className="card" style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
      <PassRateDonut rate={stats?.pass_rate ?? null} />

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: "var(--color-text, #161B26)" }}>
            {supplier.name}
          </span>
          {recommended && <StatusBadge variant="green" label="권장" dot />}
          {!supplier.active && <StatusBadge variant="gray" label="비활성" />}
          {onEdit && (
            <button
              type="button"
              className="btn"
              onClick={onEdit}
              style={{ marginLeft: "auto", fontSize: 11.5, padding: "4px 10px" }}
            >
              수정
            </button>
          )}
        </div>

        <div style={{ fontSize: 11.5, color: "var(--color-text-sub, #687182)", marginBottom: 10 }}>
          {supplier.code}
          {supplier.primary_material ? ` · 주요 공급 재료: ${supplier.primary_material}` : ""}
          {supplier.contact ? ` · ${supplier.contact}` : ""}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
          {[
            { label: "LOT 수", value: stats ? `${stats.lot_count}건` : "—" },
            { label: "합격률", value: fmt(stats?.pass_rate, 1, "%") },
            { label: "평균 품질", value: fmt(avg, 1, "점") },
          ].map((m) => (
            <div key={m.label} style={{ background: "#F8F9FB", borderRadius: 6, padding: "6px 8px" }}>
              <div
                style={{
                  fontSize: 10,
                  color: "var(--color-text-muted, #9AA4B2)",
                  fontWeight: 600,
                  letterSpacing: "0.03em",
                }}
              >
                {m.label}
              </div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "var(--color-text, #161B26)", ...NUM }}>
                {m.value}
              </div>
            </div>
          ))}
        </div>

        <div
          style={{
            marginTop: 10,
            display: "flex",
            gap: 12,
            flexWrap: "wrap",
            fontSize: 11.5,
            color: "var(--color-text-sub, #687182)",
          }}
        >
          <span>
            Sn 표준편차 <strong style={{ color: "var(--color-text, #161B26)", ...NUM }}>{fmt(stats?.sn_std, 4)}</strong>
          </span>
          <span>
            Ag <strong style={{ color: "var(--color-text, #161B26)", ...NUM }}>{fmt(stats?.ag_std, 4)}</strong>
          </span>
          <span>
            Cu <strong style={{ color: "var(--color-text, #161B26)", ...NUM }}>{fmt(stats?.cu_std, 4)}</strong>
          </span>
          {passed !== null && (
            <StatusBadge
              variant={passed ? "green" : "red"}
              label={passed ? `평균 합격 (기준 ${passScore}점)` : `평균 불합격 (기준 ${passScore}점)`}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ── 등록/수정 폼 (FR-R-04) ───────────────────────────────────────────────────
// QA1 DEF-QA1-002 지적: 조회·통계만 있고 등록/수정이 없어 FR-R-04 가 부분충족이었다.
// `createSupplier`/`patchSupplier` 는 `lib/koryo-api.ts` 에 이미 있었고 화면만 안 불렀다.
function SupplierFormModal({
  open,
  target,
  existingCodes,
  onClose,
  onSaved,
}: {
  open: boolean;
  /** null = 신규 등록 */
  target: SupplierDto | null;
  existingCodes: SupplierCode[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const editing = target !== null;
  const [code, setCode] = useState<string>("SUP_A");
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [material, setMaterial] = useState("");
  const [active, setActive] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setBusy(false);
    if (target) {
      setCode(target.code);
      setName(target.name);
      setContact(target.contact ?? "");
      setMaterial(target.primary_material ?? "");
      setActive(target.active);
    } else {
      const free = CODE_OPTIONS.find((o) => !existingCodes.includes(o.value as SupplierCode));
      setCode(free?.value ?? "SUP_A");
      setName("");
      setContact("");
      setMaterial("");
      setActive(true);
    }
  }, [open, target, existingCodes]);

  // 신규 등록 시 이미 쓰인 코드는 UK 위반(409)이 나므로 미리 막는다.
  const codeTaken = !editing && existingCodes.includes(code as SupplierCode);
  const canSave = name.trim().length > 0 && !codeTaken && !busy;

  async function handleSave() {
    if (!canSave) return;
    setBusy(true);
    setError(null);
    const body = {
      name: name.trim(),
      contact: contact.trim() || null,
      primary_material: material.trim() || null,
      active,
    };
    try {
      if (editing && target) {
        await api.patchSupplier(target.id, body);
      } else {
        await api.createSupplier({ code: code as SupplierCode, ...body });
      }
      onSaved();
      onClose();
    } catch (e) {
      // 실패를 삼키지 않는다. 409(UK 중복) 는 문구로 구분한다.
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg.includes("409") || msg.includes("중복") ? "이미 등록된 공급사 코드입니다" : msg);
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onClose}
      title={editing ? `공급사 수정 — ${target?.code}` : "공급사 등록"}
      width={480}
      footer={
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            취소
          </button>
          <button type="button" className="btn pri" onClick={handleSave} disabled={!canSave}>
            {busy ? "저장 중…" : "저장"}
          </button>
        </div>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <Field label="공급사 코드" htmlFor="sup-code">
          {editing ? (
            // 코드는 UK 이자 `lots.supplier_id` 참조 키다. 수정 시 바꾸지 않는다.
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text, #161B26)" }}>
              {code}
              <span style={{ fontSize: 11, color: "var(--color-text-sub, #687182)", marginLeft: 8 }}>
                코드는 변경할 수 없습니다
              </span>
            </div>
          ) : (
            <Select id="sup-code" value={code} onChange={setCode} options={CODE_OPTIONS} width={180} />
          )}
        </Field>

        {codeTaken && (
          <div style={{ fontSize: 12, color: "#B91C1C" }}>이미 등록된 코드입니다</div>
        )}

        <Field label="공급사명" htmlFor="sup-name">
          <TextInput id="sup-name" value={name} onChange={setName} placeholder="예: 한국금속(주)" />
        </Field>

        <Field label="연락처" htmlFor="sup-contact">
          <TextInput id="sup-contact" value={contact} onChange={setContact} placeholder="선택 입력" />
        </Field>

        <Field label="주요 공급 재료" htmlFor="sup-material">
          <TextInput id="sup-material" value={material} onChange={setMaterial} placeholder="예: Sn ingot" />
        </Field>

        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5 }}>
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          활성 — 해제하면 신규 입고 등록 대상에서 제외된다
        </label>

        {error && (
          <div role="alert" style={{ fontSize: 12.5, color: "#B91C1C" }}>
            {error}
          </div>
        )}
      </div>
    </Modal>
  );
}

// ── 페이지 ───────────────────────────────────────────────────────────────────
export default function SupplierPage() {
  const [days, setDays] = useState("90");
  const daysNum = Number(days);

  const settings = usePublicSettings();
  const suppliers = useSuppliers();
  const deviation = useDeviationBySupplier(daysNum);

  const role = useRole();
  const canWrite = role !== null && (WRITE_ROLES as readonly string[]).includes(role);
  const [formOpen, setFormOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<SupplierDto | null>(null);

  const codes = (suppliers.data?.items ?? []).map((s) => s.code);
  const stats = useSupplierStatsMap(codes, daysNum);

  const recommended = deviation.data?.recommended ?? null;

  const retryAll = useCallback(() => {
    suppliers.refetch();
    deviation.refetch();
    stats.refetch();
  }, [suppliers, deviation, stats]);

  // 공급사 목록을 못 읽으면 화면이 성립하지 않는다.
  if (suppliers.error) {
    return <ScreenError message={suppliers.error} onRetry={retryAll} />;
  }

  const rows = suppliers.data?.items ?? [];
  const devRows = deviation.data?.suppliers ?? [];

  return (
    <PageShell>
      <PageHeader
        title="공급사 관리"
        subtitle="공급사 정보와 성분 품질 통계를 조회한다"
        actions={
          canWrite ? (
            <button
              type="button"
              className="btn pri"
              onClick={() => {
                setEditTarget(null);
                setFormOpen(true);
              }}
            >
              + 공급사 등록
            </button>
          ) : null
        }
      />

      <SupplierFormModal
        open={formOpen}
        target={editTarget}
        existingCodes={(suppliers.data?.items ?? []).map((s) => s.code)}
        onClose={() => setFormOpen(false)}
        onSaved={retryAll}
      />

      <SettingsFallbackBanner settings={settings.data} />

      <FilterBar>
        <Field label="조회 기간" htmlFor="days">
          <Select id="days" value={days} onChange={setDays} options={DAYS_OPTIONS} />
        </Field>
      </FilterBar>

      {/* 권장 공급사 — 서버 판정을 그대로 쓴다 (SF-TD3 §3.4) */}
      <Section title="권장 공급사">
        <SectionState
          loading={deviation.loading}
          error={deviation.error}
          empty={!deviation.loading && !deviation.error && recommended === null}
          emptyText="권장 판정에 필요한 데이터가 없다"
          onRetry={deviation.refetch}
          minHeight={80}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <StatusBadge variant="green" label={recommended ?? ""} dot />
            <span style={{ fontSize: 13, color: "var(--color-text, #161B26)", fontWeight: 600 }}>
              {deviation.data?.basis}
            </span>
            <span style={{ fontSize: 11.5, color: "var(--color-text-sub, #687182)" }}>
              최근 {daysNum}일 성분 편차 기준 · 서버 판정
            </span>
          </div>
        </SectionState>
      </Section>

      {/* 공급사 카드 */}
      <SectionState
        loading={suppliers.loading}
        error={null}
        empty={!suppliers.loading && rows.length === 0}
        emptyText="등록된 공급사가 없다"
        onRetry={retryAll}
      >
        <>
          {stats.error && (
            <div
              className="card"
              style={{ fontSize: 12.5, color: "var(--color-warning, #F59E0B)", marginBottom: 16 }}
            >
              품질 통계를 불러오지 못했다 — {stats.error}. 공급사 기본 정보만 표시한다.
            </div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 16 }}>
            {rows.map((s) => (
              <SupplierCard
                key={s.code}
                supplier={s}
                stats={stats.data[s.code]}
                settings={settings.data?.settings}
                recommended={s.code === recommended}
                onEdit={
                  canWrite
                    ? () => {
                        setEditTarget(s);
                        setFormOpen(true);
                      }
                    : null
                }
              />
            ))}
          </div>
        </>
      </SectionState>

      {/* 성분 편차 비교 */}
      <Section title="공급사별 성분 편차 비교">
        <div style={{ fontSize: 11.5, color: "var(--color-text-sub, #687182)", marginBottom: 12 }}>
          목표값(Sn {settings.data?.settings.sn_target ?? "—"}% · Ag{" "}
          {settings.data?.settings.ag_target ?? "—"}% · Cu {settings.data?.settings.cu_target ?? "—"}%) 대비 편차 —
          작을수록 우수
        </div>
        <SectionState
          loading={deviation.loading}
          error={deviation.error}
          empty={!deviation.loading && !deviation.error && devRows.length === 0}
          onRetry={deviation.refetch}
          minHeight={220}
        >
          <TrendChart
            kind="bar"
            height={220}
            categories={devRows.map((d) => d.code)}
            series={[
              { name: "Sn 편차", values: devRows.map((d) => d.sn), color: "primary" },
              { name: "Ag 편차", values: devRows.map((d) => d.ag), color: "success" },
              { name: "Cu 편차", values: devRows.map((d) => d.cu), color: "warning" },
            ]}
            formatY={(v) => v.toFixed(2)}
            ariaLabel="공급사별 성분 편차 비교"
          />
        </SectionState>
      </Section>
    </PageShell>
  );
}
