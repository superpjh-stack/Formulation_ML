"use client";

/**
 * FE-RT-30 — 품질 기준 · `/master/quality` · SF-AD2 §1.7 "품질 기준 관리" (필수)
 *
 * 명세: `specs/plan-g3.md` FE-RT-30. 와이어프레임 없음(SF-TD3 §3).
 * 저장 테이블: `master_codes` (`group_code='QUALITY_STD'`) — CR-DB-001 승인·생성 완료.
 * **501 이 아니다.** 501 이 나오면 실패다 (수용 기준 1).
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * 라운드 2 에서 고친 것:
 *   - 하드코딩 기준 6건 삭제 → `GET /api/v1/master/quality-standards` 실 연동
 *   - 죽은 버튼(`onClick` 없음) → 등록/수정 모달 + POST/PATCH 연결
 *   - **폐기는 물리 삭제가 아니라 `PATCH {active:false}`** 다. 행은 목록에 남는다
 *     (db-schema §5 보관 정책 · 부록 B #10)
 *   - 상태 3값(적용중/검토중/폐기) → **`master_codes.active` 2값**으로 축소.
 *     요약도 3카드 → **2카드**. DB 컬럼이 2값인데 3값을 JSONB 에 넣으면
 *     목록 필터가 인덱스를 못 탄다 (§4)
 *   - `version` 표시 신설 (개정 시 서버가 자동 증가시킨다)
 *   - `pb_min`/`pb_max` 열 추가 — 계약에 있는데 화면에 없었다
 *   - 피처 목표값 콜아웃의 `"62.0%"` 문자열 하드코딩 → `types/api.ts` 상수 참조
 *   - 권한 분기 신설 (`admin`·`quality` 만 쓰기 — FE-RT-31 과 쓰기 역할이 다르다)
 *
 * 제거하지 않고 **계약 누락으로 남긴 것**: `spec`(규격) · `weight_tol`(중량허용).
 * API 응답에도 `master_codes` 컬럼에도 없다. **임의로 API 를 발명하지 않는다** (§11 #4).
 *
 * ⚠ `GET` 은 **활성 최신 1행만** 온다 (부록 B #2). 프론트가 최신 버전을 골라내지 않는다.
 * ══════════════════════════════════════════════════════════════════════════════
 */

import { useCallback, useMemo, useState } from "react";
import {
  createQualityStandard,
  getQualityStandards,
  patchQualityStandard,
} from "@/lib/koryo-api";
import {
  AG_TARGET,
  CU_TARGET,
  QUALITY_PASS_SCORE,
  SN_TARGET,
  type QualityStandardDto,
  type QualityStandardIn,
} from "@/types/api";
import { Modal } from "@/components/ui/Modal";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { T } from "@/components/ui/tokens";
import {
  InlineError,
  PageHeader,
  PageShell,
  Pagination,
  Section,
  dateOnly,
  hasRole,
  num,
  useRole,
} from "../../_g1/ui";
import { Callout, Chips, FieldError, Notice, errText, useApi } from "../../_g3/ui";

const PAGE_SIZE = 50;

/** 규격 표기 관례 — Sn·Ag·Pb 1자리, Cu 2자리 (§4 주석). DB 는 JSONB 라 제약이 없다 */
const D = { sn: 1, ag: 1, cu: 2, pb: 1 } as const;

type Filter = "all" | "active" | "retired";

const FILTERS = [
  { value: "all", label: "전체" },
  { value: "active", label: "적용중" },
  { value: "retired", label: "폐기" },
];

interface FormState {
  product_code: string;
  sn_min: string;
  sn_max: string;
  ag_min: string;
  ag_max: string;
  cu_min: string;
  cu_max: string;
  pb_min: string;
  pb_max: string;
  pass_score: string;
}

const EMPTY_FORM: FormState = {
  product_code: "",
  sn_min: "",
  sn_max: "",
  ag_min: "",
  ag_max: "",
  cu_min: "",
  cu_max: "",
  pb_min: "",
  pb_max: "",
  pass_score: String(QUALITY_PASS_SCORE), // 합격선 기본 70 (goal.md 2.3)
};

function toForm(d: QualityStandardDto): FormState {
  const v = d.value;
  return {
    product_code: d.code,
    sn_min: String(v?.sn_min ?? ""),
    sn_max: String(v?.sn_max ?? ""),
    ag_min: String(v?.ag_min ?? ""),
    ag_max: String(v?.ag_max ?? ""),
    cu_min: String(v?.cu_min ?? ""),
    cu_max: String(v?.cu_max ?? ""),
    pb_min: String(v?.pb_min ?? ""),
    pb_max: String(v?.pb_max ?? ""),
    pass_score: String(v?.pass_score ?? QUALITY_PASS_SCORE),
  };
}

const PAIRS = [
  ["sn", "Sn"],
  ["ag", "Ag"],
  ["cu", "Cu"],
  ["pb", "Pb"],
] as const;

/** §6 검증 규칙 — 서버 422 를 기다리지 않고 먼저 막는다 (이중 방어) */
function validate(f: FormState): Record<string, string> {
  const e: Record<string, string> = {};
  const code = f.product_code.trim();
  if (code === "") e.product_code = "제품 코드를 입력하세요";
  else if (code.length > 50) e.product_code = "제품 코드는 1~50자입니다";
  else if (/\s/.test(code)) e.product_code = "제품 코드에 공백을 넣을 수 없습니다";

  for (const [k, label] of PAIRS) {
    const lo = Number(f[`${k}_min`]);
    const hi = Number(f[`${k}_max`]);
    if (f[`${k}_min`] === "" || !Number.isFinite(lo)) e[`${k}_min`] = `${label} 최소값을 입력하세요`;
    else if (lo < 0 || lo > 100) e[`${k}_min`] = `${label} 은 0.0~100.0 범위입니다`;
    if (f[`${k}_max`] === "" || !Number.isFinite(hi)) e[`${k}_max`] = `${label} 최대값을 입력하세요`;
    else if (hi < 0 || hi > 100) e[`${k}_max`] = `${label} 은 0.0~100.0 범위입니다`;
    // 동일값 허용 안 함 (§6)
    if (Number.isFinite(lo) && Number.isFinite(hi) && lo >= hi)
      e[`${k}_max`] = `${label} 최소값보다 커야 합니다`;
  }

  const ps = Number(f.pass_score);
  if (f.pass_score === "" || !Number.isFinite(ps)) e.pass_score = "품질 합격 점수를 입력하세요";
  else if (ps < 0 || ps > 100 || !Number.isInteger(ps))
    e.pass_score = "0~100 사이 정수여야 합니다";

  return e;
}

function toPayload(f: FormState): QualityStandardIn {
  return {
    product_code: f.product_code.trim(),
    sn_min: Number(f.sn_min),
    sn_max: Number(f.sn_max),
    ag_min: Number(f.ag_min),
    ag_max: Number(f.ag_max),
    cu_min: Number(f.cu_min),
    cu_max: Number(f.cu_max),
    pb_min: Number(f.pb_min),
    pb_max: Number(f.pb_max),
    pass_score: Number(f.pass_score),
  };
}

export default function MasterQualityPage() {
  const role = useRole();
  /** api-contract §8.8 — 이 화면의 쓰기는 `admin`·`quality` 다 */
  const canWrite = hasRole(role, "admin", "quality");

  const [filter, setFilter] = useState<Filter>("all");
  const [page, setPage] = useState(1);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  /** 상태 필터는 **서버 파라미터**다 (`active=true|false`). 클라이언트 필터가 아니다 */
  const activeParam = filter === "all" ? undefined : filter === "active";

  const state = useApi(
    () => getQualityStandards({ active: activeParam, page, page_size: PAGE_SIZE }),
    [activeParam, page]
  );

  const rows = useMemo(() => state.data?.items ?? [], [state.data]);
  const total = state.data?.total ?? 0;

  // ── 모달 ────────────────────────────────────────────────────────────────────
  const [editing, setEditing] = useState<QualityStandardDto | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setErrors({});
    setOpen(true);
  };

  const openEdit = (d: QualityStandardDto) => {
    setEditing(d);
    setForm(toForm(d));
    setErrors({});
    setOpen(true);
  };

  const save = useCallback(async () => {
    const e = validate(form);
    setErrors(e);
    if (Object.keys(e).length > 0) return;

    setSaving(true);
    setNotice(null);
    try {
      if (editing) {
        // `version+1` 새 행을 INSERT 하고 이전 행을 `active=false` 로 내린다 (§8.8.1)
        await patchQualityStandard(editing.id, toPayload(form));
        setNotice({ tone: "ok", text: "수정되었습니다. 버전이 증가했습니다." });
      } else {
        await createQualityStandard(toPayload(form));
        setNotice({ tone: "ok", text: "등록되었습니다." });
      }
      setOpen(false);
      state.refetch();
    } catch (err) {
      const msg = errText(err);
      // 409 는 제품 코드 입력에 인라인으로 (§9)
      if (/409|이미 등록/.test(msg)) {
        setErrors({ product_code: "이미 등록된 제품 코드입니다" });
      } else {
        setErrors({ _form: msg });
      }
    } finally {
      setSaving(false);
    }
  }, [form, editing, state]);

  /** 🔴 폐기 = **비활성화**. DELETE 엔드포인트를 부르지 않는다 */
  const retire = useCallback(
    async (d: QualityStandardDto) => {
      if (!window.confirm(`${d.code} 기준을 폐기하시겠습니까?\n목록에서 사라지지 않고 '폐기' 로 표시됩니다.`))
        return;
      setNotice(null);
      try {
        await patchQualityStandard(d.id, { active: false });
        setNotice({ tone: "ok", text: `${d.code} 기준을 폐기했습니다.` });
        state.refetch();
      } catch (err) {
        setNotice({ tone: "error", text: errText(err) });
      }
    },
    [state]
  );

  // 요약 2카드 — 상태별 집계 응답이 계약에 없어 목록 `items` 에서 클라이언트 집계 (§7)
  const activeCount = rows.filter((r) => r.active).length;
  const retiredCount = rows.filter((r) => !r.active).length;

  return (
    <PageShell>
      <PageHeader
        title="품질기준 관리"
        subtitle="제품 규격별 성분 상하한 및 품질 합격 점수 관리"
        actions={
          <button
            type="button"
            className="btn btn-primary"
            disabled={!canWrite}
            title={canWrite ? undefined : "등록 권한이 없습니다 (admin·quality)"}
            onClick={openCreate}
          >
            + 기준 추가
          </button>
        }
      />

      {notice && (
        <Notice tone={notice.tone === "ok" ? "ok" : "error"}>{notice.text}</Notice>
      )}

      {state.error && <InlineError message={state.error} onRetry={state.refetch} />}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <SummaryCard
          label="적용중"
          value={state.loading || state.error ? "—" : String(activeCount)}
        />
        <SummaryCard
          label="폐기"
          value={state.loading || state.error ? "—" : String(retiredCount)}
        />
      </div>

      {/*
        피처 목표값은 읽기 전용이다. `GET /settings` 는 `admin` 전용이라 다른 역할이
        채울 수 없으므로 `types/api.ts` 상수로 렌더링한다 (§7).
        이 값은 goal.md 2.3 의 하드 비즈니스 룰이지 사용자 설정이 아니다.
      */}
      <Callout>
        피처 목표값 (읽기 전용) — <strong>SN_TARGET {SN_TARGET.toFixed(1)}%</strong> ·{" "}
        <strong>AG_TARGET {AG_TARGET.toFixed(1)}%</strong> ·{" "}
        <strong>CU_TARGET {CU_TARGET.toFixed(1)}%</strong>
        <br />
        <span style={{ fontSize: 11.5, color: T.textMuted }}>
          배합 목표값이며 제품 규격 상하한과는 다릅니다. v1 에서 변경할 수 없습니다.
        </span>
      </Callout>

      <Section
        title={`품질기준 목록 (${state.loading || state.error ? "—" : total.toLocaleString()}건)`}
        right={
          <Chips
            value={filter}
            onChange={(v) => {
              setFilter(v as Filter);
              setPage(1);
            }}
            options={FILTERS}
          />
        }
      >
        <div style={{ overflowX: "auto", border: `1px solid ${T.border}`, borderRadius: 12 }}>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: 12.5,
              fontVariantNumeric: "tabular-nums",
              minWidth: 1080,
            }}
          >
            <thead>
              <tr style={{ background: "#F8F9FB" }}>
                <Th rowSpan={2}>제품 코드</Th>
                <Th rowSpan={2}>제품명</Th>
                {PAIRS.map(([, label]) => (
                  <Th key={label} colSpan={2} center>
                    {label} (%)
                  </Th>
                ))}
                <Th rowSpan={2} right>
                  품질점수 최소
                </Th>
                <Th rowSpan={2} right>
                  버전
                </Th>
                <Th rowSpan={2}>개정일</Th>
                <Th rowSpan={2}>상태</Th>
                <Th rowSpan={2}>액션</Th>
              </tr>
              <tr style={{ background: "#F8F9FB" }}>
                {PAIRS.map(([k]) => [
                  <Th key={`${k}-lo`} right small>
                    최소
                  </Th>,
                  <Th key={`${k}-hi`} right small>
                    최대
                  </Th>,
                ])}
              </tr>
            </thead>
            <tbody>
              {state.loading && (
                <tr>
                  <Td colSpan={15} muted>
                    불러오는 중…
                  </Td>
                </tr>
              )}
              {!state.loading && !state.error && rows.length === 0 && (
                <tr>
                  <Td colSpan={15} muted>
                    등록된 품질기준이 없습니다.
                  </Td>
                </tr>
              )}
              {!state.loading &&
                rows.map((d) => (
                  <tr key={d.id} style={{ borderTop: `1px solid ${T.border}` }}>
                    <Td>{d.code}</Td>
                    <Td>{d.name}</Td>
                    {PAIRS.map(([k]) => [
                      <Td key={`${k}-lo`} right>
                        {num(d.value?.[`${k}_min`], D[k])}
                      </Td>,
                      <Td key={`${k}-hi`} right>
                        {num(d.value?.[`${k}_max`], D[k])}
                      </Td>,
                    ])}
                    <Td right>{num(d.value?.pass_score, 0)}</Td>
                    <Td right>{d.version}</Td>
                    <Td>{dateOnly(d.created_at)}</Td>
                    <Td>
                      <StatusBadge
                        variant={d.active ? "green" : "gray"}
                        label={d.active ? "적용중" : "폐기"}
                      />
                    </Td>
                    <Td>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button
                          type="button"
                          className="btn"
                          disabled={!canWrite}
                          onClick={() => openEdit(d)}
                        >
                          수정
                        </button>
                        <button
                          type="button"
                          className="btn"
                          disabled={!canWrite || !d.active}
                          onClick={() => void retire(d)}
                        >
                          폐기
                        </button>
                      </div>
                    </Td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>

        <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />

        <span style={{ fontSize: 11, color: T.textMuted, lineHeight: 1.6 }}>
          ⓘ 목록은 활성 최신 버전 1행만 표시됩니다. 폐기해도 행은 삭제되지 않고 상태만 바뀝니다.
          `규격`·`중량허용` 은 API 계약에 정의된 필드가 없어 표시하지 않습니다.
        </span>
      </Section>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? "품질기준 수정" : "품질기준 등록"}
        description={editing ? `${editing.code} · 저장하면 버전이 증가합니다` : undefined}
        width={620}
        footer={
          <>
            <button type="button" className="btn" onClick={() => setOpen(false)}>
              취소
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={saving}
              onClick={() => void save()}
            >
              {saving ? "저장 중…" : "저장"}
            </button>
          </>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {errors._form && <Notice tone="error">{errors._form}</Notice>}

          <FormField label="제품 코드" error={errors.product_code}>
            <input
              type="text"
              value={form.product_code}
              readOnly={editing !== null}
              onChange={(e) => setForm((f) => ({ ...f, product_code: e.target.value }))}
              style={inputStyle(!!errors.product_code, editing !== null)}
            />
          </FormField>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {PAIRS.map(([k, label]) => (
              <div key={k} style={{ display: "flex", gap: 10 }}>
                <FormField label={`${label} 최소 (%)`} error={errors[`${k}_min`]}>
                  <input
                    type="number"
                    step={k === "cu" ? "0.01" : "0.1"}
                    value={form[`${k}_min`]}
                    onChange={(e) => setForm((f) => ({ ...f, [`${k}_min`]: e.target.value }))}
                    style={inputStyle(!!errors[`${k}_min`])}
                  />
                </FormField>
                <FormField label={`${label} 최대 (%)`} error={errors[`${k}_max`]}>
                  <input
                    type="number"
                    step={k === "cu" ? "0.01" : "0.1"}
                    value={form[`${k}_max`]}
                    onChange={(e) => setForm((f) => ({ ...f, [`${k}_max`]: e.target.value }))}
                    style={inputStyle(!!errors[`${k}_max`])}
                  />
                </FormField>
              </div>
            ))}
          </div>

          <FormField label="품질 합격 점수 (점)" error={errors.pass_score}>
            <input
              type="number"
              step="1"
              value={form.pass_score}
              onChange={(e) => setForm((f) => ({ ...f, pass_score: e.target.value }))}
              style={inputStyle(!!errors.pass_score)}
            />
          </FormField>

          <span style={{ fontSize: 11.5, color: T.textMuted, lineHeight: 1.6 }}>
            성분 상하한은 제품 규격이며 배합 최적화 경계(Sn 55~70)와 다릅니다. 상하한 합계에는
            100% 제약을 적용하지 않습니다.
          </span>
        </div>
      </Modal>
    </PageShell>
  );
}

// ── 조각 ──────────────────────────────────────────────────────────────────────

function inputStyle(invalid: boolean, readOnly = false): React.CSSProperties {
  return {
    height: 34,
    width: "100%",
    padding: "0 10px",
    borderRadius: 8,
    border: `1px solid ${invalid ? T.error : T.border}`,
    background: readOnly ? T.surfaceSubtle : T.surface,
    fontSize: 12.5,
    fontFamily: "inherit",
    color: T.text,
  };
}

function FormField({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5, flex: 1, minWidth: 0 }}>
      <label style={{ fontSize: 12, fontWeight: 600, color: T.textSub }}>{label}</label>
      {children}
      <FieldError message={error} />
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ fontSize: 12, fontWeight: 600, color: T.textSub }}>{label}</span>
      <strong style={{ fontSize: 28, fontWeight: 700, color: T.text, lineHeight: 1.2 }}>
        {value}
      </strong>
    </div>
  );
}

function Th({
  children,
  colSpan,
  rowSpan,
  right,
  center,
  small,
}: {
  children: React.ReactNode;
  colSpan?: number;
  rowSpan?: number;
  right?: boolean;
  center?: boolean;
  small?: boolean;
}) {
  return (
    <th
      colSpan={colSpan}
      rowSpan={rowSpan}
      style={{
        padding: small ? "6px 10px" : "10px 12px",
        fontSize: 12,
        fontWeight: 600,
        color: T.textSub,
        textAlign: right ? "right" : center ? "center" : "left",
        whiteSpace: "nowrap",
        borderBottom: `1px solid ${T.border}`,
      }}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  colSpan,
  right,
  muted,
}: {
  children: React.ReactNode;
  colSpan?: number;
  right?: boolean;
  muted?: boolean;
}) {
  return (
    <td
      colSpan={colSpan}
      style={{
        padding: muted ? "28px 12px" : "9px 12px",
        color: muted ? T.textMuted : T.text,
        textAlign: muted ? "center" : right ? "right" : "left",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </td>
  );
}
