"use client";

/**
 * FE-RT-32 — 코드 관리 · `/master/code` · SF-AD2 §1.7 "코드 관리" (필수)
 *
 * 명세: `specs/plan-g3.md` FE-RT-32. 와이어프레임 없음(SF-TD3 §3).
 * 저장 테이블: `master_codes` — **이 화면이 해당 테이블의 정본 화면이다.** 501 아님.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * 라운드 2 에서 고친 것:
 *   - 하드코딩 코드 18건 삭제 → `GET /api/v1/master/codes` 실 연동
 *   - 코드유형 칩을 mock 배열에서 파생하던 것 → **`GET /master/code-groups`
 *     실 응답**으로 생성 (건수 포함)
 *   - 🔴 **`삭제`(빨강) 버튼 → `비활성`.** 물리 삭제 API 를 부르지 않는다.
 *     공통 코드는 `lots.status`·`suppliers.code` 가 참조하는 마스터이고
 *     db-schema §5 가 `lots`/`components`/`quality` 를 무기한 보관으로 규정하므로
 *     참조 무결성을 위해 **비활성화(soft)만 허용**한다 (§5 판단)
 *   - 필드명 `typeCode`/`codeValue`/`codeName` → 계약 이름 `group_code`/`code`/`name`
 *   - 권한 분기 신설 — 이 화면의 쓰기는 **`admin` 단독**이다 (30·31 과 다르다)
 *
 * 제거하고 **계약 누락으로 남긴 것**: `typeName`(유형명) · `description`(설명).
 * `master_codes` 에 그룹 표시명 컬럼이 없고, 설명의 `value` JSONB 키 구조도
 * 계약이 정의하지 않았다. v1 은 `group_code` 원문을 그대로 칩에 표시한다 (§4).
 *
 * ⚠ **UK 가 이 화면에서 중복을 막지 못한다 — v1.1 설계 결함** (§6 · 부록 B #1).
 *   UK 가 `(group_code, code, version)` 이라 `('SUPPLIER','SUP_A',1)` 과
 *   `('SUPPLIER','SUP_A',2)` 가 **둘 다 저장된다.** 서버가 409 를 주지 않을 수 있으므로
 *   등록 전 `GET ?group_code=` 로 동일 `code` 존재 여부를 확인하고 있으면 저장을 막는다.
 *   **이건 임시방편이며 경쟁 조건을 못 막는다.**
 * ══════════════════════════════════════════════════════════════════════════════
 */

import { useCallback, useMemo, useState } from "react";
import { createMasterCode, getMasterCodeGroups, getMasterCodes, patchMasterCode } from "@/lib/koryo-api";
import type { MasterCodeDto, MasterGroupCode } from "@/types/api";
import { Modal } from "@/components/ui/Modal";
import { SearchInput } from "@/components/ui/SearchInput";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { T } from "@/components/ui/tokens";
import {
  InlineError,
  PageHeader,
  PageShell,
  Pagination,
  Section,
  hasRole,
  useRole,
} from "../../_g1/ui";
import { Chips, FieldError, Notice, errText, useApi } from "../../_g3/ui";

const PAGE_SIZE = 50;

interface FormState {
  group_code: string;
  code: string;
  name: string;
  sort_order: string;
}

const EMPTY_FORM: FormState = { group_code: "", code: "", name: "", sort_order: "0" };

/** §6 검증 규칙 — 길이는 `VARCHAR` 정의 그대로다 */
function validate(f: FormState): Record<string, string> {
  const e: Record<string, string> = {};
  const g = f.group_code.trim();
  if (g === "") e.group_code = "그룹 코드를 선택하세요";
  else if (g.length > 30) e.group_code = "그룹 코드는 1~30자입니다";
  else if (!/^[A-Z0-9_]+$/.test(g)) e.group_code = "영문 대문자·숫자·언더스코어만 가능합니다";

  const c = f.code.trim();
  if (c === "") e.code = "코드값을 입력하세요";
  else if (c.length > 30) e.code = "코드값은 1~30자입니다";
  else if (!/^[A-Z0-9_]+$/.test(c)) e.code = "영문 대문자·숫자·언더스코어만 가능합니다";

  const n = f.name.trim();
  if (n === "") e.name = "코드명을 입력하세요";
  else if (n.length > 100) e.name = "코드명은 1~100자입니다";

  const s = Number(f.sort_order);
  if (f.sort_order === "" || !Number.isInteger(s) || s < 0 || s > 999)
    e.sort_order = "정렬순서는 0~999 정수입니다";

  return e;
}

export default function MasterCodePage() {
  const role = useRole();
  /** api-contract §8.8 — 이 화면의 쓰기는 **`admin` 단독**이다 */
  const canWrite = hasRole(role, "admin");

  const [group, setGroup] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  /** 코드유형 칩 — **서버 응답으로 만든다.** 하드코딩 목록이 아니다 (수용 기준 5) */
  const groups = useApi(() => getMasterCodeGroups(), []);

  /** 검색어는 **서버로 보낸다** — 페이지 안에서만 거르면 다음 페이지 항목을 못 찾는다 */
  const term = search.trim();
  const state = useApi(
    () =>
      getMasterCodes({
        group_code: (group || undefined) as MasterGroupCode | undefined,
        q: term || undefined,
        page,
        page_size: PAGE_SIZE,
      }),
    [group, page, term]
  );

  const rows = useMemo(() => state.data?.items ?? [], [state.data]);
  const total = state.data?.total ?? 0;

  const groupChips = useMemo(() => {
    const list = groups.data ?? [];
    const all = list.reduce((sum, g) => sum + g.count, 0);
    return [
      { value: "", label: `전체 (${all})` },
      ...list.map((g) => ({ value: g.group_code, label: `${g.group_code} (${g.count})` })),
    ];
  }, [groups.data]);

  /** 서버가 이미 걸렀다 — 여기서 다시 거르지 않는다 */
  const visible = rows;

  // ── 모달 ────────────────────────────────────────────────────────────────────
  const [editing, setEditing] = useState<MasterCodeDto | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const openCreate = () => {
    setEditing(null);
    // 그룹 내 최대 정렬값 + 1 을 기본값으로 (§4)
    const maxSort = rows.reduce((m, r) => Math.max(m, r.sort_order), 0);
    setForm({ ...EMPTY_FORM, group_code: group, sort_order: String(maxSort + 1) });
    setErrors({});
    setOpen(true);
  };

  const openEdit = (d: MasterCodeDto) => {
    setEditing(d);
    setForm({
      group_code: d.group_code,
      code: d.code,
      name: d.name,
      sort_order: String(d.sort_order),
    });
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
        await patchMasterCode(editing.id, {
          name: form.name.trim(),
          sort_order: Number(form.sort_order),
        });
        setNotice({ tone: "ok", text: "수정되었습니다." });
      } else {
        // ⚠ 임시방편 중복 확인 (§6 경고). 경쟁 조건은 막지 못한다
        const existing = await getMasterCodes({
          group_code: form.group_code.trim() as MasterGroupCode,
          page_size: 200,
        });
        if (existing.items.some((it) => it.code === form.code.trim())) {
          setErrors({ code: "이미 등록된 코드값입니다" });
          setSaving(false);
          return;
        }
        await createMasterCode({
          group_code: form.group_code.trim() as MasterGroupCode,
          code: form.code.trim(),
          name: form.name.trim(),
          sort_order: Number(form.sort_order),
        });
        setNotice({ tone: "ok", text: "등록되었습니다." });
      }
      setOpen(false);
      state.refetch();
      groups.refetch();
    } catch (err) {
      const msg = errText(err);
      if (/409|이미 등록/.test(msg)) setErrors({ code: "이미 등록된 코드값입니다" });
      else setErrors({ _form: msg });
    } finally {
      setSaving(false);
    }
  }, [form, editing, state, groups]);

  /** 🔴 **비활성화**다. DELETE 엔드포인트를 부르지 않는다 */
  const deactivate = useCallback(
    async (d: MasterCodeDto) => {
      if (
        !window.confirm(
          `${d.group_code} / ${d.code} 코드를 비활성화하시겠습니까?\n` +
            `다른 데이터가 참조할 수 있으므로 삭제하지 않고 비활성 상태로만 바꿉니다.`
        )
      )
        return;
      setNotice(null);
      try {
        await patchMasterCode(d.id, { active: false });
        setNotice({ tone: "ok", text: `${d.code} 코드를 비활성화했습니다.` });
        state.refetch();
      } catch (err) {
        setNotice({ tone: "error", text: errText(err) });
      }
    },
    [state]
  );

  const groupOptions = useMemo(
    () => (groups.data ?? []).map((g) => g.group_code),
    [groups.data]
  );

  return (
    <PageShell>
      <PageHeader
        title="코드 관리"
        subtitle="시스템 공통 코드 테이블 관리"
        actions={
          <button
            type="button"
            className="btn btn-primary"
            disabled={!canWrite}
            title={canWrite ? undefined : "등록 권한이 없습니다 (admin 전용)"}
            onClick={openCreate}
          >
            + 코드 추가
          </button>
        }
      />

      {notice && <Notice tone={notice.tone === "ok" ? "ok" : "error"}>{notice.text}</Notice>}

      {state.error && <InlineError message={state.error} onRetry={state.refetch} />}
      {/* 칩 목록이 실패해도 본 목록은 살린다 — 독립 실패 처리 */}
      {groups.error && <InlineError message={groups.error} onRetry={groups.refetch} />}

      <Section
        title={`코드 목록 (${state.loading || state.error ? "—" : total.toLocaleString()}건)`}
        right={
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="코드값, 코드명 검색…"
            width={220}
            variant="plain"
            clearable
            ariaLabel="코드값, 코드명 검색…"
          />
        }
      >
        <Chips
          value={group}
          onChange={(v) => {
            setGroup(v);
            setPage(1);
          }}
          options={groups.loading ? [{ value: "", label: "전체 (—)" }] : groupChips}
        />

        <div style={{ overflowX: "auto", border: `1px solid ${T.border}`, borderRadius: 12 }}>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: 12.5,
              fontVariantNumeric: "tabular-nums",
              minWidth: 760,
            }}
          >
            <thead>
              <tr style={{ background: "#F8F9FB" }}>
                <Th>코드유형</Th>
                <Th>코드값</Th>
                <Th>코드명</Th>
                <Th right>정렬순서</Th>
                <Th>활성</Th>
                <Th>액션</Th>
              </tr>
            </thead>
            <tbody>
              {state.loading && (
                <tr>
                  <Td colSpan={6} muted>
                    불러오는 중…
                  </Td>
                </tr>
              )}
              {!state.loading && !state.error && rows.length === 0 && (
                <tr>
                  <Td colSpan={6} muted>
                    등록된 공통 코드가 없습니다.
                  </Td>
                </tr>
              )}
              {!state.loading && !state.error && rows.length > 0 && visible.length === 0 && (
                <tr>
                  <Td colSpan={6} muted>
                    검색 결과가 없습니다.
                  </Td>
                </tr>
              )}
              {!state.loading &&
                visible.map((d) => (
                  <tr key={d.id} style={{ borderTop: `1px solid ${T.border}` }}>
                    <Td>{d.group_code}</Td>
                    <Td>{d.code}</Td>
                    <Td>{d.name}</Td>
                    <Td right>{d.sort_order}</Td>
                    <Td>
                      <StatusBadge
                        variant={d.active ? "green" : "gray"}
                        label={d.active ? "활성" : "비활성"}
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
                          onClick={() => void deactivate(d)}
                        >
                          비활성
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
          ⓘ 코드는 삭제되지 않고 비활성화됩니다 — 다른 데이터가 참조하는 마스터이기 때문입니다.
          `유형명`·`설명` 은 계약에 정의된 필드가 없어 표시하지 않습니다.
        </span>
      </Section>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? "코드 수정" : "코드 등록"}
        description={editing ? `${editing.group_code} / ${editing.code}` : undefined}
        width={520}
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

          <FormField label="그룹 코드" error={errors.group_code}>
            <select
              value={form.group_code}
              disabled={editing !== null}
              onChange={(e) => setForm((f) => ({ ...f, group_code: e.target.value }))}
              style={inputStyle(!!errors.group_code, editing !== null)}
            >
              <option value="">선택하세요</option>
              {groupOptions.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </FormField>

          <FormField label="코드값" error={errors.code}>
            <input
              type="text"
              value={form.code}
              readOnly={editing !== null}
              maxLength={30}
              onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))}
              style={inputStyle(!!errors.code, editing !== null)}
            />
          </FormField>

          <FormField label="코드명" error={errors.name}>
            <input
              type="text"
              value={form.name}
              maxLength={100}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              style={inputStyle(!!errors.name)}
            />
          </FormField>

          <FormField label="정렬순서" error={errors.sort_order}>
            <input
              type="number"
              step="1"
              value={form.sort_order}
              onChange={(e) => setForm((f) => ({ ...f, sort_order: e.target.value }))}
              style={inputStyle(!!errors.sort_order)}
            />
          </FormField>

          <span style={{ fontSize: 11.5, color: T.textMuted, lineHeight: 1.6 }}>
            활성 여부는 등록 시 서버 기본값(활성)이 적용됩니다. 목록의 `비활성` 버튼으로만
            바꿀 수 있습니다.
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
    <div style={{ display: "flex", flexDirection: "column", gap: 5, minWidth: 0 }}>
      <label style={{ fontSize: 12, fontWeight: 600, color: T.textSub }}>{label}</label>
      {children}
      <FieldError message={error} />
    </div>
  );
}

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th
      style={{
        padding: "10px 12px",
        fontSize: 12,
        fontWeight: 600,
        color: T.textSub,
        textAlign: right ? "right" : "left",
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
