"use client";

/**
 * FE-RT-27 · `/system/logs` · 시스템 로그 (FR-SY-02) — **`admin` 전용**
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * 🔴 하드코딩 로그 배열을 `GET /api/v1/audit-logs` 로 교체했다.
 *
 * ⚠ **`action` 5값이 필터의 정본이다** (`CREATE`/`UPDATE`/`DELETE`/`LOGIN`/`PREDICT`).
 *   FR-SY-02 의 세 구절("사용자 접속 / 데이터 변경 / ML 예측 호출")이 여기에 정확히 대응한다.
 *   **다른 분류 체계를 발명하지 마라.** 한글 라벨은 `types/auth.ts` 의
 *   `AUDIT_ACTION_LABELS` 가 정본이다 — 화면에서 재정의하지 않는다.
 *
 * ⚠ **"성공/실패" 필터를 만들지 마라.** 저장된 로그는 **전부 성공(2xx) 건**이다.
 *   조회(GET)·실패한 쓰기·로그인 실패는 기록되지 않는다. 이 사실을 각주로 화면에 밝힌다 —
 *   숨기면 사용자가 "무단 접근 시도가 없었다"고 잘못 읽는다.
 *
 * ⚠ **내보내기 버튼을 만들지 마라.** `/data/export` 화이트리스트에 감사 로그가 없다.
 *   감사 기록 반출은 통제가 필요한 행위라 임의로 만들면 안 된다.
 *
 * ⚠ `detail` 스키마는 **액션별로 다르다.** 구조를 가정하지 말고 키-값으로 범용 렌더한다.
 *   `password_hash` 가 보이면 백엔드 결함이다.
 * ══════════════════════════════════════════════════════════════════════════════
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useAuditLogs, useUsers } from "@/hooks/useKoryoData";
import { resolveError } from "@/lib/error-contract";
import { StatusScreen } from "@/components/layout/StatusScreen";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { ErrorAlert } from "@/components/ui/ErrorAlert";
import { PillFilter } from "@/components/ui/PillFilter";
import { Modal } from "@/components/ui/Modal";
import { KpiCard } from "@/components/ui/KpiCard";
import { T } from "@/components/ui/tokens";
import { AUDIT_ACTION_LABELS } from "@/types/auth";
import type { AuditAction } from "@/types/auth";
import type { AuditLogDto } from "@/types/api";

const PAGE_SIZE = 50;

const ACTIONS: AuditAction[] = ["CREATE", "UPDATE", "DELETE", "LOGIN", "PREDICT"];

const ACTION_OPTIONS: { value: "all" | AuditAction; label: string }[] = [
  { value: "all", label: "전체" },
  ...ACTIONS.map((a) => ({ value: a as "all" | AuditAction, label: AUDIT_ACTION_LABELS[a] })),
];

const ACTION_VARIANT: Record<AuditAction, "green" | "amber" | "red" | "blue" | "violet"> = {
  CREATE: "green",
  UPDATE: "amber",
  DELETE: "red",
  LOGIN: "blue",
  PREDICT: "violet",
};

/** `target_table` → 그 자원을 볼 수 있는 화면. 매핑이 없으면 링크를 걸지 않는다 */
const TARGET_ROUTES: Record<string, string> = {
  lots: "/shipping/lot",
  quality: "/shipping/inspect",
  claims: "/shipping/claim",
  shipments: "/shipping/main",
  users: "/system/users",
  process_conditions: "/process/condition",
  equipment: "/process/monitor",
};

const dt = (s: string) => s.replace("T", " ").slice(0, 19);

function iso(d: Date) {
  return d.toISOString().slice(0, 10);
}
function daysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return iso(d);
}

export default function SystemLogsPage() {
  const [action, setAction] = useState<"all" | AuditAction>("all");
  const [userId, setUserId] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState(daysAgo(6));
  const [dateTo, setDateTo] = useState(iso(new Date()));
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<AuditLogDto | null>(null);

  const rangeError = dateFrom > dateTo ? "시작일이 종료일보다 늦습니다" : null;

  const baseQuery = useMemo(
    () => ({
      date_from: dateFrom,
      date_to: dateTo,
      ...(userId === "all" ? {} : { user_id: Number(userId) }),
    }),
    [dateFrom, dateTo, userId]
  );

  const listQuery = useMemo(
    () => ({
      ...baseQuery,
      page,
      page_size: PAGE_SIZE,
      ...(action === "all" ? {} : { action }),
    }),
    [baseQuery, page, action]
  );

  const list = useAuditLogs(rangeError ? {} : listQuery);
  // 요약은 `Page.total` 만 쓴다 — 전건을 받아 세지 않는다
  const loginCount = useAuditLogs(useMemo(() => ({ ...baseQuery, page_size: 1, action: "LOGIN" as AuditAction }), [baseQuery]));
  const createCount = useAuditLogs(useMemo(() => ({ ...baseQuery, page_size: 1, action: "CREATE" as AuditAction }), [baseQuery]));
  const updateCount = useAuditLogs(useMemo(() => ({ ...baseQuery, page_size: 1, action: "UPDATE" as AuditAction }), [baseQuery]));
  const deleteCount = useAuditLogs(useMemo(() => ({ ...baseQuery, page_size: 1, action: "DELETE" as AuditAction }), [baseQuery]));
  const predictCount = useAuditLogs(useMemo(() => ({ ...baseQuery, page_size: 1, action: "PREDICT" as AuditAction }), [baseQuery]));

  const users = useUsers(useMemo(() => ({ page_size: 200 }), []));

  const rows = list.data?.items ?? [];
  const total = list.data?.total ?? 0;
  const maxPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const changeTotal =
    createCount.data && updateCount.data && deleteCount.data
      ? createCount.data.total + updateCount.data.total + deleteCount.data.total
      : null;

  function resetFilters() {
    setAction("all");
    setUserId("all");
    setDateFrom(daysAgo(6));
    setDateTo(iso(new Date()));
    setPage(1);
  }

  if (list.loading && list.data === null) {
    return <StatusScreen tone="loading" title="시스템 로그를 불러오는 중" />;
  }

  if (list.error) {
    const entry = resolveError({ status: null, message: list.error });
    const forbidden = /\b403\b/.test(list.error) || entry.status === 403;
    return (
      <StatusScreen
        tone="error"
        title={forbidden ? "접근 권한이 없습니다" : entry.title}
        detail={forbidden ? "시스템 로그는 관리자(admin)만 조회할 수 있습니다." : entry.detail}
        code={list.error}
        source={entry.source}
        actions={
          forbidden
            ? [{ label: "생산 현황으로", href: "/dashboard/production", primary: true }]
            : [{ label: "다시 시도", onClick: list.refetch, primary: true }]
        }
      />
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* [A] 헤더 */}
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: T.text, margin: 0 }}>시스템 로그</h1>
        <p style={{ fontSize: 12.5, color: T.textSub, margin: "4px 0 0" }}>
          사용자 접속 · 데이터 변경 · ML 예측 호출 이력 (FR-SY-02 · 관리자 전용)
        </p>
      </div>

      {/* [B] 요약 */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
        <KpiCard label="조회 건수" value={list.loading ? "—" : total.toLocaleString("ko-KR")} unit="건" />
        <KpiCard
          label="로그인"
          value={loginCount.loading ? "—" : (loginCount.data?.total ?? 0).toLocaleString("ko-KR")}
          unit="건"
        />
        <KpiCard
          label="데이터 변경"
          value={changeTotal === null ? "—" : changeTotal.toLocaleString("ko-KR")}
          unit="건"
        />
        <KpiCard
          label="ML 예측"
          value={predictCount.loading ? "—" : (predictCount.data?.total ?? 0).toLocaleString("ko-KR")}
          unit="건"
        />
      </div>
      {(loginCount.error || createCount.error || predictCount.error) && (
        <ErrorAlert
          message={`요약 집계를 불러오지 못했습니다 — ${loginCount.error ?? createCount.error ?? predictCount.error}`}
        />
      )}

      {/* [C] 필터 */}
      <div className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", gap: 14, alignItems: "flex-end", flexWrap: "wrap" }}>
          <PillFilter
            options={ACTION_OPTIONS}
            value={action}
            onChange={(v) => {
              setAction(v);
              setPage(1);
            }}
            label="액션:"
          />
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={labelStyle}>사용자</span>
            <select
              value={userId}
              onChange={(e) => {
                setUserId(e.target.value);
                setPage(1);
              }}
              style={{ ...inputStyle, width: 160 }}
            >
              <option value="all">전체</option>
              {(users.data?.items ?? []).map((u) => (
                <option key={u.id} value={String(u.id)}>
                  {u.username}
                </option>
              ))}
            </select>
            {users.error && <span style={fieldErrorStyle}>사용자 목록: {users.error}</span>}
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={labelStyle}>기간 시작</span>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => {
                setDateFrom(e.target.value);
                setPage(1);
              }}
              style={inputStyle}
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={labelStyle}>기간 종료</span>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => {
                setDateTo(e.target.value);
                setPage(1);
              }}
              style={inputStyle}
            />
          </label>
          <button type="button" className="btn" onClick={resetFilters}>
            필터 초기화
          </button>
        </div>

        {rangeError && (
          <div role="alert" style={{ fontSize: 12, color: T.error }}>
            {rangeError} — 조회를 실행하지 않았습니다
          </div>
        )}

        {/* 고정 각주 — 기록되지 않는 것을 화면이 먼저 말한다 */}
        <p style={{ fontSize: 11, color: T.textMuted, margin: 0 }}>
          ※ 조회(GET) 이력과 실패한 요청은 기록되지 않습니다. 보관 기간 1년.
        </p>
      </div>

      {/* [D] 표 */}
      {rangeError ? null : rows.length === 0 ? (
        <StatusScreen
          tone="empty"
          title="선택한 조건의 로그가 없습니다"
          detail="조회(GET)와 실패한 요청은 애초에 기록되지 않습니다."
          actions={[{ label: "필터 초기화", onClick: resetFilters, primary: true }]}
        />
      ) : (
        <div style={tableWrapStyle}>
          <table style={tableStyle}>
            <thead>
              <tr style={{ background: T.surfaceSubtle }}>
                <th style={thStyle}>시각</th>
                <th style={thStyle}>사용자</th>
                <th style={thStyle}>액션</th>
                <th style={thStyle}>대상 테이블</th>
                <th style={{ ...thStyle, textAlign: "right" }}>대상 ID</th>
                <th style={thStyle}>IP 주소</th>
                <th style={{ ...thStyle, textAlign: "right" }}>상세</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((log) => {
                const route = log.target_table ? TARGET_ROUTES[log.target_table] : undefined;
                return (
                  <tr key={log.id} style={{ borderBottom: `1px solid ${T.border}` }}>
                    <td style={tdStyle}>{dt(log.created_at)}</td>
                    {/* null = 시스템/미인증 */}
                    <td style={tdStyle}>{log.username ?? "시스템"}</td>
                    <td style={tdStyle}>
                      <StatusBadge
                        variant={ACTION_VARIANT[log.action]}
                        label={AUDIT_ACTION_LABELS[log.action]}
                      />
                    </td>
                    <td style={tdStyle}>{log.target_table ?? "—"}</td>
                    <td style={{ ...tdStyle, textAlign: "right" }}>
                      {log.target_id === null ? (
                        "—"
                      ) : route ? (
                        <Link href={route}>{log.target_id}</Link>
                      ) : (
                        log.target_id
                      )}
                    </td>
                    {/* INET 은 null 일 수 있다. 0.0.0.0 같은 값으로 채우지 않는다 */}
                    <td style={tdStyle}>{log.ip_address ?? "—"}</td>
                    <td style={{ ...tdStyle, textAlign: "right" }}>
                      <button
                        type="button"
                        className="btn"
                        disabled={log.detail === null}
                        title={log.detail === null ? "상세 정보가 없습니다" : undefined}
                        onClick={() => setDetail(log)}
                      >
                        상세
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {!rangeError && total > PAGE_SIZE && (
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, alignItems: "center" }}>
          <span style={{ fontSize: 12, color: T.textSub }}>
            총 {total.toLocaleString("ko-KR")}건 · {page} / {maxPage}
          </span>
          <button type="button" className="btn" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            이전
          </button>
          <button type="button" className="btn" disabled={page >= maxPage} onClick={() => setPage((p) => p + 1)}>
            다음
          </button>
        </div>
      )}

      {/* [E] 상세 모달 */}
      <DetailModal log={detail} onClose={() => setDetail(null)} />
    </div>
  );
}

// ─── [E] 상세 ─────────────────────────────────────────────────────────────────

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function DetailModal({ log, onClose }: { log: AuditLogDto | null; onClose: () => void }) {
  const detail = log?.detail ?? null;
  const before = detail && isRecord(detail.before) ? detail.before : null;
  const after = detail && isRecord(detail.after) ? detail.after : null;
  const hasDiff = before !== null || after !== null;

  // before/after 가 아닌 나머지 키 (PREDICT 등 액션별로 스키마가 다르다)
  const otherKeys = detail
    ? Object.keys(detail).filter((k) => k !== "before" && k !== "after")
    : [];

  const diffKeys = hasDiff
    ? [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])]
    : [];

  return (
    <Modal
      open={log !== null}
      onClose={onClose}
      title="로그 상세"
      description={
        log ? `${dt(log.created_at)} · ${log.username ?? "시스템"} · ${AUDIT_ACTION_LABELS[log.action]}` : undefined
      }
      width={620}
      footer={
        <button type="button" className="btn" onClick={onClose}>
          닫기
        </button>
      }
    >
      {log === null ? null : detail === null ? (
        <p style={{ fontSize: 12.5, color: T.textMuted, margin: 0 }}>
          {log.action === "LOGIN" ? "로그인 성공" : "상세 정보가 없습니다"}
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {hasDiff && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: T.text, marginBottom: 8 }}>
                변경 전 / 변경 후
              </div>
              <table style={tableStyle}>
                <thead>
                  <tr style={{ background: T.surfaceSubtle }}>
                    <th style={thStyle}>항목</th>
                    <th style={{ ...thStyle, textAlign: "right" }}>변경 전</th>
                    <th style={{ ...thStyle, textAlign: "right" }}>변경 후</th>
                  </tr>
                </thead>
                <tbody>
                  {diffKeys.map((k) => {
                    const b = before?.[k];
                    const a = after?.[k];
                    const changed = JSON.stringify(b) !== JSON.stringify(a);
                    return (
                      <tr key={k} style={{ borderBottom: `1px solid ${T.border}` }}>
                        <td style={{ ...tdStyle, color: changed ? T.text : T.textMuted, fontWeight: changed ? 700 : 400 }}>
                          {k}
                        </td>
                        <td style={{ ...tdStyle, textAlign: "right", color: changed ? T.text : T.textMuted }}>
                          {before === null ? "" : render(b)}
                        </td>
                        <td
                          style={{
                            ...tdStyle,
                            textAlign: "right",
                            color: changed ? T.primary : T.textMuted,
                            fontWeight: changed ? 700 : 400,
                          }}
                        >
                          {after === null ? "" : render(a)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {otherKeys.length > 0 && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: T.text, marginBottom: 8 }}>기타 항목</div>
              {/* 액션별로 스키마가 달라 구조를 가정하지 않는다 — 키-값으로 그린다 */}
              <dl style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 8, margin: 0, fontSize: 12.5 }}>
                {otherKeys.map((k) => (
                  <div key={k} style={{ display: "contents" }}>
                    <dt style={{ color: T.textSub, fontWeight: 600 }}>{k}</dt>
                    <dd style={{ margin: 0, color: T.text, wordBreak: "break-all" }}>{render(detail[k])}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

function render(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
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
