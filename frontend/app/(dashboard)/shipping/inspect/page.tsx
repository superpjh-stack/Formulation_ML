"use client";

/**
 * FE-RT-18 · `/shipping/inspect` · 검사 결과 (FR-S-03)
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * 🔴 삭제한 것 — 전부 **저장할 컬럼이 없는 값**이었다
 *   - `MOCK_INSPECTIONS` 8건 → `GET /api/v1/quality`
 *   - 검사 항목 4종(`외관`/`성분`/`중량`/`포장`)과 항목별 합격률 카드
 *     → `quality` 테이블은 `score`/`passed`/`model_used`/`predicted_score`/`tested_at` 이 전부다
 *   - `검사자 김철수` 열 → 컬럼 없음 (`audit_logs.user_id` 로만 추적 가능)
 *   - 종합판정 `보류` → `quality.passed` 는 **boolean 2값**이다. 저장 불가
 *   - `검사번호 INS-001` · `product` 열 → 컬럼 없음
 *
 * 🆕 신규: 품질 점수 · 사용 모델 · 예측 점수/오차 · **성적서**(FR-S-03 필수인데 통째로 없었다) · 등록 모달
 *
 * 🚨 판정 배지는 **서버 `passed`** 만 쓴다. `getQualityBadgeVariant()` 는 임계값이
 *   `{90,75,60}` 이라 69.99 와 70.00 을 같은 색으로 그린다 — 이 화면에서 호출 금지다.
 *   합격선 숫자는 `usePublicSettings()` 에서 읽고 TSX 에 쓰지 않는다.
 *
 * ⚠ 성적서 출력 = **브라우저 인쇄**(`window.print()` + `@media print`) 다.
 *   PDF 파일 생성은 `ISS-001` 로 v1.1 범위 밖이다 — `jspdf`·`html2canvas`·`puppeteer`
 *   어떤 PDF 라이브러리도 추가하지 않는다.
 * ══════════════════════════════════════════════════════════════════════════════
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import * as api from "@/lib/koryo-api";
import { fetchModels } from "@/lib/api";
import { useQuality, usePublicSettings } from "@/hooks/useKoryoData";
import { useRole } from "@/hooks/useRole";
import { resolveError } from "@/lib/error-contract";
import { passBadgeFromServer, passScoreOf, qualityPassBadge } from "@/lib/quality";
import { StatusScreen } from "@/components/layout/StatusScreen";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { ErrorAlert } from "@/components/ui/ErrorAlert";
import { PillFilter } from "@/components/ui/PillFilter";
import { Modal } from "@/components/ui/Modal";
import { Spinner } from "@/components/ui/Spinner";
import { KpiCard } from "@/components/ui/KpiCard";
import { T } from "@/components/ui/tokens";
import type { ModelInfo } from "@/types";
import type { PublicSettingsDto, QualityCertificateDto, QualityDto } from "@/types/api";

const PAGE_SIZE = 50;

type PassFilter = "all" | "pass" | "fail";

const PASS_OPTIONS: { value: PassFilter; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "pass", label: "합격" },
  { value: "fail", label: "불합격" },
];

/** `POST /quality` 를 쓸 수 있는 역할 (api-contract §3.2) */
const CAN_CREATE = new Set(["admin", "quality"]);

const dt = (s: string) => s.replace("T", " ").slice(0, 19);

function iso(d: Date) {
  return d.toISOString().slice(0, 10);
}
function daysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return iso(d);
}

export default function InspectPage() {
  const [pass, setPass] = useState<PassFilter>("all");
  const [dateFrom, setDateFrom] = useState(daysAgo(29));
  const [dateTo, setDateTo] = useState(iso(new Date()));
  const [lotFilter, setLotFilter] = useState("");
  const [page, setPage] = useState(1);

  const [certLot, setCertLot] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const settings = usePublicSettings();
  const publicSettings = settings.data?.settings ?? null;
  const thresholdFallback = settings.data?.source === "fallback";

  // SSR 에서는 sessionStorage 가 없어 `currentRole()` 이 항상 null 이다 — 훅으로 읽는다
  const role = useRole();
  const canCreate = role !== null && CAN_CREATE.has(role);

  const baseQuery = useMemo(
    () => ({
      date_from: dateFrom,
      date_to: dateTo,
      ...(lotFilter ? { lot_id: lotFilter } : {}),
    }),
    [dateFrom, dateTo, lotFilter]
  );

  const listQuery = useMemo(
    () => ({
      ...baseQuery,
      page,
      page_size: PAGE_SIZE,
      ...(pass === "all" ? {} : { passed: pass === "pass" }),
    }),
    [baseQuery, page, pass]
  );

  const list = useQuality(listQuery);
  // 요약은 `Page.total` 2회 조회로 구한다 — 전건 로드 금지 (§7)
  const passCount = useQuality(useMemo(() => ({ ...baseQuery, page_size: 1, passed: true }), [baseQuery]));
  const failCount = useQuality(useMemo(() => ({ ...baseQuery, page_size: 1, passed: false }), [baseQuery]));

  const rows = list.data?.items ?? [];
  const total = list.data?.total ?? 0;
  const maxPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const passed = passCount.data?.total ?? null;
  const failed = failCount.data?.total ?? null;
  const overall = passed !== null && failed !== null ? passed + failed : null;
  // 0건이면 `0%` 가 아니라 `—` 다 (§6)
  const passRate = overall !== null && overall > 0 ? ((passed! / overall) * 100).toFixed(1) : "—";

  function resetFilters() {
    setPass("all");
    setDateFrom(daysAgo(29));
    setDateTo(iso(new Date()));
    setLotFilter("");
    setPage(1);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* [A] 헤더 */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: T.text, margin: 0 }}>검사 결과</h1>
          <p style={{ fontSize: 12.5, color: T.textSub, margin: "4px 0 0" }}>
            품질 검사 등록 · 판정 조회 · 성적서 출력 (FR-S-03)
          </p>
        </div>
        <button
          type="button"
          className="btn pri"
          disabled={!canCreate}
          title={canCreate ? undefined : "현재 계정 권한으로는 검사 결과를 등록할 수 없습니다"}
          onClick={() => setCreateOpen(true)}
        >
          + 검사 결과 등록
        </button>
      </div>

      {thresholdFallback && (
        <div style={bannerStyle}>
          합격 기준값을 서버에서 불러오지 못해 기본값({passScoreOf(publicSettings)}점)으로 안내하고
          있습니다. 각 행의 판정은 서버가 저장 시점에 계산한 값입니다.
          {settings.data?.error ? ` (${settings.data.error})` : ""}
        </div>
      )}

      {/* [B] 요약 4장 */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
        <KpiCard label="전체 검사" value={overall === null ? "—" : overall.toLocaleString("ko-KR")} unit="건" />
        <KpiCard label="합격" value={passed === null ? "—" : passed.toLocaleString("ko-KR")} unit="건" />
        <KpiCard label="불합격" value={failed === null ? "—" : failed.toLocaleString("ko-KR")} unit="건" />
        <KpiCard label="합격률" value={passRate} unit={passRate === "—" ? "" : "%"} />
      </div>
      {(passCount.error || failCount.error) && (
        <ErrorAlert message={`요약 집계를 불러오지 못했습니다 — ${passCount.error ?? failCount.error}`} />
      )}

      {/* [C] 필터 + 표 */}
      <div className="card" style={{ display: "flex", gap: 14, alignItems: "flex-end", flexWrap: "wrap" }}>
        <PillFilter
          options={PASS_OPTIONS}
          value={pass}
          onChange={(v) => {
            setPass(v);
            setPage(1);
          }}
          label="판정:"
        />
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={labelStyle}>기간 시작</span>
          <input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }} style={inputStyle} />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={labelStyle}>기간 종료</span>
          <input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }} style={inputStyle} />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={labelStyle}>LOT 번호</span>
          <input
            type="text"
            value={lotFilter}
            placeholder="전체"
            onChange={(e) => { setLotFilter(e.target.value.trim()); setPage(1); }}
            style={{ ...inputStyle, width: 160 }}
          />
        </label>
        <button type="button" className="btn" onClick={resetFilters}>
          필터 초기화
        </button>
      </div>

      {list.loading ? (
        <StatusScreen tone="loading" title="검사 결과를 불러오는 중" />
      ) : list.error ? (
        <ErrorAlert message={`검사 결과를 불러오지 못했습니다 — ${list.error}`} />
      ) : rows.length === 0 ? (
        <StatusScreen
          tone="empty"
          title="검사 결과가 없습니다"
          detail="선택한 조건에 해당하는 검사 이력이 없습니다."
          actions={[{ label: "필터 초기화", onClick: resetFilters, primary: true }]}
        />
      ) : (
        <ResultTable rows={rows} onCertificate={setCertLot} />
      )}

      {!list.loading && !list.error && total > PAGE_SIZE && (
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

      {/* [D] 성적서 */}
      <CertificateModal lotId={certLot} settings={publicSettings} onClose={() => setCertLot(null)} />

      {/* [E] 등록 */}
      <CreateModal
        open={createOpen}
        settings={publicSettings}
        onClose={() => setCreateOpen(false)}
        onCreated={() => {
          setCreateOpen(false);
          list.refetch();
          passCount.refetch();
          failCount.refetch();
        }}
      />
    </div>
  );
}

// ─── [C] 표 ───────────────────────────────────────────────────────────────────

function ResultTable({
  rows,
  onCertificate,
}: {
  rows: QualityDto[];
  onCertificate: (lotId: string) => void;
}) {
  return (
    <div style={tableWrapStyle}>
      <table style={tableStyle}>
        <thead>
          <tr style={{ background: T.surfaceSubtle }}>
            <th style={thStyle}>LOT번호</th>
            <th style={thStyle}>검사일시</th>
            <th style={{ ...thStyle, textAlign: "right" }}>품질 점수</th>
            <th style={thStyle}>판정</th>
            <th style={thStyle}>사용 모델</th>
            <th style={{ ...thStyle, textAlign: "right" }}>예측 점수</th>
            <th style={{ ...thStyle, textAlign: "right" }}>예측 오차</th>
            <th style={{ ...thStyle, textAlign: "right" }}>성적서</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((q) => {
            // 🚨 서버 판정을 그대로 배지로 옮긴다. 프론트가 점수를 다시 비교하지 않는다
            const badge = passBadgeFromServer(q.passed);
            const err =
              q.predicted_score === null ? null : (q.score - q.predicted_score).toFixed(2);
            return (
              <tr key={q.id} style={{ borderBottom: `1px solid ${T.border}` }}>
                <td style={{ ...tdStyle, fontWeight: 600 }}>{q.lot_id}</td>
                <td style={tdStyle}>{dt(q.tested_at)}</td>
                <td style={{ ...tdStyle, textAlign: "right" }}>{q.score.toFixed(2)}</td>
                <td style={tdStyle}>
                  <StatusBadge variant={badge.variant} label={badge.label} />
                </td>
                <td style={tdStyle}>{q.model_used}</td>
                <td style={{ ...tdStyle, textAlign: "right" }}>
                  {q.predicted_score === null ? "—" : q.predicted_score.toFixed(2)}
                </td>
                <td style={{ ...tdStyle, textAlign: "right" }}>{err ?? "—"}</td>
                <td style={{ ...tdStyle, textAlign: "right" }}>
                  <button type="button" className="btn" onClick={() => onCertificate(q.lot_id)}>
                    성적서
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── [D] 성적서 ───────────────────────────────────────────────────────────────

/** 응답의 `components` 에 편차가 함께 오면 보여주고, 없으면 `—` 다 (발명하지 않는다) */
type CertComponents = QualityCertificateDto["components"] & {
  sn_deviation?: number;
  ag_deviation?: number;
  cu_deviation?: number;
};

function CertificateModal({
  lotId,
  settings,
  onClose,
}: {
  lotId: string | null;
  settings: PublicSettingsDto | null;
  onClose: () => void;
}) {
  const [cert, setCert] = useState<QualityCertificateDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!lotId) {
      setCert(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setCert(null);
    api
      .getQualityCertificate(lotId)
      .then((c) => {
        if (!cancelled) setCert(c);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const entry = resolveError(err);
        setError(
          entry.status === 404
            ? `${lotId} 의 성적서를 생성할 수 없습니다`
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

  const comp = cert?.components as CertComponents | undefined;
  const badge = cert ? passBadgeFromServer(cert.passed) : null;
  const dev = (v: number | undefined) => (v === undefined ? "—" : v.toFixed(3));

  return (
    <Modal
      open={lotId !== null}
      onClose={onClose}
      title="품질 성적서"
      description={lotId ?? undefined}
      width={640}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            닫기
          </button>
          {/* PDF 라이브러리를 쓰지 않는다 — 브라우저 인쇄다 */}
          <button type="button" className="btn pri" disabled={!cert} onClick={() => window.print()}>
            인쇄
          </button>
        </>
      }
    >
      {/* 로드 완료 전에 빈 양식을 먼저 그리지 않는다 (인쇄 사고 방지) */}
      {loading ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: T.textSub }}>
          <Spinner size="sm" /> 성적서를 불러오는 중
        </div>
      ) : error ? (
        <ErrorAlert message={error} />
      ) : cert ? (
        <div id="certificate-print-area" style={{ fontSize: 13, color: T.text }}>
          <dl style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, margin: 0 }}>
            <CertField label="LOT번호" value={cert.lot_id} />
            <CertField label="생산일자" value={cert.date} />
            <CertField label="공급사" value={cert.supplier} />
          </dl>

          <div style={{ ...certSection }}>성분 분석</div>
          <table style={tableStyle}>
            <thead>
              <tr style={{ background: T.surfaceSubtle }}>
                <th style={thStyle}>성분</th>
                <th style={{ ...thStyle, textAlign: "right" }}>측정값 (%)</th>
                <th style={{ ...thStyle, textAlign: "right" }}>목표값 (%)</th>
                <th style={{ ...thStyle, textAlign: "right" }}>편차 (%p)</th>
              </tr>
            </thead>
            <tbody>
              <tr style={{ borderBottom: `1px solid ${T.border}` }}>
                <td style={tdStyle}>Sn</td>
                <td style={{ ...tdStyle, textAlign: "right" }}>{comp?.sn.toFixed(3)}</td>
                <td style={{ ...tdStyle, textAlign: "right" }}>{settings?.sn_target.toFixed(1) ?? "—"}</td>
                <td style={{ ...tdStyle, textAlign: "right" }}>{dev(comp?.sn_deviation)}</td>
              </tr>
              <tr style={{ borderBottom: `1px solid ${T.border}` }}>
                <td style={tdStyle}>Ag</td>
                <td style={{ ...tdStyle, textAlign: "right" }}>{comp?.ag.toFixed(3)}</td>
                <td style={{ ...tdStyle, textAlign: "right" }}>{settings?.ag_target.toFixed(1) ?? "—"}</td>
                <td style={{ ...tdStyle, textAlign: "right" }}>{dev(comp?.ag_deviation)}</td>
              </tr>
              <tr style={{ borderBottom: `1px solid ${T.border}` }}>
                <td style={tdStyle}>Cu</td>
                <td style={{ ...tdStyle, textAlign: "right" }}>{comp?.cu.toFixed(3)}</td>
                <td style={{ ...tdStyle, textAlign: "right" }}>{settings?.cu_target.toFixed(1) ?? "—"}</td>
                <td style={{ ...tdStyle, textAlign: "right" }}>{dev(comp?.cu_deviation)}</td>
              </tr>
              <tr style={{ borderBottom: `1px solid ${T.border}` }}>
                <td style={tdStyle}>Pb</td>
                <td style={{ ...tdStyle, textAlign: "right" }}>{comp?.pb.toFixed(3)}</td>
                {/* Pb 는 목표값이 정의돼 있지 않다 */}
                <td style={{ ...tdStyle, textAlign: "right" }}>—</td>
                <td style={{ ...tdStyle, textAlign: "right" }}>—</td>
              </tr>
            </tbody>
          </table>

          <div style={certSection}>판정</div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 24, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>
              {cert.score.toFixed(2)}
              <span style={{ fontSize: 13, fontWeight: 500, color: T.textMuted, marginLeft: 4 }}>점</span>
            </span>
            {badge && <StatusBadge variant={badge.variant} label={badge.label} />}
            <span style={{ fontSize: 12, color: T.textSub }}>
              기준: {passScoreOf(settings)}점 이상
            </span>
          </div>

          <p style={{ fontSize: 11.5, color: T.textMuted, margin: "14px 0 0" }}>
            발행일시 {dt(cert.issued_at)}
          </p>
        </div>
      ) : null}
    </Modal>
  );
}

function CertField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt style={{ fontSize: 11, color: T.textMuted, fontWeight: 600 }}>{label}</dt>
      <dd style={{ margin: "2px 0 0", fontWeight: 600 }}>{value}</dd>
    </div>
  );
}

// ─── [E] 등록 ─────────────────────────────────────────────────────────────────

function CreateModal({
  open,
  settings,
  onClose,
  onCreated,
}: {
  open: boolean;
  settings: PublicSettingsDto | null;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [lotId, setLotId] = useState("");
  const [score, setScore] = useState("");
  const [model, setModel] = useState("gradient_boosting");
  const [predicted, setPredicted] = useState("");
  const [models, setModels] = useState<ModelInfo[] | null>(null);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetchModels()
      .then((m) => {
        if (!cancelled) setModels(m);
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setModelsError(err instanceof Error ? err.message : "모델 목록을 불러오지 못했습니다");
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const scoreNum = Number(score);
  const scoreError =
    score === ""
      ? "품질 점수를 입력하세요"
      : !Number.isFinite(scoreNum) || scoreNum < 0 || scoreNum > 100
        ? "품질 점수는 0~100 사이여야 합니다"
        : null;
  const predictedNum = predicted === "" ? null : Number(predicted);
  const predictedError =
    predictedNum !== null && (!Number.isFinite(predictedNum) || predictedNum < 0 || predictedNum > 100)
      ? "예측 점수는 0~100 사이여야 합니다"
      : null;
  const lotError = lotId.trim() === "" ? "LOT 번호를 입력하세요" : null;

  const invalid = Boolean(scoreError || predictedError || lotError);
  // 폼의 판정은 **미리보기**다. 저장되는 값은 서버가 다시 계산한다
  const preview = scoreError ? null : qualityPassBadge(scoreNum, settings);

  const reset = useCallback(() => {
    setLotId("");
    setScore("");
    setPredicted("");
    setModel("gradient_boosting");
    setError(null);
  }, []);

  async function submit() {
    if (invalid) return;
    setSaving(true);
    setError(null);
    try {
      await api.createQuality({
        lot_id: lotId.trim(),
        score: scoreNum,
        model_used: model,
        predicted_score: predictedNum,
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
      title="검사 결과 등록"
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
            {saving ? "저장 중…" : "저장"}
          </button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {error && <ErrorAlert message={error} />}
        {modelsError && <ErrorAlert message={`모델 목록: ${modelsError}`} />}

        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={labelStyle}>LOT 번호 *</span>
          <input
            type="text"
            value={lotId}
            placeholder="LOT-2026-001"
            onChange={(e) => setLotId(e.target.value)}
            style={inputStyle}
          />
          {lotError && <span style={fieldErrorStyle}>{lotError}</span>}
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={labelStyle}>품질 점수 * (0~100)</span>
          <input
            type="number"
            min={0}
            max={100}
            step={0.01}
            value={score}
            onChange={(e) => setScore(e.target.value)}
            style={inputStyle}
          />
          {scoreError && <span style={fieldErrorStyle}>{scoreError}</span>}
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={labelStyle}>사용 모델 *</span>
          <select value={model} onChange={(e) => setModel(e.target.value)} style={inputStyle}>
            {(models ?? []).map((m) => (
              <option key={m.name} value={m.name}>
                {m.name}
              </option>
            ))}
            {models === null && <option value="gradient_boosting">gradient_boosting</option>}
          </select>
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={labelStyle}>예측 점수 (선택)</span>
          <input
            type="number"
            min={0}
            max={100}
            step={0.01}
            value={predicted}
            onChange={(e) => setPredicted(e.target.value)}
            style={inputStyle}
          />
          {predictedError && <span style={fieldErrorStyle}>{predictedError}</span>}
        </label>

        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: T.textSub }}>
          판정 미리보기:
          {preview ? <StatusBadge variant={preview.variant} label={preview.label} /> : <span>—</span>}
          <span>(기준 {passScoreOf(settings)}점 — 저장되는 판정은 서버가 계산합니다)</span>
        </div>
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

const bannerStyle: React.CSSProperties = {
  background: "#FFFBEB",
  border: "1px solid #FCD34D",
  borderRadius: 10,
  padding: "10px 14px",
  fontSize: 12.5,
  color: "#92400E",
};

const certSection: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 700,
  color: T.text,
  margin: "18px 0 8px",
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
