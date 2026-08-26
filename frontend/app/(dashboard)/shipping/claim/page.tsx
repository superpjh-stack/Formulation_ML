"use client";

/**
 * FE-RT-19 · `/shipping/claim` · 클레임 관리 (FR-S-04)
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * 🔴 하드코딩 목록을 `GET /api/v1/claims` 로 교체했다.
 *
 * 상태 4값 `open`/`analyzing`/`resolved`/`rejected` (§3.1). 전이 규칙은 **UI 가이드**이지
 * API 검증이 아니다 — `claims.status` 에 DB CHECK 제약이 없어 서버는 4값 중 아무거나 받는다.
 * 역행 전이(`resolved` → `open`)는 막지 않고 **확인 대화상자**만 띄운다.
 *
 * ⚠ 종결 전이(`resolved`/`rejected`)에 `resolution` 이 비면 **서버가 422** 를 낸다.
 *   폼에서 먼저 막되, 서버 오류도 그대로 화면에 띄운다.
 *
 * ⚠ [D-3] 처리 이력은 `GET /claims/{claim_no}/history` (audit_logs 재구성)다.
 *   **봉투 없는 배열**이고 `ip_address` 는 오지 않는다. 빈 배열은 "이력 없음"이지 오류가 아니다.
 *
 * 🚨 [D-2] LOT 품질점수 배지는 `lib/quality.ts` 로만 만든다 (`getQualityBadgeVariant()` 금지).
 * ══════════════════════════════════════════════════════════════════════════════
 */

import { useEffect, useMemo, useState } from "react";
import * as api from "@/lib/koryo-api";
import { useClaims, usePublicSettings } from "@/hooks/useKoryoData";
import { useRole } from "@/hooks/useRole";
import { resolveError } from "@/lib/error-contract";
import { isDeviationWarning, lotStatusBadge, passBadgeFromServer, qualityPassBadge } from "@/lib/quality";
import { StatusScreen } from "@/components/layout/StatusScreen";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { ErrorAlert } from "@/components/ui/ErrorAlert";
import { PillFilter } from "@/components/ui/PillFilter";
import { Modal } from "@/components/ui/Modal";
import { Spinner } from "@/components/ui/Spinner";
import { KpiCard } from "@/components/ui/KpiCard";
import { T } from "@/components/ui/tokens";
import type {
  ClaimDto,
  ClaimHistoryDto,
  ClaimStatus,
  LotDetailDto,
  PublicSettingsDto,
} from "@/types/api";

const PAGE_SIZE = 50;

const STATUS_META: Record<ClaimStatus, { label: string; variant: "gray" | "blue" | "green" | "red" }> = {
  open: { label: "접수", variant: "gray" },
  analyzing: { label: "분석중", variant: "blue" },
  resolved: { label: "처리완료", variant: "green" },
  rejected: { label: "기각", variant: "red" },
};

const STATUS_ORDER: ClaimStatus[] = ["open", "analyzing", "resolved", "rejected"];

const FILTER_OPTIONS: { value: "all" | ClaimStatus; label: string }[] = [
  { value: "all", label: "전체" },
  ...STATUS_ORDER.map((s) => ({ value: s as "all" | ClaimStatus, label: STATUS_META[s].label })),
];

/** 종결 상태 — 이 상태로 전이하려면 `resolution` 이 필수다 */
const TERMINAL: ClaimStatus[] = ["resolved", "rejected"];

/** `POST /claims` · `PATCH /claims/{no}` 를 쓸 수 있는 역할 */
const CAN_WRITE = new Set(["admin", "sales", "quality"]);

const dt = (s: string) => s.replace("T", " ").slice(0, 19);
const nf = (v: number | null | undefined, d: number) =>
  v === null || v === undefined ? "—" : v.toFixed(d);

export default function ClaimPage() {
  const [status, setStatus] = useState<"all" | ClaimStatus>("all");
  const [customer, setCustomer] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<ClaimDto | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const settings = usePublicSettings();
  const publicSettings = settings.data?.settings ?? null;

  // SSR 에서는 sessionStorage 가 없어 `currentRole()` 이 항상 null 이다 — 훅으로 읽는다
  const role = useRole();
  const canWrite = role !== null && CAN_WRITE.has(role);

  const query = useMemo(
    () => ({
      page,
      page_size: PAGE_SIZE,
      ...(status !== "all" ? { status } : {}),
      ...(customer ? { customer } : {}),
    }),
    [page, status, customer]
  );

  const list = useClaims(query);
  // 처리 현황 4장 — 상태별 `total` 만 받는다 (전건 로드 금지)
  const openCount = useClaims(useMemo(() => ({ status: "open" as ClaimStatus, page_size: 1 }), []));
  const analyzingCount = useClaims(useMemo(() => ({ status: "analyzing" as ClaimStatus, page_size: 1 }), []));
  const resolvedCount = useClaims(useMemo(() => ({ status: "resolved" as ClaimStatus, page_size: 1 }), []));
  const rejectedCount = useClaims(useMemo(() => ({ status: "rejected" as ClaimStatus, page_size: 1 }), []));

  const rows = list.data?.items ?? [];
  const total = list.data?.total ?? 0;
  const maxPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function refreshAll() {
    list.refetch();
    openCount.refetch();
    analyzingCount.refetch();
    resolvedCount.refetch();
    rejectedCount.refetch();
  }

  // 목록이 갱신되면 선택 행도 최신 값으로 맞춘다
  useEffect(() => {
    if (!selected) return;
    const fresh = rows.find((r) => r.claim_no === selected.claim_no);
    if (fresh && fresh !== selected) setSelected(fresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.data]);

  const counts = [
    { label: "접수", state: openCount },
    { label: "분석중", state: analyzingCount },
    { label: "처리완료", state: resolvedCount },
    { label: "기각", state: rejectedCount },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* [A] 헤더 */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: T.text, margin: 0 }}>클레임 관리</h1>
          <p style={{ fontSize: 12.5, color: T.textSub, margin: "4px 0 0" }}>
            고객 클레임 등록 · 원인 분석 · 처리 이력 (FR-S-04)
          </p>
        </div>
        <button
          type="button"
          className="btn pri"
          disabled={!canWrite}
          title={canWrite ? undefined : "현재 계정 권한으로는 클레임을 등록할 수 없습니다"}
          onClick={() => setCreateOpen(true)}
        >
          + 클레임 등록
        </button>
      </div>

      {/* [B] 처리 현황 4장 */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
        {counts.map((c) => (
          <KpiCard
            key={c.label}
            label={c.label}
            value={c.state.loading ? "—" : (c.state.data?.total ?? 0).toLocaleString("ko-KR")}
            unit="건"
          />
        ))}
      </div>
      {counts.some((c) => c.state.error) && (
        <ErrorAlert
          message={`처리 현황 집계를 불러오지 못했습니다 — ${counts.find((c) => c.state.error)!.state.error}`}
        />
      )}

      <div className="card" style={{ display: "flex", gap: 14, alignItems: "flex-end", flexWrap: "wrap" }}>
        <PillFilter
          options={FILTER_OPTIONS}
          value={status}
          onChange={(v) => {
            setStatus(v);
            setPage(1);
          }}
          label="처리상태:"
        />
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={labelStyle}>고객사</span>
          <input
            type="text"
            value={customer}
            placeholder="전체"
            onChange={(e) => {
              setCustomer(e.target.value.trim());
              setPage(1);
            }}
            style={{ ...inputStyle, width: 160 }}
          />
        </label>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, alignItems: "start" }}>
        {/* [C] 목록 */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <div style={sectionTitle}>클레임 목록</div>
            <span style={{ fontSize: 12, color: T.textSub }}>
              {list.loading ? "조회 중" : `총 ${total.toLocaleString("ko-KR")}건`}
            </span>
          </div>

          {list.loading ? (
            <StatusScreen tone="loading" title="클레임을 불러오는 중" />
          ) : list.error ? (
            <ErrorAlert message={`클레임 목록을 불러오지 못했습니다 — ${list.error}`} />
          ) : rows.length === 0 ? (
            <StatusScreen
              tone="empty"
              title="조건에 맞는 클레임이 없습니다"
              actions={[
                {
                  label: "필터 초기화",
                  onClick: () => {
                    setStatus("all");
                    setCustomer("");
                    setPage(1);
                  },
                  primary: true,
                },
              ]}
            />
          ) : (
            <ClaimTable rows={rows} selected={selected?.claim_no ?? null} onSelect={setSelected} />
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

        {/* [D] 상세 */}
        {selected ? (
          <ClaimDetail
            claim={selected}
            settings={publicSettings}
            canWrite={canWrite}
            onChanged={refreshAll}
          />
        ) : (
          <div className="card">
            <p style={{ fontSize: 13, color: T.textMuted, margin: 0 }}>
              왼쪽 목록에서 클레임을 선택하면 원인 분석(대상 LOT 성분)과 처리 이력이 표시됩니다.
            </p>
          </div>
        )}
      </div>

      {/* [E] 등록 */}
      <CreateClaimModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => {
          setCreateOpen(false);
          refreshAll();
        }}
      />
    </div>
  );
}

// ─── [C] 목록 표 ──────────────────────────────────────────────────────────────

function ClaimTable({
  rows,
  selected,
  onSelect,
}: {
  rows: ClaimDto[];
  selected: string | null;
  onSelect: (c: ClaimDto) => void;
}) {
  return (
    <div style={tableWrapStyle}>
      <table style={tableStyle}>
        <thead>
          <tr style={{ background: T.surfaceSubtle }}>
            <th style={thStyle}>클레임번호</th>
            <th style={thStyle}>접수일</th>
            <th style={thStyle}>고객사</th>
            <th style={thStyle}>대상 LOT</th>
            <th style={thStyle}>처리상태</th>
            <th style={thStyle}>처리일시</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => {
            const meta = STATUS_META[c.status];
            const isSel = c.claim_no === selected;
            return (
              <tr
                key={c.claim_no}
                onClick={() => onSelect(c)}
                style={{
                  borderBottom: `1px solid ${T.border}`,
                  cursor: "pointer",
                  background: isSel ? "#EEF1FD" : undefined,
                  boxShadow: isSel ? `inset 3px 0 0 ${T.primary}` : undefined,
                }}
              >
                <td style={{ ...tdStyle, fontWeight: 600 }}>{c.claim_no}</td>
                <td style={tdStyle}>{dt(c.created_at).slice(0, 10)}</td>
                <td style={tdStyle}>{c.customer}</td>
                <td style={tdStyle}>{c.lot_id}</td>
                <td style={tdStyle}>
                  <StatusBadge variant={meta.variant} label={meta.label} dot />
                </td>
                <td style={tdStyle}>{c.resolved_at ? dt(c.resolved_at) : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── [D] 상세 ─────────────────────────────────────────────────────────────────

function ClaimDetail({
  claim,
  settings,
  canWrite,
  onChanged,
}: {
  claim: ClaimDto;
  settings: PublicSettingsDto | null;
  canWrite: boolean;
  onChanged: () => void;
}) {
  const [draftStatus, setDraftStatus] = useState<ClaimStatus>(claim.status);
  const [resolution, setResolution] = useState(claim.resolution ?? "");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [confirmReopen, setConfirmReopen] = useState(false);

  useEffect(() => {
    setDraftStatus(claim.status);
    setResolution(claim.resolution ?? "");
    setSaveError(null);
    setSavedMsg(null);
  }, [claim]);

  const needsResolution = TERMINAL.includes(draftStatus);
  const resolutionMissing = needsResolution && resolution.trim().length === 0;
  const reopening = TERMINAL.includes(claim.status) && !TERMINAL.includes(draftStatus);
  const dirty = draftStatus !== claim.status || (resolution.trim() || null) !== claim.resolution;

  async function save() {
    setConfirmReopen(false);
    setSaving(true);
    setSaveError(null);
    setSavedMsg(null);
    try {
      // `resolved_at` 은 보내지 않는다 — 서버가 채운다
      await api.patchClaim(claim.claim_no, {
        status: draftStatus,
        ...(resolution.trim() ? { resolution: resolution.trim() } : {}),
      });
      setSavedMsg("처리 내용이 저장되었습니다");
      onChanged();
    } catch (err) {
      const entry = resolveError(err);
      setSaveError(err instanceof Error ? err.message : entry.detail);
    } finally {
      setSaving(false);
    }
  }

  function handleSave() {
    if (resolutionMissing || !dirty) return;
    // 역행 전이는 막지 않는다 — 확인만 받는다 (§3.1)
    if (reopening) {
      setConfirmReopen(true);
      return;
    }
    void save();
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* [D-1] 클레임 정보 + 상태 전이 */}
      <div className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: T.text }}>{claim.claim_no}</div>
            <div style={{ fontSize: 11.5, color: T.textMuted }}>
              {claim.customer} · {claim.lot_id} · 접수 {dt(claim.created_at)}
            </div>
          </div>
          <StatusBadge
            variant={STATUS_META[claim.status].variant}
            label={STATUS_META[claim.status].label}
            dot
          />
        </div>

        <div>
          <div style={{ fontSize: 11, color: T.textMuted, fontWeight: 600 }}>클레임 사유</div>
          <p style={{ fontSize: 13, color: T.text, margin: "4px 0 0", whiteSpace: "pre-wrap", lineHeight: 1.6 }}>
            {claim.reason}
          </p>
        </div>

        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={labelStyle}>처리상태</span>
          <select
            value={draftStatus}
            disabled={!canWrite || saving}
            onChange={(e) => setDraftStatus(e.target.value as ClaimStatus)}
            style={{ ...inputStyle, width: 160 }}
          >
            {STATUS_ORDER.map((s) => (
              <option key={s} value={s}>
                {STATUS_META[s].label}
              </option>
            ))}
          </select>
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={labelStyle}>
            처리 내용 {needsResolution ? "*" : "(선택)"}
          </span>
          <textarea
            value={resolution}
            disabled={!canWrite || saving}
            maxLength={2000}
            rows={4}
            placeholder={needsResolution ? "처리완료·기각으로 전이하려면 처리 내용이 필요합니다" : ""}
            onChange={(e) => setResolution(e.target.value)}
            style={{
              padding: 8,
              border: `1px solid ${resolutionMissing ? T.error : T.border}`,
              borderRadius: 6,
              fontSize: 12.5,
              fontFamily: "inherit",
              resize: "vertical",
              outline: "none",
            }}
          />
          {resolutionMissing && (
            <span style={fieldErrorStyle}>
              처리완료·기각으로 전이하려면 처리 내용을 입력해야 합니다 (서버가 422 로 거부합니다)
            </span>
          )}
        </label>

        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <button
            type="button"
            className="btn pri"
            disabled={!canWrite || saving || !dirty || resolutionMissing}
            onClick={handleSave}
          >
            {saving ? "저장 중…" : "저장"}
          </button>
          <span style={{ fontSize: 11.5, color: T.textMuted }}>
            처리일시 {claim.resolved_at ? dt(claim.resolved_at) : "—"} (서버가 기록합니다)
          </span>
          {!canWrite && (
            <span style={{ fontSize: 11.5, color: T.textMuted }}>
              현재 계정 권한으로는 수정할 수 없습니다
            </span>
          )}
          {savedMsg && <StatusBadge variant="green" label={savedMsg} dot />}
        </div>
        {saveError && <ErrorAlert message={`저장하지 못했습니다 — ${saveError}`} />}
      </div>

      {/* [D-2] 원인 분석 */}
      <CauseAnalysis lotId={claim.lot_id} settings={settings} />

      {/* [D-3] 처리 이력 */}
      <ClaimHistoryPanel claimNo={claim.claim_no} />

      <Modal
        open={confirmReopen}
        onClose={() => setConfirmReopen(false)}
        title="종결된 클레임을 재개합니다"
        footer={
          <>
            <button type="button" className="btn" onClick={() => setConfirmReopen(false)}>
              취소
            </button>
            <button type="button" className="btn pri" onClick={() => void save()}>
              계속
            </button>
          </>
        }
      >
        <p style={{ fontSize: 13, color: T.text, margin: 0, lineHeight: 1.7 }}>
          <b>{STATUS_META[claim.status].label}</b> 상태의 클레임을{" "}
          <b>{STATUS_META[draftStatus].label}</b> 로 되돌립니다. 계속할까요?
        </p>
      </Modal>
    </div>
  );
}

// ─── [D-2] 원인 분석 — 대상 LOT 성분 ────────────────────────────────────────────

function CauseAnalysis({
  lotId,
  settings,
}: {
  lotId: string;
  settings: PublicSettingsDto | null;
}) {
  const [lot, setLot] = useState<LotDetailDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setLot(null);
    api
      .getLotDetail(lotId)
      .then((d) => {
        if (!cancelled) setLot(d);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const entry = resolveError(err);
        setError(
          entry.status === 404
            ? "대상 LOT 정보를 찾을 수 없습니다"
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
  }, [lotId]);

  const comp = lot?.components[0] ?? null;
  const pass = lot?.quality_score === null || lot === null ? null : qualityPassBadge(lot.quality_score, settings);

  return (
    <div className="card">
      <div style={sectionTitle}>원인 분석 · 대상 LOT 성분</div>
      {loading ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: T.textSub }}>
          <Spinner size="sm" /> {lotId} 정보를 불러오는 중
        </div>
      ) : error ? (
        <ErrorAlert message={error} />
      ) : lot ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: 20, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>
              {nf(lot.quality_score, 2)}
              <span style={{ fontSize: 12, fontWeight: 500, color: T.textMuted, marginLeft: 3 }}>점</span>
            </span>
            {/* 🚨 합격 배지는 lib/quality.ts 로만 만든다 */}
            {pass && <StatusBadge variant={pass.variant} label={pass.label} />}
            <StatusBadge
              variant={lotStatusBadge(lot.status).variant}
              label={`LOT ${lotStatusBadge(lot.status).label}`}
              dot
            />
            <span style={{ fontSize: 12, color: T.textSub }}>
              용해 온도 {lot.temperature === null ? "—" : `${lot.temperature.toFixed(1)}°C`} · 처리 시간{" "}
              {lot.time_min === null ? "—" : `${lot.time_min}분`}
            </span>
          </div>

          {comp === null ? (
            <p style={emptyTextStyle}>성분 분석 이력 없음</p>
          ) : (
            <div style={tableWrapStyle}>
              <table style={tableStyle}>
                <thead>
                  <tr style={{ background: T.surfaceSubtle }}>
                    <th style={thStyle}>성분</th>
                    <th style={{ ...thStyle, textAlign: "right" }}>실측 (%)</th>
                    <th style={{ ...thStyle, textAlign: "right" }}>목표 (%)</th>
                    <th style={{ ...thStyle, textAlign: "right" }}>편차 (%p)</th>
                    <th style={thStyle}>원인 후보</th>
                  </tr>
                </thead>
                <tbody>
                  {([
                    ["Sn", comp.sn, settings?.sn_target, comp.sn_deviation, "sn"],
                    ["Ag", comp.ag, settings?.ag_target, comp.ag_deviation, "ag"],
                    ["Cu", comp.cu, settings?.cu_target, comp.cu_deviation, "cu"],
                  ] as const).map(([name, actual, target, deviation, key]) => {
                    const warn = isDeviationWarning(key, deviation, settings);
                    return (
                      <tr key={name} style={{ borderBottom: `1px solid ${T.border}` }}>
                        <td style={tdStyle}>{name}</td>
                        <td style={{ ...tdStyle, textAlign: "right" }}>{actual.toFixed(3)}</td>
                        <td style={{ ...tdStyle, textAlign: "right" }}>{target?.toFixed(1) ?? "—"}</td>
                        <td
                          style={{
                            ...tdStyle,
                            textAlign: "right",
                            color: warn ? T.warning : T.text,
                            fontWeight: warn ? 700 : 400,
                          }}
                        >
                          {deviation.toFixed(3)}
                        </td>
                        <td style={tdStyle}>
                          {warn ? <StatusBadge variant="amber" label="편차 경고" /> : "—"}
                        </td>
                      </tr>
                    );
                  })}
                  <tr style={{ borderBottom: `1px solid ${T.border}` }}>
                    <td style={tdStyle}>Pb</td>
                    <td style={{ ...tdStyle, textAlign: "right" }}>{comp.pb.toFixed(3)}</td>
                    {/* Pb 는 목표값이 정의돼 있지 않다 */}
                    <td style={{ ...tdStyle, textAlign: "right" }}>—</td>
                    <td style={{ ...tdStyle, textAlign: "right" }}>—</td>
                    <td style={tdStyle}>—</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          <div>
            <div style={{ fontSize: 11, color: T.textMuted, fontWeight: 600, marginBottom: 6 }}>
              품질 검사 이력
            </div>
            {lot.quality.length === 0 ? (
              <p style={emptyTextStyle}>품질 검사 이력 없음</p>
            ) : (
              <div style={tableWrapStyle}>
                <table style={tableStyle}>
                  <thead>
                    <tr style={{ background: T.surfaceSubtle }}>
                      <th style={thStyle}>검사일시</th>
                      <th style={{ ...thStyle, textAlign: "right" }}>점수</th>
                      <th style={thStyle}>판정</th>
                      <th style={thStyle}>모델</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lot.quality.map((q) => {
                      const badge = passBadgeFromServer(q.passed);
                      return (
                        <tr key={q.id} style={{ borderBottom: `1px solid ${T.border}` }}>
                          <td style={tdStyle}>{dt(q.tested_at)}</td>
                          <td style={{ ...tdStyle, textAlign: "right" }}>{q.score.toFixed(2)}</td>
                          <td style={tdStyle}>
                            <StatusBadge variant={badge.variant} label={badge.label} />
                          </td>
                          <td style={tdStyle}>{q.model_used}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ─── [D-3] 처리 이력 ──────────────────────────────────────────────────────────

function ClaimHistoryPanel({ claimNo }: { claimNo: string }) {
  const [rows, setRows] = useState<ClaimHistoryDto[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setRows(null);
    api
      .getClaimHistory(claimNo)
      .then((r) => {
        if (!cancelled) setRows(r);
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : "처리 이력을 불러오지 못했습니다");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [claimNo]);

  return (
    <div className="card">
      <div style={sectionTitle}>처리 이력</div>
      {loading ? (
        <Spinner size="sm" />
      ) : error ? (
        <ErrorAlert message={error} />
      ) : rows === null || rows.length === 0 ? (
        // 빈 배열은 "이력 없음"이다 — 오류로 그리지 않는다
        <p style={emptyTextStyle}>아직 처리 이력이 없습니다. 상태를 변경하면 여기에 기록됩니다.</p>
      ) : (
        <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 12 }}>
          {rows.map((h, i) => (
            <li key={`${h.changed_at}-${i}`} style={{ display: "flex", gap: 10 }}>
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: T.primary,
                  flexShrink: 0,
                  marginTop: 5,
                }}
              />
              <div>
                <div style={{ fontSize: 12.5, color: T.text }}>
                  {h.before?.status ? STATUS_META[h.before.status].label : "등록"} →{" "}
                  <b>{h.after?.status ? STATUS_META[h.after.status].label : "—"}</b>
                </div>
                <div style={{ fontSize: 11.5, color: T.textSub }}>
                  {dt(h.changed_at)} · {h.changed_by_username ?? "시스템"}
                </div>
                {h.after?.resolution && (
                  <div style={{ fontSize: 12, color: T.textSub, marginTop: 3, whiteSpace: "pre-wrap" }}>
                    {h.after.resolution}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

// ─── [E] 등록 ─────────────────────────────────────────────────────────────────

function CreateClaimModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [lotId, setLotId] = useState("");
  const [customer, setCustomer] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lookup, setLookup] = useState<string | null>(null);

  const lotError = lotId.trim() === "" ? "대상 LOT 을 입력하세요" : null;
  const customerError =
    customer.trim() === ""
      ? "고객사를 입력하세요"
      : customer.trim().length > 100
        ? "고객사는 100자 이하여야 합니다"
        : null;
  const reasonError = reason.trim() === "" ? "클레임 사유를 입력하세요" : null;
  const invalid = Boolean(lotError || customerError || reasonError);

  /** LOT 을 조회해 출하 고객사를 채워준다 (수정 가능). 실패해도 등록을 막지 않는다 */
  async function autofillCustomer() {
    const id = lotId.trim();
    if (!id) return;
    setLookup("조회 중…");
    try {
      const lot = await api.getLotDetail(id);
      const shipped = lot.shipments[0];
      if (shipped) {
        setCustomer(shipped.customer);
        setLookup(`출하 고객사 ${shipped.customer} 를 채웠습니다`);
      } else {
        setLookup("이 LOT 의 출하 이력이 없어 고객사를 채우지 못했습니다");
      }
    } catch (err) {
      setLookup(err instanceof Error ? err.message : "LOT 을 조회하지 못했습니다");
    }
  }

  function reset() {
    setLotId("");
    setCustomer("");
    setReason("");
    setError(null);
    setLookup(null);
  }

  async function submit() {
    if (invalid) return;
    setSaving(true);
    setError(null);
    try {
      // `claim_no` 는 **서버가 채번한다.** 본문에 실어 보내면 동시 등록 시 409 가 난다
      await api.createClaim({
        lot_id: lotId.trim(),
        customer: customer.trim(),
        reason: reason.trim(),
      });
      reset();
      onCreated();
    } catch (err) {
      const entry = resolveError(err);
      setError(
        entry.status === 404
          ? "LOT 을 찾을 수 없습니다"
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
        reset();
        onClose();
      }}
      title="클레임 등록"
      width={520}
      footer={
        <>
          <button
            type="button"
            className="btn"
            onClick={() => {
              reset();
              onClose();
            }}
          >
            취소
          </button>
          <button type="button" className="btn pri" disabled={invalid || saving} onClick={() => void submit()}>
            {saving ? "등록 중…" : "등록"}
          </button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {error && <ErrorAlert message={error} />}

        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={labelStyle}>대상 LOT *</span>
          <div style={{ display: "flex", gap: 6 }}>
            <input
              type="text"
              value={lotId}
              placeholder="LOT-2026-001"
              onChange={(e) => setLotId(e.target.value)}
              style={{ ...inputStyle, flex: 1 }}
            />
            <button type="button" className="btn" onClick={() => void autofillCustomer()}>
              고객사 채우기
            </button>
          </div>
          {lotError && <span style={fieldErrorStyle}>{lotError}</span>}
          {lookup && <span style={{ fontSize: 11.5, color: T.textSub }}>{lookup}</span>}
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={labelStyle}>고객사 * (1~100자)</span>
          <input
            type="text"
            value={customer}
            maxLength={100}
            onChange={(e) => setCustomer(e.target.value)}
            style={inputStyle}
          />
          {customerError && <span style={fieldErrorStyle}>{customerError}</span>}
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={labelStyle}>클레임 사유 *</span>
          <textarea
            value={reason}
            maxLength={2000}
            rows={5}
            onChange={(e) => setReason(e.target.value)}
            style={{
              padding: 8,
              border: `1px solid ${T.border}`,
              borderRadius: 6,
              fontSize: 12.5,
              fontFamily: "inherit",
              resize: "vertical",
              outline: "none",
            }}
          />
          {reasonError && <span style={fieldErrorStyle}>{reasonError}</span>}
        </label>

        <p style={{ fontSize: 11.5, color: T.textMuted, margin: 0 }}>
          클레임 번호는 서버가 채번합니다. 등록 직후 상태는 <b>접수</b>입니다.
        </p>
      </div>
    </Modal>
  );
}

// ─── 스타일 ───────────────────────────────────────────────────────────────────

const labelStyle: React.CSSProperties = { fontSize: 11.5, fontWeight: 600, color: T.textSub };
const fieldErrorStyle: React.CSSProperties = { fontSize: 11.5, color: T.error };
const emptyTextStyle: React.CSSProperties = { fontSize: 12.5, color: T.textMuted, margin: 0 };

const inputStyle: React.CSSProperties = {
  height: 32,
  padding: "0 8px",
  border: `1px solid ${T.border}`,
  borderRadius: 6,
  fontSize: 12.5,
  fontFamily: "inherit",
  outline: "none",
};

const sectionTitle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 700,
  color: T.text,
  marginBottom: 14,
};

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
