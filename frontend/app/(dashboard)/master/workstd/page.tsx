"use client";

/**
 * FE-RT-31 — 작업 표준 · `/master/workstd` · SF-AD2 §1.7 "작업 표준 관리" (필수, 버전 관리)
 *
 * 명세: `specs/plan-g3.md` FE-RT-31. 와이어프레임 없음(SF-TD3 §3).
 * 저장 테이블: `master_codes` (`group_code='WORK_STD'`) — CR-DB-001 승인·생성 완료. **501 아님.**
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * 라운드 2 에서 고친 것:
 *   - 하드코딩 문서 9건 삭제 → `GET /api/v1/master/work-standards` 실 연동
 *   - 죽은 버튼(`보기`·`개정`·`+ 문서 등록`) → 드로어 + 모달 + POST/PATCH 연결
 *   - **버전이 `"Rev.5"` 문자열이 아니라 `master_codes.version` 정수**다.
 *     표시만 `Rev.{n}` 으로 조립한다. 클라이언트가 버전을 계산하지 않는다 —
 *     개정 시 **서버가 자동 증가**시킨다 (api-contract §8.8)
 *   - 필드명 `code` → 계약 이름 `process_code`
 *   - **`content`(본문) 표시 신설** — 계약의 필수 필드인데 화면에 아예 없었다
 *   - 빈 목록(0건)과 검색 결과 0건을 **서로 다른 문구**로 분리 (§9)
 *   - 권한 분기 신설 (`admin`·`manufacture` 만 쓰기 — FE-RT-30 과 쓰기 역할이 다르다)
 *
 * 제거하고 **계약 누락으로 남긴 것**: `category`(분류) · `dept`(부서) · `pages`(페이지 수) ·
 * `updated_by`(개정자). `master_codes` 에 사용자 FK 가 **없다** — `value.author` 는
 * 자유 문자열이라 사용자 계정과 연결되지 않는다 (§4 · §14).
 * 그래서 **분류 칩 6개를 제거**했다. 근거 데이터가 없는 필터는 만들지 않는다.
 *
 * ⚠ **버전 이력은 DB 에 남지만 조회할 API 가 없다.** `GET` 에 `version` 필터가 없어
 *   v1 화면에서 과거 리비전을 볼 방법이 없다. **v1 게이트는 현재 버전 표기까지**이며
 *   이력 조회 화면은 계약 확장 요청 항목이다 (§7 · 부록 B).
 * ══════════════════════════════════════════════════════════════════════════════
 */

import { useCallback, useMemo, useState } from "react";
import { createWorkStandard, getWorkStandards, patchWorkStandard } from "@/lib/koryo-api";
import type { WorkStandardDto, WorkStandardIn } from "@/types/api";
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
  dateOnly,
  hasRole,
  useRole,
} from "../../_g1/ui";
import { Chips, FieldError, Notice, errText, useApi } from "../../_g3/ui";

const PAGE_SIZE = 50;

type Filter = "all" | "active" | "retired";

const FILTERS = [
  { value: "all", label: "전체" },
  { value: "active", label: "현행" },
  { value: "retired", label: "폐기" },
];

interface FormState {
  process_code: string;
  title: string;
  content: string;
}

const EMPTY_FORM: FormState = { process_code: "", title: "", content: "" };

/** §6 검증 규칙 */
function validate(f: FormState, isRevision: boolean): Record<string, string> {
  const e: Record<string, string> = {};
  const code = f.process_code.trim();
  if (!isRevision) {
    if (code === "") e.process_code = "공정 코드를 입력하세요";
    else if (code.length > 50) e.process_code = "공정 코드는 1~50자입니다";
    else if (!/^[A-Z0-9-]+$/.test(code))
      e.process_code = "영문 대문자·숫자·하이픈만 사용할 수 있습니다";
  }
  const title = f.title.trim();
  if (title === "") e.title = "제목을 입력하세요";
  else if (title.length > 200) e.title = "제목은 1~200자입니다";

  if (f.content.trim() === "") e.content = "본문을 입력하세요";
  return e;
}

export default function MasterWorkStdPage() {
  const role = useRole();
  /** api-contract §8.8 — 이 화면의 쓰기는 `admin`·`manufacture` 다 */
  const canWrite = hasRole(role, "admin", "manufacture");

  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const activeParam = filter === "all" ? undefined : filter === "active";

  const state = useApi(
    () => getWorkStandards({ active: activeParam, page, page_size: PAGE_SIZE }),
    [activeParam, page]
  );

  const rows = useMemo(() => state.data?.items ?? [], [state.data]);
  const total = state.data?.total ?? 0;

  /** 검색은 클라이언트 필터다 — `title`/`process_code` 검색 파라미터가 계약에 없다 (§5) */
  const term = search.trim().toLowerCase();
  const visible = useMemo(
    () =>
      term === ""
        ? rows
        : rows.filter(
            (d) =>
              d.name.toLowerCase().includes(term) || d.code.toLowerCase().includes(term)
          ),
    [rows, term]
  );

  // ── 본문 드로어 ─────────────────────────────────────────────────────────────
  const [viewing, setViewing] = useState<WorkStandardDto | null>(null);

  // ── 등록/개정 모달 ──────────────────────────────────────────────────────────
  const [editing, setEditing] = useState<WorkStandardDto | null>(null);
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

  const openRevise = (d: WorkStandardDto) => {
    setEditing(d);
    setForm({ process_code: d.code, title: d.name, content: d.value?.content ?? "" });
    setErrors({});
    setOpen(true);
  };

  const save = useCallback(async () => {
    const e = validate(form, editing !== null);
    setErrors(e);
    if (Object.keys(e).length > 0) return;

    setSaving(true);
    setNotice(null);
    try {
      if (editing) {
        // 🔴 `version` 을 보내지 않는다. **서버가 자동 증가**시킨다
        const body: Partial<WorkStandardIn> = {
          title: form.title.trim(),
          content: form.content,
        };
        const updated = await patchWorkStandard(editing.id, body);
        setNotice({ tone: "ok", text: `Rev.${updated.version} 으로 개정되었습니다.` });
      } else {
        await createWorkStandard({
          process_code: form.process_code.trim(),
          title: form.title.trim(),
          content: form.content,
        });
        setNotice({ tone: "ok", text: "등록되었습니다." });
      }
      setOpen(false);
      state.refetch();
    } catch (err) {
      const msg = errText(err);
      if (/409|이미 등록/.test(msg)) {
        setErrors({ process_code: "이미 등록된 공정 코드입니다" });
      } else {
        setErrors({ _form: msg });
      }
    } finally {
      setSaving(false);
    }
  }, [form, editing, state]);

  return (
    <PageShell>
      <PageHeader
        title="작업표준 관리"
        subtitle="공정별 작업표준 문서 목록 및 개정 이력"
        actions={
          <button
            type="button"
            className="btn btn-primary"
            disabled={!canWrite}
            title={canWrite ? undefined : "등록 권한이 없습니다 (admin·manufacture)"}
            onClick={openCreate}
          >
            + 문서 등록
          </button>
        }
      />

      {notice && <Notice tone={notice.tone === "ok" ? "ok" : "error"}>{notice.text}</Notice>}

      {state.error && <InlineError message={state.error} onRetry={state.refetch} />}

      <Section
        title={`작업표준 문서 (${state.loading || state.error ? "—" : total.toLocaleString()}건)`}
        right={
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Chips
              value={filter}
              onChange={(v) => {
                setFilter(v as Filter);
                setPage(1);
              }}
              options={FILTERS}
            />
            <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="문서명, 코드 검색…"
            width={200}
            variant="plain"
            clearable
            ariaLabel="문서명, 코드 검색…"
          />
          </div>
        }
      >
        {state.loading && <Center>불러오는 중…</Center>}

        {/* 🔴 두 상태를 구분해서 표시한다 (§9 · 수용 기준 7) */}
        {!state.loading && !state.error && rows.length === 0 && (
          <Center>등록된 작업표준이 없습니다.</Center>
        )}
        {!state.loading && !state.error && rows.length > 0 && visible.length === 0 && (
          <Center>검색 결과가 없습니다.</Center>
        )}

        {!state.loading && visible.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {visible.map((d) => (
              <div
                key={d.id}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                  padding: "14px 16px",
                  borderRadius: 10,
                  border: `1px solid ${T.border}`,
                  background: T.surface,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <strong style={{ fontSize: 13, fontWeight: 600, color: T.text, flex: 1 }}>
                    {d.name}
                  </strong>
                  <StatusBadge
                    variant={d.active ? "green" : "gray"}
                    label={d.active ? "현행" : "폐기"}
                  />
                </div>

                <span style={{ fontSize: 12, color: T.textSub }}>
                  {d.code} · <strong style={{ color: T.text }}>Rev.{d.version}</strong> · 개정일{" "}
                  {dateOnly(d.created_at)}
                </span>

                {/* `author` 는 users FK 가 아니라 자유 문자열이다 — 있을 때만 보여준다 */}
                {d.value?.author && (
                  <span style={{ fontSize: 11.5, color: T.textMuted }}>
                    작성 {d.value.author}
                  </span>
                )}

                <div style={{ display: "flex", gap: 6, marginTop: 2 }}>
                  <button type="button" className="btn" onClick={() => setViewing(d)}>
                    보기
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={!canWrite || !d.active}
                    onClick={() => openRevise(d)}
                  >
                    개정
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />

        <span style={{ fontSize: 11, color: T.textMuted, lineHeight: 1.6 }}>
          ⓘ 목록은 활성 최신 버전 1행만 표시됩니다. 과거 리비전은 DB 에 보존되지만 조회 API 가
          없어 v1 에서 열람할 수 없습니다. `분류`·`부서`·`페이지 수`·`개정자` 는 계약에 정의된
          필드가 없어 표시하지 않습니다.
        </span>
      </Section>

      {/* 본문 드로어 — 목록 응답의 `content` 를 재사용한다 (단건 GET 이 계약에 없다) */}
      <Modal
        open={viewing !== null}
        onClose={() => setViewing(null)}
        title={viewing?.name ?? ""}
        description={viewing ? `${viewing.code} · Rev.${viewing.version}` : undefined}
        width={680}
        footer={
          <button type="button" className="btn" onClick={() => setViewing(null)}>
            닫기
          </button>
        }
      >
        <pre
          style={{
            margin: 0,
            fontSize: 12.5,
            lineHeight: 1.8,
            color: T.text,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            fontFamily: "inherit",
          }}
        >
          {viewing?.value?.content ?? "본문이 없습니다."}
        </pre>
      </Modal>

      {/* 등록 / 개정 */}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? "작업표준 개정" : "작업표준 등록"}
        description={
          editing
            ? `${editing.code} · 현재 Rev.${editing.version} → 저장하면 서버가 버전을 증가시킵니다`
            : undefined
        }
        width={640}
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

          <FormField label="공정 코드" error={errors.process_code}>
            <input
              type="text"
              value={form.process_code}
              readOnly={editing !== null}
              placeholder="MX-STD-001"
              onChange={(e) =>
                setForm((f) => ({ ...f, process_code: e.target.value.toUpperCase() }))
              }
              style={inputStyle(!!errors.process_code, editing !== null)}
            />
          </FormField>

          <FormField label="제목" error={errors.title}>
            <input
              type="text"
              value={form.title}
              maxLength={200}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              style={inputStyle(!!errors.title)}
            />
          </FormField>

          <FormField label="본문" error={errors.content}>
            <textarea
              value={form.content}
              rows={10}
              onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
              style={{
                ...inputStyle(!!errors.content),
                height: "auto",
                padding: "10px",
                lineHeight: 1.7,
                resize: "vertical",
              }}
            />
          </FormField>

          <FormField label="버전">
            <input
              type="text"
              readOnly
              value={editing ? `Rev.${editing.version} → 서버 자동 증가` : "Rev.1 (신규)"}
              style={inputStyle(false, true)}
            />
          </FormField>
        </div>
      </Modal>
    </PageShell>
  );
}

// ── 조각 ──────────────────────────────────────────────────────────────────────

function Center({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        minHeight: 180,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 13,
        color: T.textMuted,
      }}
    >
      {children}
    </div>
  );
}

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
