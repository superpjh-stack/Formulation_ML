"use client";

/**
 * FE-RT-17 · `/shipping/lot` · LOT 관리 (FR-S-02)
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * 🔴 삭제한 것
 *   - `MOCK_LOTS` 5건 → `GET /api/v1/lots` · `GET /api/v1/lots/{lot_id}`
 *   - `getTimeline()` — LOT ID 문자열을 비교해 분기하던 완전 하드코딩
 *   - `getComponents()` — 목표 `96.5`/`63.0`, 허용오차 `±0.3`/`±0.5` 는
 *     **산출물 어디에도 없는 수치**였다. 편차는 서버 저장값을 그대로 쓴다
 *   - `product` · `qty` · 고객사 열 — `lots` 테이블에 그런 컬럼이 없다
 *   - 상태 4종(`출하완료`/`검사중`/`배합완료`/`입고완료`) — DB 에 저장 불가한 값이다
 *   - 클라이언트 `Array.filter` 검색 — 현재 페이지 50건 안에서만 찾아서
 *     사용자가 "없다"는 **잘못된 결론**을 얻었다. 서버 쿼리로 옮겼다
 *
 * 🚨 **합격 배지에 `getQualityBadgeVariant()` 를 쓰지 않는다.** 그 함수의 임계값 집합은
 *   `{90,75,60}` 이라 **69.99 와 70.00 이 같은 색**으로 렌더된다. 합격 판정은
 *   `lib/quality.ts` 로만 한다 — 서버 `passed` 우선, 없으면 `quality_pass_score` 직접 비교.
 *   합격선 숫자는 `usePublicSettings()` 에서 읽고 소스에 쓰지 않는다.
 *
 * ⚠ 타임라인은 `LotDetailDto` 로 **재구성 가능한 4단계만** 그린다.
 *   `원자재입고`(= `receipts` 에 `lot_id` FK 가 없다)·`포장`(= 기록 테이블 자체가 없다)은
 *   회색 "대기"로 위장하지 않고 **아예 표시하지 않는다.** 데이터 없음과 미완료는 다르다.
 * ══════════════════════════════════════════════════════════════════════════════
 */

import { useEffect, useMemo, useState } from "react";
import * as api from "@/lib/koryo-api";
import { useLots, usePublicSettings } from "@/hooks/useKoryoData";
import { useRole } from "@/hooks/useRole";
import { resolveError } from "@/lib/error-contract";
import { isDeviationWarning, lotStatusBadge, passBadgeFromServer, passScoreOf, qualityPassBadge } from "@/lib/quality";
import { StatusScreen } from "@/components/layout/StatusScreen";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { ErrorAlert } from "@/components/ui/ErrorAlert";
import { PillFilter } from "@/components/ui/PillFilter";
import { Spinner } from "@/components/ui/Spinner";
import { T } from "@/components/ui/tokens";
import { SN_TARGET, AG_TARGET, CU_TARGET } from "@/types/api";
import type { LotDetailDto, LotDto, LotStatus, PublicSettingsDto, SupplierCode } from "@/types/api";

const PAGE_SIZE = 50;

const STATUS_OPTIONS: { value: "all" | LotStatus; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "pass", label: "합격" },
  { value: "warning", label: "경고" },
  { value: "fail", label: "불합격" },
  { value: "pending", label: "미검사" },
];

const SUPPLIER_OPTIONS: { value: "all" | SupplierCode; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "SUP_A", label: "SUP_A" },
  { value: "SUP_B", label: "SUP_B" },
  { value: "SUP_C", label: "SUP_C" },
];

/** `PATCH /lots/{id}/status` 를 쓸 수 있는 역할 (api-contract §3.2) */
const CAN_PATCH_STATUS = new Set(["admin", "manufacture", "quality"]);

const dt = (s: string) => s.replace("T", " ").slice(0, 19);
const nf = (v: number | null | undefined, d: number) =>
  v === null || v === undefined ? "—" : v.toFixed(d);

export default function LotManagePage() {
  const [status, setStatus] = useState<"all" | LotStatus>("all");
  const [supplier, setSupplier] = useState<"all" | SupplierCode>("all");
  const [search, setSearch] = useState("");
  const [applied, setApplied] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);

  const settings = usePublicSettings();
  const publicSettings: PublicSettingsDto | null = settings.data?.settings ?? null;
  const thresholdFallback = settings.data?.source === "fallback";

  const query = useMemo(
    () => ({
      page,
      page_size: PAGE_SIZE,
      ...(status !== "all" ? { status } : {}),
      ...(supplier !== "all" ? { supplier } : {}),
      // 서버 필터다. 클라이언트에서 거르면 현재 페이지 안에서만 검색된다
      ...(applied ? { lot_id: applied } : {}),
    }),
    [page, status, supplier, applied]
  );

  const list = useLots(query);
  const items = list.data?.items ?? [];
  const total = list.data?.total ?? 0;
  const maxPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function resetFilters() {
    setStatus("all");
    setSupplier("all");
    setSearch("");
    setApplied("");
    setPage(1);
    setSelected(null);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* [A] 헤더 + 필터 */}
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: T.text, margin: 0 }}>LOT 관리</h1>
        <p style={{ fontSize: 12.5, color: T.textSub, margin: "4px 0 0" }}>
          LOT 이력 · 품질 점수 · 출하 이력 연계 (FR-S-02)
        </p>
      </div>

      {thresholdFallback && (
        <div style={bannerStyle}>
          품질 합격 기준값을 서버에서 불러오지 못해 기본값({passScoreOf(publicSettings)}점)으로 표시하고
          있습니다. 개별 검사의 합격/불합격은 서버가 저장 시점에 판정한 값을 그대로 씁니다.
          {settings.data?.error ? ` (${settings.data.error})` : ""}
        </div>
      )}

      <div className="card" style={{ display: "flex", gap: 14, alignItems: "flex-end", flexWrap: "wrap" }}>
        <PillFilter
          options={STATUS_OPTIONS}
          value={status}
          onChange={(v) => {
            setStatus(v);
            setPage(1);
          }}
          label="상태:"
        />
        <PillFilter
          options={SUPPLIER_OPTIONS}
          value={supplier}
          onChange={(v) => {
            setSupplier(v);
            setPage(1);
          }}
          label="공급사:"
        />
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setApplied(search.trim());
            setPage(1);
          }}
          style={{ display: "flex", gap: 6, alignItems: "flex-end" }}
        >
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 11.5, fontWeight: 600, color: T.textSub }}>LOT 번호</span>
            <input
              type="text"
              value={search}
              placeholder="LOT-2026-"
              onChange={(e) => setSearch(e.target.value)}
              style={{ ...inputStyle, width: 160 }}
            />
          </label>
          <button type="submit" className="btn">
            검색
          </button>
          <button type="button" className="btn" onClick={resetFilters}>
            초기화
          </button>
        </form>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, alignItems: "start" }}>
        {/* [B] 목록 */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <div style={sectionTitle}>LOT 목록</div>
            <span style={{ fontSize: 12, color: T.textSub }}>
              {list.loading ? "조회 중" : `총 ${total.toLocaleString("ko-KR")}건`}
            </span>
          </div>

          {list.loading ? (
            <StatusScreen tone="loading" title="LOT 목록을 불러오는 중" />
          ) : list.error ? (
            <ErrorAlert message={`LOT 목록을 불러오지 못했습니다 — ${list.error}`} />
          ) : items.length === 0 ? (
            <StatusScreen
              tone="empty"
              title="조건에 맞는 LOT 이 없습니다"
              actions={[{ label: "필터 초기화", onClick: resetFilters, primary: true }]}
            />
          ) : (
            <LotTable
              rows={items}
              selected={selected}
              settings={publicSettings}
              onSelect={(id) => setSelected(id)}
            />
          )}

          {!list.loading && !list.error && total > PAGE_SIZE && (
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, alignItems: "center" }}>
              <span style={{ fontSize: 12, color: T.textSub }}>
                {page} / {maxPage}
              </span>
              <button type="button" className="btn" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                이전
              </button>
              <button type="button" className="btn" disabled={page >= maxPage} onClick={() => setPage((p) => p + 1)}>
                다음
              </button>
            </div>
          )}
        </div>

        {/* [C] 상세 */}
        <LotDetailPanel
          lotId={selected}
          settings={publicSettings}
          onStatusSaved={() => list.refetch()}
        />
      </div>
    </div>
  );
}

// ─── [B] 목록 표 ──────────────────────────────────────────────────────────────

function LotTable({
  rows,
  selected,
  settings,
  onSelect,
}: {
  rows: LotDto[];
  selected: string | null;
  settings: PublicSettingsDto | null;
  onSelect: (lotId: string) => void;
}) {
  return (
    <div style={tableWrapStyle}>
      <table style={tableStyle}>
        <thead>
          <tr style={{ background: T.surfaceSubtle }}>
            <th style={thStyle}>LOT번호</th>
            <th style={thStyle}>날짜</th>
            <th style={thStyle}>공급사</th>
            <th style={{ ...thStyle, textAlign: "right" }}>품질점수</th>
            <th style={thStyle}>합격</th>
            <th style={thStyle}>상태</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const isSel = r.lot_id === selected;
            const lotBadge = lotStatusBadge(r.status);
            // 🚨 합격 배지는 점수대 그러데이션이 아니라 **2색 이진 표시**다
            const pass = r.quality_score === null ? null : qualityPassBadge(r.quality_score, settings);
            return (
              <tr
                key={r.lot_id}
                onClick={() => onSelect(r.lot_id)}
                style={{
                  borderBottom: `1px solid ${T.border}`,
                  cursor: "pointer",
                  background: isSel ? "#EEF1FD" : undefined,
                  boxShadow: isSel ? `inset 3px 0 0 ${T.primary}` : undefined,
                }}
              >
                <td style={{ ...tdStyle, fontWeight: 600 }}>{r.lot_id}</td>
                <td style={tdStyle}>{r.date}</td>
                <td style={tdStyle}>{r.supplier_code}</td>
                <td style={{ ...tdStyle, textAlign: "right" }}>{nf(r.quality_score, 2)}</td>
                <td style={tdStyle}>
                  {pass ? <StatusBadge variant={pass.variant} label={pass.label} /> : "—"}
                </td>
                <td style={tdStyle}>
                  <StatusBadge variant={lotBadge.variant} label={lotBadge.label} dot />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── [C] 상세 패널 ────────────────────────────────────────────────────────────

function LotDetailPanel({
  lotId,
  settings,
  onStatusSaved,
}: {
  lotId: string | null;
  settings: PublicSettingsDto | null;
  onStatusSaved: () => void;
}) {
  const [detail, setDetail] = useState<LotDetailDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  const [draftStatus, setDraftStatus] = useState<LotStatus | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  // SSR 에서는 sessionStorage 가 없어 `currentRole()` 이 항상 null 이다 — 훅으로 읽는다
  const role = useRole();
  const canEdit = role !== null && CAN_PATCH_STATUS.has(role);

  useEffect(() => {
    if (!lotId) {
      setDetail(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSaveError(null);
    setSavedMsg(null);
    api
      .getLotDetail(lotId)
      .then((d) => {
        if (cancelled) return;
        setDetail(d);
        setDraftStatus(d.status);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const entry = resolveError(err);
        setDetail(null);
        setError(
          entry.status === 404
            ? `${lotId} 을(를) 찾을 수 없습니다`
            : err instanceof Error
              ? err.message
              : entry.title
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [lotId, reload]);

  if (!lotId) {
    return (
      <div className="card">
        <p style={{ fontSize: 13, color: T.textMuted, margin: 0 }}>
          왼쪽 목록에서 LOT 을 선택하면 성분·품질·출하 이력과 공정 타임라인이 표시됩니다.
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="card" style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: T.textSub }}>
        <Spinner size="sm" /> {lotId} 상세를 불러오는 중
      </div>
    );
  }

  if (error) {
    return (
      <div className="card">
        <ErrorAlert message={error} />
        <button type="button" className="btn" style={{ marginTop: 10 }} onClick={() => setReload((r) => r + 1)}>
          다시 시도
        </button>
      </div>
    );
  }

  if (!detail) return null;

  const sum = detail.sn_ratio + detail.ag_ratio + detail.cu_ratio + detail.pb_ratio;
  const sumOff = Math.abs(sum - 100) > 0.05;
  const statusBadge = lotStatusBadge(detail.status);
  /** 저장을 막지는 않는다 — `lots` 에 CHECK 제약이 없다. 주의만 띄운다 */
  const expected = expectedStatus(detail.quality_score, settings);
  const mismatch = expected !== null && expected !== detail.status;

  async function saveStatus() {
    if (!detail || draftStatus === null || draftStatus === detail.status) return;
    setSaving(true);
    setSaveError(null);
    setSavedMsg(null);
    try {
      await api.patchLotStatus(detail.lot_id, draftStatus);
      setSavedMsg("상태가 변경되었습니다");
      setReload((r) => r + 1);
      onStatusSaved();
    } catch (err) {
      const entry = resolveError(err);
      setSaveError(err instanceof Error ? err.message : entry.detail);
      setDraftStatus(detail.status); // 실패하면 셀렉트를 원복한다
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* [C-1] 요약 + 상태 변경 */}
      <div className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: T.text }}>{detail.lot_id}</div>
            <div style={{ fontSize: 11.5, color: T.textMuted }}>
              {detail.date} · {detail.supplier_code}
            </div>
          </div>
          <StatusBadge variant={statusBadge.variant} label={statusBadge.label} dot />
        </div>

        <dl style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, margin: 0, fontSize: 12.5 }}>
          <Field label="Sn 비율" value={`${nf(detail.sn_ratio, 3)} %`} />
          <Field label="Ag 비율" value={`${nf(detail.ag_ratio, 3)} %`} />
          <Field label="Cu 비율" value={`${nf(detail.cu_ratio, 3)} %`} />
          <Field label="Pb 비율" value={`${nf(detail.pb_ratio, 3)} %`} />
          <Field label="용해 온도" value={detail.temperature === null ? "—" : `${nf(detail.temperature, 1)} °C`} />
          <Field label="처리 시간" value={detail.time_min === null ? "—" : `${detail.time_min} 분`} />
          <Field label="품질점수" value={nf(detail.quality_score, 2)} />
          <Field
            label="성분 합계"
            value={`${sum.toFixed(3)} %`}
            warn={sumOff ? "100% 와 0.05%p 넘게 차이납니다" : undefined}
          />
          <Field label="등록일시" value={dt(detail.created_at)} />
          <Field label="수정일시" value={dt(detail.updated_at)} />
        </dl>

        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 11.5, fontWeight: 600, color: T.textSub }}>상태 변경</span>
          <select
            value={draftStatus ?? detail.status}
            disabled={!canEdit || saving}
            onChange={(e) => setDraftStatus(e.target.value as LotStatus)}
            style={{ ...inputStyle, width: 120 }}
          >
            <option value="pass">합격</option>
            <option value="warning">경고</option>
            <option value="fail">불합격</option>
            <option value="pending">미검사</option>
          </select>
          <button
            type="button"
            className="btn pri"
            disabled={!canEdit || saving || draftStatus === detail.status}
            onClick={() => void saveStatus()}
          >
            {saving ? "저장 중…" : "저장"}
          </button>
          {!canEdit && (
            <span style={{ fontSize: 11.5, color: T.textMuted }}>
              현재 계정 권한으로는 상태를 변경할 수 없습니다
            </span>
          )}
          {mismatch && (
            <span title="품질점수 기준 상태와 다릅니다 (참고 표기 — 저장은 막지 않습니다)" style={{ fontSize: 11.5, color: T.warning }}>
              ⚠ 품질점수와 불일치
            </span>
          )}
          {savedMsg && <StatusBadge variant="green" label={savedMsg} dot />}
        </div>
        {saveError && <ErrorAlert message={`상태를 변경하지 못했습니다 — ${saveError}`} />}
      </div>

      {/* [C-5] 공정 타임라인 (파생 4단계) */}
      <div className="card">
        <div style={sectionTitle}>공정 타임라인</div>
        <Timeline detail={detail} />
        <p style={{ fontSize: 11, color: T.textMuted, margin: "10px 0 0" }}>
          원자재 입고·포장 단계는 표시하지 않습니다 — 입고(<code>receipts</code>)에 LOT 연결 컬럼이
          없고 포장 기록 테이블이 없습니다. 없는 단계를 &quot;대기&quot;로 표시하지 않습니다.
        </p>
      </div>

      {/* [C-2] 성분 데이터 */}
      <div className="card">
        <div style={sectionTitle}>성분 데이터</div>
        {detail.components.length === 0 ? (
          <p style={emptyTextStyle}>성분 분석 이력 없음</p>
        ) : (
          <ComponentsTable rows={detail.components} settings={settings} />
        )}
      </div>

      {/* [C-3] 품질 이력 */}
      <div className="card">
        <div style={sectionTitle}>품질 검사 이력</div>
        {detail.quality.length === 0 ? (
          <p style={emptyTextStyle}>품질 검사 이력 없음</p>
        ) : (
          <div style={tableWrapStyle}>
            <table style={tableStyle}>
              <thead>
                <tr style={{ background: T.surfaceSubtle }}>
                  <th style={thStyle}>검사일시</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>점수</th>
                  <th style={thStyle}>판정</th>
                  <th style={thStyle}>사용 모델</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>예측 점수</th>
                </tr>
              </thead>
              <tbody>
                {detail.quality.map((q) => {
                  // 🚨 서버가 내린 `passed` 를 그대로 쓴다. 프론트가 다시 판정하지 않는다
                  const badge = passBadgeFromServer(q.passed);
                  return (
                    <tr key={q.id} style={{ borderBottom: `1px solid ${T.border}` }}>
                      <td style={tdStyle}>{dt(q.tested_at)}</td>
                      <td style={{ ...tdStyle, textAlign: "right" }}>{q.score.toFixed(2)}</td>
                      <td style={tdStyle}>
                        <StatusBadge variant={badge.variant} label={badge.label} />
                      </td>
                      <td style={tdStyle}>{q.model_used}</td>
                      <td style={{ ...tdStyle, textAlign: "right" }}>{nf(q.predicted_score, 2)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p style={{ fontSize: 11, color: T.textMuted, margin: "8px 0 0" }}>
          합격 기준 {passScoreOf(settings)}점 — 판정은 검사 저장 시점에 서버가 계산한 값입니다.
        </p>
      </div>

      {/* [C-4] 출하 이력 */}
      <div className="card">
        <div style={sectionTitle}>출하 이력</div>
        {detail.shipments.length === 0 ? (
          <p style={emptyTextStyle}>출하 이력 없음</p>
        ) : (
          <div style={tableWrapStyle}>
            <table style={tableStyle}>
              <thead>
                <tr style={{ background: T.surfaceSubtle }}>
                  <th style={thStyle}>고객사</th>
                  <th style={thStyle}>제품</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>수량</th>
                  <th style={thStyle}>단위</th>
                  <th style={thStyle}>출하일시</th>
                </tr>
              </thead>
              <tbody>
                {detail.shipments.map((s) => (
                  <tr key={s.id} style={{ borderBottom: `1px solid ${T.border}` }}>
                    <td style={tdStyle}>{s.customer}</td>
                    <td style={tdStyle}>{s.product}</td>
                    <td style={{ ...tdStyle, textAlign: "right" }}>{s.quantity.toFixed(2)}</td>
                    <td style={tdStyle}>{s.unit}</td>
                    <td style={tdStyle}>{dt(s.shipped_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

/** 참고 표기용. `db-schema.md` §3.1 의 경계이며 `quality_pass_score` 설정과 연동되지 않는다 */
function expectedStatus(score: number | null, _settings: PublicSettingsDto | null): LotStatus | null {
  if (score === null) return "pending";
  if (score >= 80) return "pass";
  if (score >= 70) return "warning";
  return "fail";
}

// ─── [C-2] 성분표 ─────────────────────────────────────────────────────────────

function ComponentsTable({
  rows,
  settings,
}: {
  rows: LotDetailDto["components"];
  settings: PublicSettingsDto | null;
}) {
  return (
    <>
      <div style={tableWrapStyle}>
        <table style={tableStyle}>
          <thead>
            <tr style={{ background: T.surfaceSubtle }}>
              <th style={thStyle}>분석일</th>
              <th style={{ ...thStyle, textAlign: "right" }}>Sn</th>
              <th style={{ ...thStyle, textAlign: "right" }}>Ag</th>
              <th style={{ ...thStyle, textAlign: "right" }}>Cu</th>
              <th style={{ ...thStyle, textAlign: "right" }}>Pb</th>
              <th style={{ ...thStyle, textAlign: "right" }}>Sn 편차</th>
              <th style={{ ...thStyle, textAlign: "right" }}>Ag 편차</th>
              <th style={{ ...thStyle, textAlign: "right" }}>Cu 편차</th>
              <th style={thStyle}>분석법</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id} style={{ borderBottom: `1px solid ${T.border}` }}>
                <td style={tdStyle}>{c.date}</td>
                <td style={{ ...tdStyle, textAlign: "right" }}>{c.sn.toFixed(3)}</td>
                <td style={{ ...tdStyle, textAlign: "right" }}>{c.ag.toFixed(3)}</td>
                <td style={{ ...tdStyle, textAlign: "right" }}>{c.cu.toFixed(3)}</td>
                <td style={{ ...tdStyle, textAlign: "right" }}>{c.pb.toFixed(3)}</td>
                {/* 편차는 **서버 저장값**이다. `sn - 62.0` 을 프론트에서 재계산하지 않는다 */}
                <DeviationCell component="sn" value={c.sn_deviation} settings={settings} />
                <DeviationCell component="ag" value={c.ag_deviation} settings={settings} />
                <DeviationCell component="cu" value={c.cu_deviation} settings={settings} />
                <td style={tdStyle}>{c.analysis_method ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p style={{ fontSize: 11, color: T.textMuted, margin: "8px 0 0" }}>
        목표값 Sn {SN_TARGET.toFixed(1)}% · Ag {AG_TARGET.toFixed(1)}% · Cu {CU_TARGET.toFixed(1)}% ·
        경고 임계 Sn {settings?.deviation_warn.sn ?? "—"} / Ag {settings?.deviation_warn.ag ?? "—"} / Cu{" "}
        {settings?.deviation_warn.cu ?? "—"} %p. Pb 는 목표값이 정의돼 있지 않아 편차 열이 없습니다.
      </p>
    </>
  );
}

function DeviationCell({
  component,
  value,
  settings,
}: {
  component: "sn" | "ag" | "cu";
  value: number;
  settings: PublicSettingsDto | null;
}) {
  const warn = isDeviationWarning(component, value, settings);
  return (
    <td
      style={{
        ...tdStyle,
        textAlign: "right",
        color: warn ? T.warning : T.text,
        fontWeight: warn ? 700 : 400,
      }}
    >
      {value.toFixed(3)}
    </td>
  );
}

// ─── [C-5] 타임라인 ───────────────────────────────────────────────────────────

function Timeline({ detail }: { detail: LotDetailDto }) {
  const firstComponent = detail.components[0];
  const firstQuality = detail.quality[0];
  const firstShipment = detail.shipments[0];

  const steps = [
    { label: "배합", at: `${detail.date} (등록 ${dt(detail.created_at)})`, note: null as string | null, done: true },
    {
      label: "성분 분석",
      at: firstComponent ? dt(firstComponent.created_at) : null,
      note: firstComponent?.analysis_method ?? null,
      done: Boolean(firstComponent),
    },
    {
      label: "품질 검사",
      at: firstQuality ? dt(firstQuality.tested_at) : null,
      note: firstQuality ? `${firstQuality.score.toFixed(2)}점 · ${firstQuality.passed ? "합격" : "불합격"}` : null,
      done: Boolean(firstQuality),
    },
    {
      label: "출하",
      at: firstShipment ? dt(firstShipment.shipped_at) : null,
      note: firstShipment?.customer ?? null,
      done: Boolean(firstShipment),
    },
  ];

  return (
    <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 0 }}>
      {steps.map((s, i) => (
        <li key={s.label} style={{ display: "flex", gap: 12 }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: "50%",
                background: s.done ? T.primary : T.border,
                flexShrink: 0,
                marginTop: 4,
              }}
            />
            {i < steps.length - 1 && (
              <span style={{ width: 2, flex: 1, minHeight: 24, background: T.border }} />
            )}
          </div>
          <div style={{ paddingBottom: i < steps.length - 1 ? 14 : 0 }}>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: s.done ? T.text : T.textMuted }}>
              {s.label}
            </div>
            <div style={{ fontSize: 11.5, color: T.textSub }}>
              {s.at ?? (s.label === "출하" ? "출하 대기" : "미실시")}
              {s.note ? ` · ${s.note}` : ""}
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}

// ─── 작은 조각 ────────────────────────────────────────────────────────────────

function Field({ label, value, warn }: { label: string; value: string; warn?: string }) {
  return (
    <div>
      <dt style={{ fontSize: 11, color: T.textMuted, fontWeight: 600 }}>{label}</dt>
      <dd style={{ margin: "2px 0 0", color: warn ? T.warning : T.text, fontWeight: warn ? 700 : 400 }}>
        {value}
      </dd>
      {warn && <div style={{ fontSize: 10.5, color: T.warning }}>{warn}</div>}
    </div>
  );
}

// ─── 스타일 ───────────────────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  height: 32,
  padding: "0 8px",
  border: `1px solid ${T.border}`,
  borderRadius: 6,
  fontSize: 12.5,
  fontFamily: "inherit",
  outline: "none",
};

const bannerStyle: React.CSSProperties = {
  background: "#FFFBEB",
  border: "1px solid #FCD34D",
  borderRadius: 10,
  padding: "10px 14px",
  fontSize: 12.5,
  color: "#92400E",
};

const sectionTitle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 700,
  color: T.text,
  marginBottom: 14,
};

const emptyTextStyle: React.CSSProperties = { fontSize: 12.5, color: T.textMuted, margin: 0 };

const tableWrapStyle: React.CSSProperties = {
  overflowX: "auto",
  borderRadius: 12,
  border: `1px solid ${T.border}`,
  background: T.surface,
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
