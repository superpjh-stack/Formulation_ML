"use client";

/**
 * FE-RT-45 — KPI 설정 · `/kpi/manage` · FR-K-03 (필수)
 *
 * 명세: `specs/plan-g3.md` FE-RT-45. 와이어프레임 없음(SF-TD3 §3).
 * SF-AD3 기능대비표: *"수율·품질 KPI 목표값 관리"* → **관리 대상이 한정된다.
 * 임의의 KPI 를 추가하는 화면이 아니다.**
 * 저장 테이블: `kpi_targets` — CR-DB-001 승인·생성 완료. **501 아님.**
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * 라운드 2 에서 고친 것:
 *   - 하드코딩 목표 **12건** 삭제 → `GET /api/v1/kpi/targets?period=` 실 연동,
 *     **`kpi_key` 6종 고정**
 *   - 12개 중 **6개가 계약 밖 지표**였다 — 설비 가동률·생산 효율·예방정비 준수율·
 *     계획외 정지 횟수·납기 준수율·출하 리드타임·1일 생산량.
 *     **DB 에 근거 컬럼이 하나도 없다.** 전부 제거
 *   - 저장이 **로컬 state 만 변경**하던 것 — 저장되는 것처럼 보이지만 새로고침하면
 *     되돌아갔다 → `PUT /api/v1/kpi/targets` 실제 저장
 *   - **기간(`period`) 선택 신설** — 계약의 필수 키인데 화면에서 지정할 수 없었다
 *   - `category`·`owner`·`frequency`·`active` 4필드 제거 (계약·DB 모두 없음)
 *   - `+ KPI 추가` 버튼과 활성 토글 제거 (POST·DELETE 도 `active` 컬럼도 없다)
 *   - 권한 분기 신설 — `PUT /kpi/targets` 는 **`admin`·`sales` W** 다
 *     (§3.2 의 `sales` 정의 *"출하·클레임·KPI 읽기+쓰기"* 와 일치)
 *
 * ✅ **계약 확장 #6 이 반영됐다.** `direction`·`achieved` 가 서버 응답에 있다.
 *    **프론트가 `kpi_key` 6종의 판정 방향을 하드코딩하지 않는다** —
 *    불량률·클레임률만 낮을수록 좋다는 규칙이 서버에서 온다.
 *
 * 🔴 **실적값의 단일 출처는 실시간 집계다** (§14-c 권고 · api-contract §9.2 수용).
 *    `actual_value` 를 그대로 쓴다 — 서버가 `lots`/`quality`/`claims` 집계로 채운다.
 *    (별도의 월 마감 스냅샷 필드가 응답에 함께 오지만 화면 표시 출처가 아니다.
 *     같은 지표에 두 숫자를 섞으면 목표 달성 여부가 화면마다 달라진다.)
 *
 * 🔴 **빈 목표값은 그 행을 아예 보내지 않는다.** `target_value` 는 NOT NULL 이고
 *    **0 은 유효한 목표값**이라 빈칸을 0 으로 보내면 안 된다 (§6 · 수용 기준 6).
 * ══════════════════════════════════════════════════════════════════════════════
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { getKpiTargets, putKpiTargets } from "@/lib/koryo-api";
import {
  KPI_DECIMALS,
  KPI_LABELS,
  KPI_UNITS,
  type KpiKey,
  type KpiTargetDto,
  type KpiTargetIn,
} from "@/types/api";
import { T } from "@/components/ui/tokens";
import {
  Field,
  InlineError,
  PageHeader,
  PageShell,
  Section,
  Select,
  dateTime,
  hasRole,
  num,
  useRole,
} from "../../_g1/ui";
import { FieldError, Notice, errText, recentMonths, thisMonth, useApi } from "../../_g3/ui";

/** `kpi_key` 는 **고정 6종**이다 (db-schema §6.10). 추가·삭제 UI 가 없는 이유다 */
const KPI_KEYS: KpiKey[] = [
  "yield_pct",
  "production_volume",
  "defect_rate",
  "quality_avg",
  "pass_rate",
  "claim_rate",
];

const RATE_KEYS = new Set<KpiKey>(["yield_pct", "defect_rate", "pass_rate", "claim_rate"]);

/** §6 검증 — `target_value DECIMAL(10,3)`: 정수부 최대 7자리, 소수 최대 3자리 */
function validateTarget(key: KpiKey, raw: string): string | null {
  const s = raw.trim();
  if (s === "") return null; // 빈칸은 "목표 없음" 이다 — 오류가 아니다
  const v = Number(s);
  if (!Number.isFinite(v)) return "숫자를 입력하세요";
  if (v < 0) return "음수는 입력할 수 없습니다";

  const decimals = (s.split(".")[1] ?? "").length;
  if (decimals > 3) return "소수는 최대 3자리입니다";
  if (Math.trunc(Math.abs(v)).toString().length > 7) return "정수부는 최대 7자리입니다";

  if (RATE_KEYS.has(key) && v > 100) return "0.0 ~ 100.0 (%) 범위입니다";
  if (key === "quality_avg" && v > 100) return "0.00 ~ 100.00 (점) 범위입니다";
  if (key === "production_volume" && !Number.isInteger(v)) return "정수(LOT 수)여야 합니다";

  return null;
}

export default function KpiManagePage() {
  const role = useRole();
  /** api-contract §8.11 — `PUT /kpi/targets` 는 `admin`·`sales` W 다 */
  const canWrite = hasRole(role, "admin", "sales");

  const [period, setPeriod] = useState(thisMonth());
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "warn" | "error"; text: string } | null>(
    null
  );

  const state = useApi(() => getKpiTargets(period), [period]);

  /** 응답을 `kpi_key` 로 인덱싱. 서버가 6행을 다 주지만 없어도 6행을 그린다 */
  const byKey = useMemo(() => {
    const m = new Map<KpiKey, KpiTargetDto>();
    for (const r of state.data ?? []) m.set(r.kpi_key, r);
    return m;
  }, [state.data]);

  // 서버 값이 바뀌면 편집 버퍼를 초기화한다
  useEffect(() => {
    if (!state.data) return;
    const next: Record<string, string> = {};
    for (const k of KPI_KEYS) {
      const v = byKey.get(k)?.target_value;
      next[k] = v === null || v === undefined ? "" : String(v);
    }
    setDrafts(next);
  }, [state.data, byKey]);

  // 안내 문구는 **기간이 바뀔 때만** 지운다.
  // 초판은 위 동기화 이펙트 안에서 지웠는데, 저장 직후 `state.refetch()` 가
  // 새 데이터를 물어오면 그 이펙트가 다시 돌면서 **"저장되었습니다" 를 즉시 지웠다.**
  // PUT 은 정상 전송되는데 사용자에게는 아무 반응이 없어 보였다 (QA-C DEF-C-03).
  useEffect(() => {
    setNotice(null);
  }, [period]);

  const errors = useMemo(() => {
    const out: Record<string, string | null> = {};
    for (const k of KPI_KEYS) out[k] = validateTarget(k, drafts[k] ?? "");
    return out;
  }, [drafts]);

  const hasErrors = Object.values(errors).some((e) => e !== null);

  const dirty = useMemo(() => {
    for (const k of KPI_KEYS) {
      const server = byKey.get(k)?.target_value;
      const serverStr = server === null || server === undefined ? "" : String(server);
      if ((drafts[k] ?? "") !== serverStr) return true;
    }
    return false;
  }, [drafts, byKey]);

  const save = useCallback(async () => {
    if (!canWrite || hasErrors || saving) return;
    setSaving(true);
    setNotice(null);
    try {
      // 🔴 빈칸인 행은 **아예 보내지 않는다.** 0 으로 치환하지 않는다
      const payload: KpiTargetIn[] = KPI_KEYS.flatMap((k) => {
        const raw = (drafts[k] ?? "").trim();
        if (raw === "") return [];
        return [{ kpi_key: k, period, target_value: Number(raw) }];
      });
      await putKpiTargets(payload);
      setNotice({ tone: "ok", text: "저장되었습니다." });
      state.refetch(); // 낙관적 갱신 금지 — 응답으로 표를 갈아끼운다
    } catch (err) {
      const msg = errText(err);
      setNotice({
        tone: "error",
        text: /409/.test(msg) ? "해당 월에 이미 저장된 항목입니다." : msg,
      });
    } finally {
      setSaving(false);
    }
  }, [canWrite, hasErrors, saving, drafts, period, state]);

  const monthOptions = useMemo(
    () => recentMonths(24).map((m) => ({ value: m, label: m })),
    []
  );

  /** 실적 집계 시각 — 응답에 값이 있을 때만 표시한다. 없으면 줄 자체를 그리지 않는다 */
  const aggregatedAt = useMemo(() => {
    for (const k of KPI_KEYS) {
      const t = byKey.get(k)?.actual_updated_at;
      if (t) return t;
    }
    return null;
  }, [byKey]);

  return (
    <PageShell>
      <PageHeader
        title="KPI 설정"
        subtitle="KPI 목표값 설정 및 달성 현황"
        actions={
          <div style={{ display: "flex", alignItems: "flex-end", gap: 10 }}>
            <Field label="기간" htmlFor="kt-period" width={140}>
              <Select
                id="kt-period"
                value={period}
                onChange={setPeriod}
                options={monthOptions}
                width={140}
              />
            </Field>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!canWrite || !dirty || hasErrors || saving}
              title={canWrite ? undefined : "저장 권한이 없습니다 (admin·sales)"}
              onClick={() => void save()}
              style={{ height: 34 }}
            >
              {saving ? "저장 중…" : "저장"}
            </button>
          </div>
        }
      />

      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
      {dirty && !saving && !notice && <Notice tone="warn">저장되지 않은 변경이 있습니다.</Notice>}

      {state.error && <InlineError message={state.error} onRetry={state.refetch} />}

      <Section title={`${period} 목표값`}>
        {aggregatedAt && (
          <span style={{ fontSize: 11.5, color: T.textMuted }}>
            실적 집계 기준: {dateTime(aggregatedAt)}
          </span>
        )}

        <div style={{ overflowX: "auto", border: `1px solid ${T.border}`, borderRadius: 12 }}>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: 12.5,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            <thead>
              <tr style={{ background: "#F8F9FB" }}>
                <Th>KPI 항목</Th>
                <Th right>목표값</Th>
                <Th right>실적값</Th>
                <Th center>달성</Th>
                <Th>방향</Th>
              </tr>
            </thead>
            <tbody>
              {/*
                🔴 해당 월에 행이 없어도 **6행을 빈칸으로 표시**한다.
                `kpi_key` 가 고정 집합이므로 "데이터 없음"이 아니다 (§9).
              */}
              {KPI_KEYS.map((k) => {
                const row = byKey.get(k);
                const err = errors[k];
                return (
                  <tr key={k} style={{ borderTop: `1px solid ${T.border}` }}>
                    <Td>
                      {KPI_LABELS[k]}
                      <span style={{ color: T.textMuted, marginLeft: 4 }}>({KPI_UNITS[k]})</span>
                    </Td>
                    <Td right>
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "flex-end",
                          gap: 3,
                        }}
                      >
                        <input
                          type="number"
                          step={k === "production_volume" ? "1" : "0.001"}
                          value={drafts[k] ?? ""}
                          readOnly={!canWrite}
                          disabled={state.loading}
                          placeholder="—"
                          onChange={(e) =>
                            setDrafts((d) => ({ ...d, [k]: e.target.value }))
                          }
                          style={{
                            height: 30,
                            width: 120,
                            padding: "0 8px",
                            textAlign: "right",
                            borderRadius: 6,
                            border: `1px solid ${err ? T.error : T.border}`,
                            background: canWrite ? T.surface : T.surfaceSubtle,
                            fontSize: 12.5,
                            fontFamily: "inherit",
                            color: T.text,
                          }}
                        />
                        <FieldError message={err} />
                      </div>
                    </Td>
                    {/* 실적값 — 실시간 집계 단일 출처. `null` 이면 `—` */}
                    <Td right>
                      {state.loading ? "…" : num(row?.actual_value ?? null, KPI_DECIMALS[k])}
                    </Td>
                    {/* 달성 판정도 **서버 값**이다 */}
                    <Td center>
                      {row?.achieved === null || row?.achieved === undefined ? (
                        <span style={{ color: T.textMuted }}>—</span>
                      ) : (
                        <strong style={{ color: row.achieved ? T.success : T.error }}>
                          {row.achieved ? "✔" : "✖"}
                        </strong>
                      )}
                    </Td>
                    {/* 🔴 방향도 **서버가 준다.** 프론트가 지표별로 하드코딩하지 않는다 */}
                    <Td>
                      <span style={{ color: T.textSub }}>
                        {row?.direction === "lower_better"
                          ? "낮을수록 좋음"
                          : row?.direction === "higher_better"
                            ? "높을수록 좋음"
                            : "—"}
                      </span>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <span style={{ fontSize: 11, color: T.textMuted, lineHeight: 1.6 }}>
          ⓘ KPI 항목은 6종 고정이라 추가·삭제할 수 없습니다. 목표값을 비우고 저장하면 그 항목은
          전송되지 않습니다 (0 은 유효한 목표값이라 빈칸과 구분합니다). 달성 여부와 판정 방향은
          서버가 내려준 값이며 화면에서 계산하지 않습니다. 실적값은 실시간 집계 기준이라 생산·품질
          KPI 화면과 같은 숫자를 보여줍니다.
        </span>
      </Section>
    </PageShell>
  );
}

function Th({
  children,
  right,
  center,
}: {
  children: React.ReactNode;
  right?: boolean;
  center?: boolean;
}) {
  return (
    <th
      style={{
        padding: "10px 12px",
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
  right,
  center,
}: {
  children: React.ReactNode;
  right?: boolean;
  center?: boolean;
}) {
  return (
    <td
      style={{
        padding: "9px 12px",
        color: T.text,
        textAlign: right ? "right" : center ? "center" : "left",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </td>
  );
}
