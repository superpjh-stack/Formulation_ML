"use client";

/**
 * FE-RT-26 · `/system/users` · 사용자 관리 (FR-SY-01) — **`admin` 전용**
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * 🔴 하드코딩 사용자 배열을 `GET /api/v1/users` 로 교체했다.
 *
 * ⚠ **5역할이 정본이다** (`admin`/`manufacture`/`quality`/`sales`/`viewer`).
 *   SF-AD2 의 4역할 표기는 산출물 결함이다 — DB 기본값이 `viewer` 라서 4역할만 노출하면
 *   **기본값 역할을 화면에서 고를 수조차 없는 모순**이 생긴다.
 *   라벨은 `types/auth.ts` 의 `ROLE_LABELS` 가 정본이다. 화면에서 다시 정의하지 않는다.
 *
 * ⚠ `password_hash` 는 응답에 없고 화면 어디에도 나타나지 않는다.
 *
 * ⚠ **삭제를 기본 동선으로 두지 않는다** (§5.1).
 *   `audit_logs.user_id` · `condition_history.changed_by` · `system_settings.updated_by`
 *   3개 FK 의 `ON DELETE` 가 지정돼 있지 않아, 감사 기록이 1건이라도 있으면 DELETE 는
 *   FK 위반으로 실패한다. 게다가 감사 로그 1년 보관은 NFR-S-04 요구사항이다.
 *   → 행 기본 액션은 [수정] [비활성화] 이고, [삭제] 는 **비활성 사용자**의 확장 메뉴 안쪽에만 둔다.
 *
 * ⚠ 자기 자신과 **마지막 관리자**는 비활성화·삭제·강등을 화면에서 막는다.
 *   관리자가 0명이 되면 복구 불가다.
 * ══════════════════════════════════════════════════════════════════════════════
 */

import { useMemo, useState } from "react";
import * as api from "@/lib/koryo-api";
import { useUsers } from "@/hooks/useKoryoData";
import { decodeJwt, getToken } from "@/lib/auth";
import { resolveError } from "@/lib/error-contract";
import { StatusScreen } from "@/components/layout/StatusScreen";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { ErrorAlert } from "@/components/ui/ErrorAlert";
import { PillFilter } from "@/components/ui/PillFilter";
import { Modal } from "@/components/ui/Modal";
import { KpiCard } from "@/components/ui/KpiCard";
import { T } from "@/components/ui/tokens";
import { ROLE_LABELS } from "@/types/auth";
import type { UserRole } from "@/types/auth";
import type { UserDto } from "@/types/api";

const PAGE_SIZE = 200;
/** 산출물에 비밀번호 정책이 없다 — 최소 길이만 UI 가드로 둔다 (복잡도·만료 규칙은 만들지 않는다) */
const MIN_PASSWORD_LEN = 8;

const ROLES: UserRole[] = ["admin", "manufacture", "quality", "sales", "viewer"];

const ROLE_OPTIONS: { value: "all" | UserRole; label: string }[] = [
  { value: "all", label: "전체" },
  ...ROLES.map((r) => ({ value: r as "all" | UserRole, label: ROLE_LABELS[r] })),
];

const ACTIVE_OPTIONS: { value: "all" | "active" | "inactive"; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "active", label: "활성" },
  { value: "inactive", label: "비활성" },
];

const ROLE_VARIANT: Record<UserRole, "violet" | "blue" | "green" | "amber" | "gray"> = {
  admin: "violet",
  manufacture: "blue",
  quality: "green",
  sales: "amber",
  viewer: "gray",
};

const dt = (s: string) => s.replace("T", " ").slice(0, 19);

function currentUsername(): string | null {
  const token = getToken();
  return token ? (decodeJwt(token)?.sub ?? null) : null;
}

export default function SystemUsersPage() {
  const [roleFilter, setRoleFilter] = useState<"all" | UserRole>("all");
  const [activeFilter, setActiveFilter] = useState<"all" | "active" | "inactive">("all");
  const [editing, setEditing] = useState<UserDto | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<UserDto | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const me = currentUsername();

  const query = useMemo(
    () => ({
      page_size: PAGE_SIZE,
      ...(roleFilter === "all" ? {} : { role: roleFilter }),
      ...(activeFilter === "all" ? {} : { active: activeFilter === "active" }),
    }),
    [roleFilter, activeFilter]
  );

  const { data, loading, error, refetch } = useUsers(query);
  // 역할 요약은 필터와 무관하게 전체 기준으로 센다
  const all = useUsers(useMemo(() => ({ page_size: PAGE_SIZE }), []));

  const rows = data?.items ?? [];
  const allRows = all.data?.items ?? [];
  const activeAdmins = allRows.filter((u) => u.role === "admin" && u.active);
  const lastAdminId = activeAdmins.length === 1 ? activeAdmins[0].id : null;

  async function setActive(user: UserDto, active: boolean) {
    setBusyId(user.id);
    setRowError(null);
    try {
      await api.patchUser(user.id, { active });
      refetch();
      all.refetch();
    } catch (err) {
      const entry = resolveError(err);
      setRowError(err instanceof Error ? err.message : entry.detail);
    } finally {
      setBusyId(null);
    }
  }

  if (loading) return <StatusScreen tone="loading" title="사용자 목록을 불러오는 중" />;

  if (error) {
    const entry = resolveError({ status: null, message: error });
    const forbidden = /\b403\b/.test(error) || entry.status === 403;
    return (
      <StatusScreen
        tone="error"
        title={forbidden ? "접근 권한이 없습니다" : entry.title}
        detail={forbidden ? "사용자 관리는 관리자(admin)만 사용할 수 있습니다." : entry.detail}
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

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* [A] 헤더 */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: T.text, margin: 0 }}>사용자 관리</h1>
          <p style={{ fontSize: 12.5, color: T.textSub, margin: "4px 0 0" }}>
            계정 등록 · 역할 부여 · 활성 상태 관리 (FR-SY-01 · 관리자 전용)
          </p>
        </div>
        <button type="button" className="btn pri" onClick={() => setCreating(true)}>
          + 사용자 추가
        </button>
      </div>

      {rowError && <ErrorAlert message={rowError} />}

      {/* [B] 역할 요약 5장 */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 16 }}>
        {ROLES.map((r) => (
          <KpiCard
            key={r}
            label={ROLE_LABELS[r]}
            value={all.loading ? "—" : allRows.filter((u) => u.role === r).length.toLocaleString("ko-KR")}
            unit="명"
          />
        ))}
      </div>

      <div className="card" style={{ display: "flex", gap: 14, alignItems: "flex-end", flexWrap: "wrap" }}>
        <PillFilter options={ROLE_OPTIONS} value={roleFilter} onChange={setRoleFilter} label="역할:" />
        <PillFilter options={ACTIVE_OPTIONS} value={activeFilter} onChange={setActiveFilter} label="활성:" />
      </div>

      {/* [C] 표 */}
      {rows.length === 0 ? (
        <StatusScreen
          tone="empty"
          title="조건에 맞는 사용자가 없습니다"
          actions={[
            {
              label: "필터 초기화",
              onClick: () => {
                setRoleFilter("all");
                setActiveFilter("all");
              },
              primary: true,
            },
          ]}
        />
      ) : (
        <div style={tableWrapStyle}>
          <table style={tableStyle}>
            <thead>
              <tr style={{ background: T.surfaceSubtle }}>
                <th style={thStyle}>계정ID</th>
                <th style={thStyle}>이메일</th>
                <th style={thStyle}>역할</th>
                <th style={thStyle}>활성</th>
                <th style={thStyle}>마지막 로그인</th>
                <th style={thStyle}>등록일</th>
                <th style={{ ...thStyle, textAlign: "right" }}>액션</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => {
                const isMe = me !== null && u.username === me;
                const isLastAdmin = lastAdminId === u.id;
                const locked = isMe || isLastAdmin;
                const lockReason = isMe
                  ? "본인 계정은 변경할 수 없습니다"
                  : isLastAdmin
                    ? "마지막 관리자 계정은 변경할 수 없습니다"
                    : undefined;
                return (
                  <tr
                    key={u.id}
                    style={{
                      borderBottom: `1px solid ${T.border}`,
                      opacity: u.active ? 1 : 0.6,
                    }}
                  >
                    <td style={{ ...tdStyle, fontWeight: 600 }}>{u.username}</td>
                    <td style={tdStyle}>{u.email}</td>
                    <td style={tdStyle}>
                      <StatusBadge variant={ROLE_VARIANT[u.role]} label={ROLE_LABELS[u.role]} />
                    </td>
                    <td style={tdStyle}>
                      <StatusBadge variant={u.active ? "green" : "gray"} label={u.active ? "활성" : "비활성"} dot />
                    </td>
                    {/* null 은 "로그인 이력 없음" 이다. 등록일로 대체하지 않는다 */}
                    <td style={tdStyle}>{u.last_login ? dt(u.last_login) : "로그인 이력 없음"}</td>
                    <td style={tdStyle}>{dt(u.created_at)}</td>
                    <td style={{ ...tdStyle, textAlign: "right" }}>
                      <div style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                        <button type="button" className="btn" onClick={() => setEditing(u)}>
                          수정
                        </button>
                        {/* 활성/비활성 **토글**.
                            초판은 라벨이 "비활성화" 로 고정이고 비활성 사용자에겐 `disabled` 라
                            **한 번 끈 계정을 목록에서 되살릴 수단이 없었다** (QA-B DEF-B-07).
                            재활성화는 파괴적이지 않으므로 자기보호·마지막관리자 잠금을 적용하지 않는다. */}
                        <button
                          type="button"
                          className="btn"
                          disabled={(u.active && locked) || busyId === u.id}
                          title={u.active ? lockReason : "비활성 계정을 다시 활성화합니다"}
                          onClick={() => void setActive(u, !u.active)}
                        >
                          {busyId === u.id ? "처리 중…" : u.active ? "비활성화" : "활성화"}
                        </button>
                        {/* 삭제는 확장 메뉴 안쪽 · 비활성 사용자만 */}
                        <button
                          type="button"
                          className="btn"
                          aria-label="추가 작업"
                          onClick={() => setExpanded((p) => (p === u.id ? null : u.id))}
                        >
                          ⋯
                        </button>
                        {expanded === u.id && (
                          <button
                            type="button"
                            className="btn"
                            disabled={u.active || locked}
                            title={
                              u.active
                                ? "활성 사용자는 삭제할 수 없습니다. 먼저 비활성화하세요"
                                : lockReason
                            }
                            onClick={() => setDeleting(u)}
                            style={{ color: T.error }}
                          >
                            삭제
                          </button>
                        )}
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
        ※ 퇴사·권한 회수는 <b>비활성화</b>로 처리합니다. 삭제하면 감사 로그 추적이 끊기며, 시스템
        기록이 남아 있는 계정은 삭제 자체가 실패합니다.
      </p>

      {/* [D] 추가/수정 */}
      <UserModal
        mode="create"
        open={creating}
        onClose={() => setCreating(false)}
        onSaved={() => {
          setCreating(false);
          refetch();
          all.refetch();
        }}
      />
      <UserModal
        mode="edit"
        open={editing !== null}
        user={editing}
        lockRole={editing !== null && (editing.username === me || editing.id === lastAdminId)}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          refetch();
          all.refetch();
        }}
      />

      {/* [E] 삭제 확인 */}
      <DeleteModal
        user={deleting}
        onClose={() => setDeleting(null)}
        onDeleted={() => {
          setDeleting(null);
          setExpanded(null);
          refetch();
          all.refetch();
        }}
      />
    </div>
  );
}

// ─── [D] 추가/수정 ────────────────────────────────────────────────────────────

function UserModal({
  mode,
  open,
  user,
  lockRole,
  onClose,
  onSaved,
}: {
  mode: "create" | "edit";
  open: boolean;
  user?: UserDto | null;
  lockRole?: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    username: "",
    email: "",
    password: "",
    role: "viewer" as UserRole,
    active: true,
  });
  const [initialised, setInitialised] = useState<number | "new" | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const targetKey = mode === "edit" ? (user?.id ?? null) : ("new" as const);
  if (open && targetKey !== null && initialised !== targetKey) {
    setInitialised(targetKey);
    setError(null);
    setForm(
      mode === "edit" && user
        ? { username: user.username, email: user.email, password: "", role: user.role, active: user.active }
        : { username: "", email: "", password: "", role: "viewer", active: true }
    );
  }

  const usernameError =
    mode === "create"
      ? form.username.trim() === ""
        ? "계정ID를 입력하세요"
        : form.username.trim().length > 50
          ? "계정ID는 50자 이하여야 합니다"
          : null
      : null;
  const emailError =
    form.email.trim() === ""
      ? "이메일을 입력하세요"
      : form.email.trim().length > 100
        ? "이메일은 100자 이하여야 합니다"
        : !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())
          ? "이메일 형식이 올바르지 않습니다"
          : null;
  const passwordError =
    mode === "create"
      ? form.password.length < MIN_PASSWORD_LEN
        ? `비밀번호는 ${MIN_PASSWORD_LEN}자 이상이어야 합니다`
        : null
      : form.password !== "" && form.password.length < MIN_PASSWORD_LEN
        ? `비밀번호는 ${MIN_PASSWORD_LEN}자 이상이어야 합니다`
        : null;

  const invalid = Boolean(usernameError || emailError || passwordError);

  async function submit() {
    if (invalid) return;
    setSaving(true);
    setError(null);
    try {
      if (mode === "edit" && user) {
        await api.patchUser(user.id, {
          email: form.email.trim(),
          role: form.role,
          active: form.active,
          // 비우면 미변경이다. 빈 문자열을 보내지 않는다
          ...(form.password ? { password: form.password } : {}),
        });
      } else {
        await api.createUser({
          username: form.username.trim(),
          email: form.email.trim(),
          password: form.password,
          role: form.role,
        });
      }
      setInitialised(null);
      onSaved();
    } catch (err) {
      const entry = resolveError(err);
      setError(
        entry.status === 409
          ? "이미 사용 중인 계정ID 또는 이메일입니다"
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
      title={mode === "edit" ? "사용자 수정" : "사용자 추가"}
      description={mode === "edit" && user ? user.username : undefined}
      width={480}
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

        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={labelStyle}>계정ID {mode === "create" ? "* (1~50자)" : ""}</span>
          <input
            type="text"
            value={form.username}
            maxLength={50}
            readOnly={mode === "edit"}
            onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
            style={{ ...inputStyle, background: mode === "edit" ? T.surfaceSubtle : undefined }}
          />
          {mode === "edit" && (
            <span style={{ fontSize: 11, color: T.textMuted }}>계정ID 는 식별자라 변경할 수 없습니다.</span>
          )}
          {usernameError && <span style={fieldErrorStyle}>{usernameError}</span>}
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={labelStyle}>이메일 * (1~100자)</span>
          <input
            type="email"
            value={form.email}
            maxLength={100}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            style={inputStyle}
          />
          {emailError && <span style={fieldErrorStyle}>{emailError}</span>}
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={labelStyle}>
            비밀번호 {mode === "create" ? `* (${MIN_PASSWORD_LEN}자 이상)` : "(비우면 변경하지 않음)"}
          </span>
          <input
            type="password"
            value={form.password}
            autoComplete="new-password"
            onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
            style={inputStyle}
          />
          {passwordError && <span style={fieldErrorStyle}>{passwordError}</span>}
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={labelStyle}>역할 *</span>
          <select
            value={form.role}
            disabled={lockRole}
            onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as UserRole }))}
            style={inputStyle}
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
          {lockRole && (
            <span style={{ fontSize: 11, color: T.textMuted }}>
              본인 계정 또는 마지막 관리자 계정의 역할은 변경할 수 없습니다.
            </span>
          )}
        </label>

        {mode === "edit" && (
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={form.active}
              disabled={lockRole}
              onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))}
            />
            <span style={{ fontSize: 12.5, color: T.text }}>활성 계정</span>
          </label>
        )}
      </div>
    </Modal>
  );
}

// ─── [E] 삭제 확인 ────────────────────────────────────────────────────────────

function DeleteModal({
  user,
  onClose,
  onDeleted,
}: {
  user: UserDto | null;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [typed, setTyped] = useState("");
  const [deletingNow, setDeletingNow] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirmed = user !== null && typed === user.username;

  async function doDelete() {
    if (!user || !confirmed) return;
    setDeletingNow(true);
    setError(null);
    try {
      await api.deleteUser(user.id);
      setTyped("");
      onDeleted();
    } catch (err) {
      const entry = resolveError(err);
      // FK 위반은 그대로 보여준다 — 조용히 성공한 척하지 않는다
      setError(
        entry.status === 409
          ? "이 사용자는 시스템 기록이 남아 있어 삭제할 수 없습니다. 비활성화하세요."
          : err instanceof Error
            ? err.message
            : entry.detail
      );
    } finally {
      setDeletingNow(false);
    }
  }

  return (
    <Modal
      open={user !== null}
      onClose={() => {
        setTyped("");
        setError(null);
        onClose();
      }}
      title="사용자 삭제"
      description={user?.username}
      width={480}
      footer={
        <>
          <button
            type="button"
            className="btn"
            onClick={() => {
              setTyped("");
              setError(null);
              onClose();
            }}
          >
            취소
          </button>
          <button
            type="button"
            className="btn pri"
            disabled={!confirmed || deletingNow}
            onClick={() => void doDelete()}
          >
            {deletingNow ? "삭제 중…" : "삭제"}
          </button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {error && <ErrorAlert message={error} />}
        <p style={{ fontSize: 13, color: T.text, margin: 0, lineHeight: 1.7 }}>
          삭제하면 이 사용자의 <b>감사 로그 추적이 끊깁니다.</b> 대신 <b>비활성화</b>를 권장합니다.
          감사 로그는 1년 보관이 요구사항(NFR-S-04)입니다.
        </p>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={labelStyle}>확인을 위해 계정ID `{user?.username}` 를 입력하세요</span>
          <input type="text" value={typed} onChange={(e) => setTyped(e.target.value)} style={inputStyle} />
        </label>
      </div>
    </Modal>
  );
}

// ─── 스타일 ───────────────────────────────────────────────────────────────────

const labelStyle: React.CSSProperties = { fontSize: 11.5, fontWeight: 600, color: T.textSub };
const fieldErrorStyle: React.CSSProperties = { fontSize: 11.5, color: T.error };

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
