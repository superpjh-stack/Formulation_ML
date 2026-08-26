"use client";

/**
 * FE-RT-14 — 배합비율 최적화 AI · `/mixing/optimize` · FR-M-04
 *
 * 명세: `specs/plan-g1.md` FE-RT-14 · 와이어프레임 **SF-TD3 §3.3** (온도/시간 숫자 입력 /
 * 공급사·모델 드롭다운 / 최적화 범위 읽기전용 / 결과 카드 / 예상 품질 점수 / 수렴 정보).
 *
 * 라운드 2 에서 고친 것 (부록 C 값 오류 포함):
 *   - 🚨 `catch {}` 가 실패를 **`optimization_success: true` 로 위장**하던 것을 제거했다.
 *     실패는 이제 오류 문구로 보이고 결과 카드는 렌더되지 않는다 (goal.md 3절 최악 사례).
 *   - 🚨 모델 드롭다운에서 **`tier !== 'baseline'`** 로 Ridge 를 제외한다.
 *     `name === 'ridge'` 하드코딩이 아니다 — 향후 다른 선형 모델도 걸러야 한다.
 *     서버도 `baseline` 요청을 **400** 으로 거부한다 (이중 방어, api-contract §7.3·§8.4.2).
 *   - 🚨 최적화 범위 표시 `58~66 / 2~4 / 0.3~0.7` → **`55~70` / `1~5` / `0.1~1.5`**
 *     (`COMPONENT_BOUNDS`). 요청 본문에도 `*_bounds` 3종을 명시적으로 실어 보낸다.
 *   - `iterations` / `optimization_success` 로 **수렴 정보 신규 표시** (`24` 하드코딩 없음)
 *   - **합계 행 신규** — FR-M-04 의 `Sn+Ag+Cu+Pb=100%` 제약이 지켜졌음을 보이는 자리다
 *   - 합격 판정: 등급 A/B/C/D 제거 → `qualityPassBadge()` (`RecommendResponse` 에는
 *     `passed` 가 없으므로 합격선과 직접 비교한다). `getQualityBadgeVariant()` 는 쓰지 않는다
 *   - 온도/시간 슬라이더 → **숫자 입력** (SF-TD3 §3.3), 온도 `220~300` → **`200~320`**
 *   - 소수 2자리 → **1자리** (SF-TD3 §3.3 표기)
 *   - `목표 품질점수` 슬라이더 제거 (요청 스키마·SF-TD3 둘 다에 없다)
 *   - `CURRENT_MIX` 하드코딩 비교표 제거 ("현재 배합"의 출처가 없다)
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchModels, fetchRecommendation, ApiError } from "@/lib/api";
import type { ModelInfo, ModelName, RecommendResponse, SupplierName } from "@/types";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { ErrorAlert } from "@/components/ui/ErrorAlert";
import { Spinner } from "@/components/ui/Spinner";
import { T } from "@/components/ui/tokens";
import { usePublicSettings } from "@/hooks/useKoryoData";
import { passScoreOf, qualityPassBadge } from "@/lib/quality";
import { COMPONENT_BOUNDS, MELT_TEMP_RANGE } from "@/types/api";
import {
  CenterBox,
  InlineError,
  PageHeader,
  PageShell,
  SUPPLIER_CODES,
  SettingsFallbackBanner,
  num,
} from "../../_g1/ui";

/** goal.md 2.3 — 합계 허용 오차 */
const SUM_TOLERANCE = 0.05;

/** NFR-P-03 — 초과해도 결과는 표시하되 콘솔 경고 */
const RECOMMEND_BUDGET_MS = 5000;

// ── 결과 성분 카드 (SF-TD3 §3.3 `Sn: 62.3 %` — 소수 1자리) ───────────────────

function RatioRow({
  label,
  value,
  target,
  bounds,
}: {
  label: string;
  value: number;
  /** Pb 에는 목표값이 없다 (goal.md 2.3 은 Sn/Ag/Cu 3종만 정의) */
  target?: number;
  bounds?: readonly [number, number];
}) {
  const outOfBounds = bounds ? value < bounds[0] || value > bounds[1] : false;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        gap: 12,
        padding: "9px 0",
        borderBottom: `1px solid ${T.border}`,
      }}
    >
      <span style={{ fontSize: 13, fontWeight: 600, color: T.textSub, minWidth: 34 }}>{label}</span>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
        {target !== undefined && (
          <span style={{ fontSize: 11, color: T.textMuted }}>목표 {num(target, 1)}%</span>
        )}
        <span
          style={{
            fontSize: 20,
            fontWeight: 800,
            color: outOfBounds ? T.error : T.text,
            fontVariantNumeric: "tabular-nums",
            letterSpacing: "-0.01em",
          }}
        >
          {num(value, 1)}
        </span>
        <span style={{ fontSize: 12, color: T.textMuted }}>%</span>
      </div>
    </div>
  );
}

// ── 페이지 ────────────────────────────────────────────────────────────────────

export default function OptimizePage() {
  const settings = usePublicSettings();
  const passScore = passScoreOf(settings.data?.settings);
  const snTarget = settings.data?.settings.sn_target ?? 62.0;
  const agTarget = settings.data?.settings.ag_target ?? 3.0;
  const cuTarget = settings.data?.settings.cu_target ?? 0.5;

  // 기본값 250 / 45 / SUP_A / GradientBoosting — SF-TD3 §3.3 와이어프레임 값
  const [temp, setTemp] = useState(250);
  const [processTime, setProcessTime] = useState(45);
  const [supplier, setSupplier] = useState<SupplierName>("SUP_A");

  const [models, setModels] = useState<ModelInfo[] | null>(null);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [model, setModel] = useState<ModelName | null>(null);

  const [result, setResult] = useState<RecommendResponse | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<{ status: number; message: string } | null>(null);

  // ── 모델 목록 ───────────────────────────────────────────────────────────────
  const loadModels = useCallback(() => {
    setModelsError(null);
    setModels(null);
    fetchModels()
      .then(setModels)
      .catch((err: unknown) => {
        // 🔴 하드코딩 4종 배열(Ridge 포함)로 대체하지 않는다. 실패는 실패로 보인다.
        setModelsError(err instanceof Error ? err.message : "모델 목록을 불러오지 못했습니다");
      });
  }, []);

  useEffect(loadModels, [loadModels]);

  /**
   * 🚨 `tier: "baseline"` 제외 — 선형 모델은 내부 최적점이 없어 SLSQP 가 경계값
   * (Sn 55 또는 70)으로 튄다. `name === 'ridge'` 로 거르지 않는다.
   */
  const selectableModels = useMemo(
    () => (models ?? []).filter((m) => m.tier !== "baseline"),
    [models]
  );

  useEffect(() => {
    if (selectableModels.length === 0) return;
    if (model && selectableModels.some((m) => m.name === model)) return;
    // 기본 선택은 `active === true`. 'gradient_boosting' 문자열을 하드코딩하지 않는다.
    const serving = selectableModels.find((m) => m.active) ?? selectableModels[0];
    setModel(serving.name as ModelName);
  }, [selectableModels, model]);

  const tempValid = temp >= MELT_TEMP_RANGE[0] && temp <= MELT_TEMP_RANGE[1];
  const timeValid = processTime > 0;
  const canRun = tempValid && timeValid && model !== null && !running;

  async function handleOptimize() {
    if (!model) return;
    setRunning(true);
    setError(null);
    // 다른 조건의 결과로 오독되지 않게 이전 결과를 지운다 (plan-g1 §9)
    setResult(null);
    const started = performance.now();
    try {
      // 경계는 계약값을 **명시적으로** 실어 보낸다 — `src/models/optimize.py` 의
      // DEFAULT_BOUNDS(ag 0~5, cu 0~2)가 계약과 다르기 때문이다 (TODO-FE-001)
      const res = await fetchRecommendation({
        model,
        temperature: temp,
        process_time: processTime,
        supplier,
        sn_bounds: COMPONENT_BOUNDS.sn,
        ag_bounds: COMPONENT_BOUNDS.ag,
        cu_bounds: COMPONENT_BOUNDS.cu,
      });
      const elapsed = performance.now() - started;
      if (elapsed > RECOMMEND_BUDGET_MS) {
        console.warn(`[NFR-P-03] /recommend ${Math.round(elapsed)}ms — 5초 예산 초과`);
      }
      // ⚠ `optimization_success: false` 도 **HTTP 200 이다.** 오류로 처리하지 않는다.
      //    결과 카드를 렌더하고 수렴 정보에 실패를 표시한다 (api-contract §5).
      setResult(res);
    } catch (err) {
      // 🔴 여기에 하드코딩 배합을 넣지 않는다. 실패를 "수렴 성공"으로 위장하던 코드가 있던 자리다.
      setResult(null);
      setError({
        status: err instanceof ApiError ? err.status : 0,
        message: err instanceof Error ? err.message : "최적화 요청에 실패했습니다",
      });
    } finally {
      setRunning(false);
    }
  }

  const errorText =
    error === null
      ? null
      : error.status === 400
        ? "선형 베이스라인 모델은 최적화에 사용할 수 없습니다"
        : error.status === 404
          ? "모델을 찾을 수 없습니다"
          : error.status === 503
            ? "서비스 일시 중단"
            : error.message;

  const ratios = result?.recommended_ratios;
  const sum = ratios ? ratios.sn + ratios.ag + ratios.cu + ratios.pb : null;
  const sumOk = sum === null ? true : Math.abs(sum - 100) <= SUM_TOLERANCE;
  // `RecommendResponse` 에 `passed` 가 없다 → 합격선과 직접 비교한다 (plan-g1 §6.1)
  const passBadge = result ? qualityPassBadge(result.predicted_quality, settings.data?.settings) : null;

  const boundsRows = [
    { label: "Sn", bounds: COMPONENT_BOUNDS.sn },
    { label: "Ag", bounds: COMPONENT_BOUNDS.ag },
    { label: "Cu", bounds: COMPONENT_BOUNDS.cu },
  ] as const;

  return (
    <PageShell>
      <PageHeader
        title="배합비율 최적화 AI"
        subtitle="공정 조건 입력 → scipy SLSQP 최적 배합비율 자동 추천 (FR-M-04 · 응답 5초 이내)"
      />

      <SettingsFallbackBanner settings={settings.data} />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, alignItems: "start" }}>
        {/* ── 좌: 공정 조건 입력 ───────────────────────────────────────────── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="card" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: T.text }}>공정 조건 입력</span>

            {/* SF-TD3 §3.3 은 슬라이더가 아니라 숫자 입력이다 */}
            <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: T.textSub }}>용해 온도 (°C)</span>
              <input
                type="number"
                value={temp}
                min={MELT_TEMP_RANGE[0]}
                max={MELT_TEMP_RANGE[1]}
                step={1}
                onChange={(e) => {
                  const v = parseFloat(e.target.value);
                  if (Number.isFinite(v)) setTemp(v);
                }}
                style={{
                  height: 36,
                  padding: "0 10px",
                  borderRadius: 8,
                  border: `1px solid ${tempValid ? T.border : T.error}`,
                  fontSize: 14,
                  fontWeight: 600,
                  fontFamily: "inherit",
                  fontVariantNumeric: "tabular-nums",
                }}
              />
              {tempValid ? (
                <span style={{ fontSize: 10.5, color: T.textMuted }}>
                  허용 {MELT_TEMP_RANGE[0]} ~ {MELT_TEMP_RANGE[1]}°C
                </span>
              ) : (
                <span style={{ fontSize: 11, color: T.error, fontWeight: 600 }}>
                  용해 온도는 {MELT_TEMP_RANGE[0]} ~ {MELT_TEMP_RANGE[1]}°C 범위여야 합니다
                </span>
              )}
            </label>

            <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: T.textSub }}>처리 시간 (분)</span>
              <input
                type="number"
                value={processTime}
                min={1}
                step={1}
                onChange={(e) => {
                  const v = parseFloat(e.target.value);
                  if (Number.isFinite(v)) setProcessTime(v);
                }}
                style={{
                  height: 36,
                  padding: "0 10px",
                  borderRadius: 8,
                  border: `1px solid ${timeValid ? T.border : T.error}`,
                  fontSize: 14,
                  fontWeight: 600,
                  fontFamily: "inherit",
                  fontVariantNumeric: "tabular-nums",
                }}
              />
              <span style={{ fontSize: 10.5, color: T.textMuted }}>계약에 범위 정의 없음</span>
            </label>

            <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: T.textSub }}>공급사 선택</span>
              <select
                value={supplier}
                onChange={(e) => setSupplier(e.target.value as SupplierName)}
                style={{
                  height: 36,
                  padding: "0 10px",
                  borderRadius: 8,
                  border: `1px solid ${T.border}`,
                  fontSize: 14,
                  fontWeight: 600,
                  background: T.surface,
                  fontFamily: "inherit",
                }}
              >
                {SUPPLIER_CODES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>

            {/* 사용 모델 — 드롭다운. Ridge(baseline)는 목록에 없다 */}
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: T.textSub }}>사용 모델</span>
              {modelsError ? (
                <InlineError
                  message={`모델 목록을 불러오지 못했습니다 — ${modelsError}`}
                  onRetry={loadModels}
                />
              ) : models === null ? (
                <CenterBox minHeight={48}>
                  <Spinner size="sm" />
                </CenterBox>
              ) : selectableModels.length === 0 ? (
                <span style={{ fontSize: 12.5, color: T.error }}>
                  최적화에 사용할 수 있는 모델이 없습니다 (선형 베이스라인은 제외됩니다)
                </span>
              ) : (
                <>
                  <select
                    value={model ?? ""}
                    onChange={(e) => setModel(e.target.value as ModelName)}
                    style={{
                      height: 36,
                      padding: "0 10px",
                      borderRadius: 8,
                      border: `1px solid ${T.border}`,
                      fontSize: 14,
                      fontWeight: 600,
                      background: T.surface,
                      fontFamily: "inherit",
                    }}
                  >
                    {selectableModels.map((m) => (
                      <option key={m.name} value={m.name}>
                        {m.display_name}
                      </option>
                    ))}
                  </select>
                  <span style={{ fontSize: 10.5, color: T.textMuted }}>
                    선형 베이스라인(tier=baseline) 모델은 SLSQP 가 경계값으로 튀어 제외됩니다
                  </span>
                </>
              )}
            </div>
          </div>

          {/* 최적화 범위 — SF-TD3 §3.3 은 값만 나열한다. 입력 컨트롤이 아니다 */}
          <div className="card" style={{ background: T.surfaceSubtle }}>
            <div
              style={{
                fontSize: 12,
                fontWeight: 700,
                color: T.textSub,
                marginBottom: 10,
                letterSpacing: "0.03em",
                textTransform: "uppercase",
              }}
            >
              최적화 범위 설정 (읽기 전용)
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {boundsRows.map(({ label, bounds }) => (
                <div
                  key={label}
                  style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}
                >
                  <span style={{ fontSize: 12, fontWeight: 700, color: T.primary, minWidth: 28 }}>
                    {label}
                  </span>
                  <span
                    style={{ fontSize: 12.5, color: T.text, fontVariantNumeric: "tabular-nums" }}
                  >
                    {bounds[0]}% ~ {bounds[1]}%
                  </span>
                </div>
              ))}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: T.textMuted, minWidth: 28 }}>
                  Pb
                </span>
                <span style={{ fontSize: 12, color: T.textMuted }}>잔량 (합계 100% 기준)</span>
              </div>
            </div>
          </div>

          <button
            type="button"
            className="btn pri"
            onClick={handleOptimize}
            disabled={!canRun}
            style={{ width: "100%", justifyContent: "center", padding: "12px 0", fontSize: 14 }}
          >
            {running ? "최적화 중…" : "최적 배합 추천"}
          </button>
          {!canRun && !running && (
            <span style={{ fontSize: 11.5, color: T.textMuted, textAlign: "center" }}>
              {model === null
                ? "모델 목록을 불러오지 못해 최적화를 실행할 수 없습니다"
                : "공정 조건이 허용 범위를 벗어났습니다"}
            </span>
          )}
        </div>

        {/* ── 우: 최적화 결과 ──────────────────────────────────────────────── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {errorText && <ErrorAlert message={errorText} />}

          {running ? (
            <div className="card">
              <CenterBox minHeight={420}>
                <Spinner size="lg" />
              </CenterBox>
            </div>
          ) : result && ratios && passBadge ? (
            <>
              {/* 최적 배합비율 + 합계 */}
              <div className="card" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: T.text, marginBottom: 6 }}>
                  최적 배합비율
                </span>
                <RatioRow label="Sn" value={ratios.sn} target={snTarget} bounds={COMPONENT_BOUNDS.sn} />
                <RatioRow label="Ag" value={ratios.ag} target={agTarget} bounds={COMPONENT_BOUNDS.ag} />
                <RatioRow label="Cu" value={ratios.cu} target={cuTarget} bounds={COMPONENT_BOUNDS.cu} />
                <RatioRow label="Pb" value={ratios.pb} bounds={COMPONENT_BOUNDS.pb} />
                <div
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    justifyContent: "space-between",
                    paddingTop: 10,
                  }}
                >
                  <span style={{ fontSize: 13, fontWeight: 700, color: T.text }}>합계</span>
                  <span
                    style={{
                      fontSize: 18,
                      fontWeight: 800,
                      color: sumOk ? "#15803D" : T.error,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {num(sum, 1)}% {sumOk ? "" : "⚠"}
                  </span>
                </div>
                {!sumOk && (
                  <span style={{ fontSize: 11.5, color: T.error }}>
                    합계가 100%가 아닙니다 — 서버 최적화 결과를 확인하세요
                  </span>
                )}
              </div>

              {/* 예상 품질 점수 + 합격 예상 */}
              <div
                className="card"
                style={{
                  background: "linear-gradient(135deg, #3A5BD9 0%, #6B8AFF 100%)",
                  border: "none",
                  padding: "20px 24px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 16,
                }}
              >
                <div>
                  <div
                    style={{
                      fontSize: 11.5,
                      fontWeight: 600,
                      color: "rgba(255,255,255,0.75)",
                      letterSpacing: "0.05em",
                      textTransform: "uppercase",
                      marginBottom: 6,
                    }}
                  >
                    예상 품질 점수
                  </div>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                    <span
                      style={{
                        fontSize: 40,
                        fontWeight: 800,
                        color: "#fff",
                        letterSpacing: "-0.03em",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {num(result.predicted_quality, 1)}
                    </span>
                    <span style={{ fontSize: 16, color: "rgba(255,255,255,0.75)" }}>점</span>
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
                  {/* 🚨 합격선과 직접 비교. `getQualityBadgeVariant()` 는 69.9 와 70.0 을 같게 그린다 */}
                  <StatusBadge variant={passBadge.variant} label={`${passBadge.label} 예상`} dot />
                  <span style={{ fontSize: 11.5, color: "rgba(255,255,255,0.75)" }}>
                    기준: {passScore}점 이상
                  </span>
                </div>
              </div>

              {/* 수렴 정보 — `optimization_success:false` 도 HTTP 200 이다 */}
              <div className="card" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: T.text }}>최적화 수렴 정보</span>
                <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 13, color: T.text }}>
                    반복: <strong style={{ fontVariantNumeric: "tabular-nums" }}>{result.iterations}</strong>회
                  </span>
                  <span style={{ fontSize: 13, color: T.text, display: "inline-flex", alignItems: "center", gap: 6 }}>
                    수렴:
                    <StatusBadge
                      variant={result.optimization_success ? "green" : "red"}
                      label={result.optimization_success ? "✅ 성공" : "❌ 실패"}
                    />
                  </span>
                  <span style={{ fontSize: 12, color: T.textSub }}>사용 모델: {model}</span>
                </div>
                {result.message && (
                  <span style={{ fontSize: 12.5, color: T.textSub, lineHeight: 1.6 }}>
                    {result.message}
                  </span>
                )}
                {!result.optimization_success && (
                  <span style={{ fontSize: 12, color: T.error, lineHeight: 1.6 }}>
                    최적화가 수렴하지 않았습니다. 위 배합비율은 최적해가 아닐 수 있으니 공정 조건을
                    바꿔 다시 실행하세요.
                  </span>
                )}
              </div>
            </>
          ) : (
            <div className="card">
              <CenterBox minHeight={420}>
                <span style={{ fontSize: 13, color: T.textMuted }}>
                  조건 설정 후 최적 배합 추천을 누르세요
                </span>
              </CenterBox>
            </div>
          )}
        </div>
      </div>
    </PageShell>
  );
}
