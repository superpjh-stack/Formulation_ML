"use client";

/**
 * FE-RT-33 — 데이터 연동 · `/data/integrate` · FR-DT-01 (필수)
 *
 * 명세: `specs/plan-g3.md` FE-RT-33. 와이어프레임 없음(SF-TD3 §3).
 * 저장 테이블: `system_settings` (`key='integration.erp.*'`/`'integration.xrf.*'`).
 * **501 아님.** 단 §13 의 한계가 있다 — 아래 참조.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * 🔴 **설정(configuration)은 담을 수 있으나 런타임 상태(state)는 담을 수 없다** (§13).
 *
 *   | 필드 | 성격 | `system_settings` 저장 |
 *   |---|---|---|
 *   | `system`/`type`/`endpoint`/`enabled` | 설정 | ✅ |
 *   | `last_sync_at` | 런타임 상태 | ❌ **항상 `null`** → "동기화 이력 없음" |
 *   | `status` | 런타임 상태 | ❌ `enabled` 에서 **2값 파생** (사용중/미사용) |
 *
 *   FR-DT-01 문장은 *"외부 시스템 데이터 연동 **설정**"* 이다. **설정까지가 요구사항**이고
 *   동기화 실행·상태 추적은 요구사항 문장에 없다 → v1 게이트는 통과한다.
 *   **`last_sync_at` 을 0 이나 임의 시각으로 채우지 마라.**
 *
 * 라운드 2 에서 지운 것:
 *   - 하드코딩 소스 6건 — **MES·SCADA·OPC-UA·ODBC·레거시DB 는 SF-AD1~TD5 어디에도
 *     나오지 않는다. 발명된 값이다.** 산출물이 명시한 연동 대상은 **ERP·XRF 2종**뿐이다
 *   - 가짜 2초 지연 동기화 트리거 → **수동 동기화 버튼 제거** (동기화 트리거
 *     엔드포인트가 계약에 없다)
 *   - 동기화 로그 패널 7건 하드코딩 → **패널 제거** (로그 조회 엔드포인트 없음)
 *   - 오류 배너의 `"레거시 DB"` 문자열 하드코딩 → 서버 `status`/`message` 기반
 *   - `recordCount`·`syncInterval` 표시 (계약 응답 필드 없음)
 *   - 상태 4값(연결됨/오류/동기화중/비활성) → **`enabled` 파생 2값**
 *   - 권한 분기 신설 — `GET` 조차 **`admin` 전용**이다. 비관리자에게 소스 카드를
 *     **1장도 렌더링하지 않는다** (엔드포인트 URL 노출 방지 — §9 · 수용 기준 1)
 * ══════════════════════════════════════════════════════════════════════════════
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { getIntegrations, putIntegrations, testIntegration } from "@/lib/koryo-api";
import {
  INTEGRATION_STATUS_LABELS,
  type IntegrationDto,
  type IntegrationSystem,
} from "@/types/api";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { T } from "@/components/ui/tokens";
import {
  InlineError,
  PageHeader,
  PageShell,
  ScreenError,
  Section,
  hasRole,
  useRole,
} from "../../_g1/ui";
import { Callout, FieldError, Notice, errText, useApi } from "../../_g3/ui";

const SYSTEM_LABELS: Record<IntegrationSystem, string> = {
  erp: "ERP",
  xrf: "XRF 분석기",
};

interface TestState {
  running: boolean;
  ok: boolean | null;
  message: string;
  latencyMs: number | null;
}

/** §6 — 1~500자, `http://`·`https://` 로 시작. `system_settings.value` 는 VARCHAR(255) 다 */
function validateEndpoint(v: string): string | null {
  const s = v.trim();
  if (s === "") return null; // 비활성 상태에서는 빈 값을 허용한다
  if (s.length > 255) return "엔드포인트는 255자를 넘을 수 없습니다 (system_settings.value 상한)";
  if (!/^https?:\/\//.test(s)) return "http:// 또는 https:// 로 시작해야 합니다";
  return null;
}

export default function DataIntegratePage() {
  const role = useRole();
  /** api-contract §8.9 — `GET` 조차 `admin R` 이다. `viewer` 전 GET R 규칙의 예외군 */
  const isAdmin = hasRole(role, "admin");

  const state = useApi(() => getIntegrations(), [], isAdmin);

  /** 편집 버퍼 — `PUT` 이 배열 전체 교체라 편집분을 모아 한 번에 보낸다 (§4) */
  const [draft, setDraft] = useState<IntegrationDto[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [tests, setTests] = useState<Record<string, TestState>>({});

  useEffect(() => {
    if (state.data) setDraft(state.data.map((d) => ({ ...d })));
  }, [state.data]);

  const dirty = useMemo(() => {
    if (!draft || !state.data) return false;
    return JSON.stringify(draft) !== JSON.stringify(state.data);
  }, [draft, state.data]);

  const endpointErrors = useMemo(() => {
    const out: Record<string, string | null> = {};
    for (const d of draft ?? []) out[d.system] = validateEndpoint(d.endpoint);
    return out;
  }, [draft]);

  const hasErrors = Object.values(endpointErrors).some((e) => e !== null);

  const patch = (system: string, next: Partial<IntegrationDto>) =>
    setDraft((prev) =>
      prev ? prev.map((d) => (d.system === system ? { ...d, ...next } : d)) : prev
    );

  const save = useCallback(async () => {
    if (!draft || draft.length === 0 || hasErrors) return;
    setSaving(true);
    setNotice(null);
    try {
      // 🔴 낙관적 갱신 금지 — 응답 배열로 목록을 갈아끼운다 (§4)
      await putIntegrations(draft);
      setNotice({ tone: "ok", text: "저장되었습니다." });
      state.refetch();
    } catch (err) {
      setNotice({ tone: "error", text: errText(err) });
    } finally {
      setSaving(false);
    }
  }, [draft, hasErrors, state]);

  const runTest = useCallback(async (system: IntegrationSystem) => {
    setTests((t) => ({
      ...t,
      [system]: { running: true, ok: null, message: "", latencyMs: null },
    }));
    try {
      const res = await testIntegration(system);
      setTests((t) => ({
        ...t,
        [system]: {
          running: false,
          ok: res.ok,
          // 🔴 서버가 준 `message` 를 **그대로** 쓴다. 프론트가 문구를 지어내지 않는다
          message: res.message,
          latencyMs: res.latency_ms,
        },
      }));
    } catch (err) {
      setTests((t) => ({
        ...t,
        [system]: { running: false, ok: false, message: errText(err), latencyMs: null },
      }));
    }
  }, []);

  // ── 권한 차단 — 목록을 보여주면 안 된다 (엔드포인트 URL 노출) ──────────────
  if (role !== null && !isAdmin) {
    return (
      <PageShell>
        <PageHeader title="데이터 연동" subtitle="외부 시스템 연동 설정 및 상태" />
        <ScreenError message="접근 권한이 없습니다" />
      </PageShell>
    );
  }

  if (state.status === 403) {
    return (
      <PageShell>
        <PageHeader title="데이터 연동" subtitle="외부 시스템 연동 설정 및 상태" />
        <ScreenError message="접근 권한이 없습니다" />
      </PageShell>
    );
  }

  const list = draft ?? [];
  const enabledCount = list.filter((d) => d.enabled).length;

  return (
    <PageShell>
      <PageHeader
        title="데이터 연동"
        subtitle="외부 시스템 연동 설정 및 상태"
        actions={
          <button
            type="button"
            className="btn btn-primary"
            disabled={!dirty || saving || hasErrors || list.length === 0}
            onClick={() => void save()}
          >
            {saving ? "저장 중…" : "저장"}
          </button>
        }
      />

      {notice && <Notice tone={notice.tone === "ok" ? "ok" : "error"}>{notice.text}</Notice>}
      {dirty && !saving && <Notice tone="warn">저장되지 않은 변경이 있습니다.</Notice>}

      {state.error && <InlineError message={state.error} onRetry={state.refetch} />}

      {/*
        연결 테스트의 성격을 화면에 명시한다 — 위장 금지.
        서버는 설정값(사용 여부·엔드포인트 형식)을 검증할 뿐 **실제 소켓을 열지 않는다.**
      */}
      <Callout>
        <strong>연결 테스트는 설정 검증까지만 수행합니다.</strong> 외부 시스템에 실제로
        접속하지 않으며, 성공 응답이 곧 연결 성립을 뜻하지 않습니다.
        <br />
        <span style={{ fontSize: 11.5, color: T.textMuted }}>
          동기화 실행·상태 추적은 v1 범위 밖입니다 (`last_sync_at`·`status` 를 저장할 컬럼이
          없어 CR-DB-002 후보로 등재).
        </span>
      </Callout>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
        <SummaryCard label="연동 소스" value={state.loading || state.error ? "—" : String(list.length)} />
        <SummaryCard label="사용중" value={state.loading || state.error ? "—" : String(enabledCount)} />
        <SummaryCard
          label="미사용"
          value={state.loading || state.error ? "—" : String(list.length - enabledCount)}
        />
        {/* `last_sync_at` 은 v1 에서 항상 `null` 이다 */}
        <SummaryCard label="마지막 동기화" value="동기화 이력 없음" small />
      </div>

      <Section title="연동 소스">
        {state.loading && <Center>불러오는 중…</Center>}
        {!state.loading && !state.error && list.length === 0 && (
          <Center>연동 설정이 없습니다.</Center>
        )}

        {!state.loading && list.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {list.map((d) => {
              const t = tests[d.system];
              const epError = endpointErrors[d.system];
              return (
                <div
                  key={d.system}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 10,
                    padding: "14px 16px",
                    borderRadius: 10,
                    border: `1px solid ${T.border}`,
                    background: T.surface,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <strong style={{ fontSize: 13, fontWeight: 600, color: T.text }}>
                      {SYSTEM_LABELS[d.system] ?? d.system}
                    </strong>
                    <span style={{ fontSize: 11.5, color: T.textMuted }}>{d.type}</span>
                    <div style={{ flex: 1 }} />
                    <StatusBadge
                      variant={d.enabled ? "green" : "gray"}
                      label={INTEGRATION_STATUS_LABELS[d.enabled ? "in_use" : "not_in_use"]}
                    />
                  </div>

                  <div style={{ display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 5, flex: 1, minWidth: 320 }}>
                      <label
                        htmlFor={`ep-${d.system}`}
                        style={{ fontSize: 12, fontWeight: 600, color: T.textSub }}
                      >
                        엔드포인트
                      </label>
                      <input
                        id={`ep-${d.system}`}
                        type="text"
                        value={d.endpoint}
                        maxLength={255}
                        placeholder="https://erp.internal/api"
                        onChange={(e) => patch(d.system, { endpoint: e.target.value })}
                        style={{
                          height: 34,
                          width: "100%",
                          padding: "0 10px",
                          borderRadius: 8,
                          border: `1px solid ${epError ? T.error : T.border}`,
                          fontSize: 12.5,
                          fontFamily: "inherit",
                          color: T.text,
                        }}
                      />
                      <FieldError message={epError} />
                    </div>

                    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: T.textSub }}>
                        사용 여부
                      </span>
                      <label
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                          height: 34,
                          fontSize: 12.5,
                          color: T.text,
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={d.enabled}
                          onChange={(e) => patch(d.system, { enabled: e.target.checked })}
                        />
                        사용
                      </label>
                    </div>

                    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: T.textSub }}>
                        마지막 동기화
                      </span>
                      <span style={{ height: 34, lineHeight: "34px", fontSize: 12.5, color: T.textMuted }}>
                        동기화 이력 없음
                      </span>
                    </div>

                    <button
                      type="button"
                      className="btn"
                      disabled={t?.running}
                      onClick={() => void runTest(d.system)}
                      style={{ height: 34, alignSelf: "flex-end" }}
                    >
                      {t?.running ? "확인 중…" : "연결 테스트"}
                    </button>
                  </div>

                  {t && !t.running && t.ok !== null && (
                    <div
                      style={{
                        fontSize: 12,
                        lineHeight: 1.6,
                        color: t.ok ? "#15803D" : "#B42318",
                      }}
                    >
                      {t.ok ? "✔ 설정 검증 통과" : "✖ 설정 검증 실패"}
                      {t.latencyMs !== null && ` (${Math.round(t.latencyMs)} ms)`} — {t.message}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Section>
    </PageShell>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        minHeight: 160,
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

function SummaryCard({
  label,
  value,
  small,
}: {
  label: string;
  value: string;
  small?: boolean;
}) {
  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ fontSize: 12, fontWeight: 600, color: T.textSub }}>{label}</span>
      <strong
        style={{
          fontSize: small ? 14 : 28,
          fontWeight: small ? 500 : 700,
          color: small ? T.textMuted : T.text,
          lineHeight: 1.4,
        }}
      >
        {value}
      </strong>
    </div>
  );
}
