"use client";

/**
 * FE-RT-13 — 품질 예측 (ML 모델) · `/mixing/predict` · FR-M-03
 *
 * 명세: `specs/plan-g1.md` FE-RT-13 · 와이어프레임 **SF-TD3 §3.2** (라디오 4개 / 슬라이더 /
 * 합계 실시간 / 점수 카드 / 합격 표시 / 성분 편차 / 모델 정보 — 체크리스트 7항목).
 *
 * 라운드 2 에서 고친 것 (부록 C 값 오류 포함):
 *   - `MODEL_NAMES` 하드코딩 폴백 제거 → `GET /models` 실패 시 **버튼 비활성** (BUG-002 회귀 방지)
 *   - 모델 선택 드롭다운 → **라디오 4개** + `display_name`/`tier`/`active` 반영
 *   - **합격 판정 신규** — 서버 `passed` 를 `passBadgeFromServer()` 로 그린다.
 *     `getQualityBadgeVariant()` 는 69.9 와 70.0 을 같은 색으로 그리므로 **쓰지 않는다**
 *   - 성분 편차: 프론트 상대% 계산(3%/5%) 제거 → **서버 `deviations`** 그대로
 *   - Ag 범위 `0~6` → **1~5** · Cu `0~2` → **0.1~1.5** · 온도 `220~300` → **200~320**
 *   - 합계 판정 `<0.5` → **`<=0.05`**, 위반 시 `예측하기` **disabled** (이중 방어)
 *   - 모델 정보(RMSE/R²) 신규 — **API 값**이다. SF-TD3 의 `3.05/0.627` 은 낡은 예시값이다
 *   - 파일 상단 `SN_TARGET` 등 재정의 제거 → `/settings/public` · `types/api.ts`
 *   - 성분 레이더 차트 제거 (SF-TD3 §3.2 에 없고 정규화 기준이 임의값이었다)
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchModels, fetchPrediction, ApiError } from "@/lib/api";
import type { ModelInfo, ModelName, PredictResponse, SupplierName } from "@/types";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { ErrorAlert } from "@/components/ui/ErrorAlert";
import { Spinner } from "@/components/ui/Spinner";
import { T } from "@/components/ui/tokens";
import { readTokens } from "@/lib/tokens";
import { usePublicSettings } from "@/hooks/useKoryoData";
import { passBadgeFromServer, passScoreOf } from "@/lib/quality";
import { COMPONENT_BOUNDS, MELT_TEMP_RANGE } from "@/types/api";
import {
  CenterBox,
  InlineError,
  PageHeader,
  PageShell,
  SUPPLIER_CODES,
  SettingsFallbackBanner,
  num,
  signed,
} from "../../_g1/ui";

/** SF-TD3 §3.2 라디오 순서 — 목록 응답 순서가 아니라 이 순서로 그린다 */
const MODEL_ORDER: ModelName[] = ["gradient_boosting", "random_forest", "xgboost", "ridge"];

/** goal.md 2.3 — 합계 허용 오차. 화면에 숫자를 다시 쓰지 않도록 여기 한 번만 둔다 */
const SUM_TOLERANCE = 0.05;

/** NFR-P-02 — 초과해도 결과는 표시하되 콘솔 경고 */
const PREDICT_BUDGET_MS = 3000;

// ── 슬라이더 (SF-TD3 §3.2 체크리스트 2 — 슬라이더 + 숫자 입력) ────────────────

function SliderInput({
  label,
  value,
  min,
  max,
  step,
  unit,
  target,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  /** 목표값 병기. Pb 에는 목표값이 없다 (goal.md 2.3 은 Sn/Ag/Cu 3종만 정의) */
  target?: number;
  onChange: (v: number) => void;
}) {
  const filled = ((value - min) / (max - min)) * 100;
  const out = value < min || value > max;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <label style={{ fontSize: 12, fontWeight: 600, color: T.textSub, letterSpacing: "0.02em" }}>
          {label}
        </label>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <input
            type="number"
            value={value}
            min={min}
            max={max}
            step={step}
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              if (Number.isFinite(v)) onChange(v);
            }}
            style={{
              width: 72,
              padding: "3px 8px",
              fontSize: 13,
              fontWeight: 700,
              color: T.text,
              border: `1px solid ${out ? T.error : T.border}`,
              borderRadius: 6,
              textAlign: "right",
              fontVariantNumeric: "tabular-nums",
              outline: "none",
            }}
          />
          <span style={{ fontSize: 12, color: T.textMuted, minWidth: 22 }}>{unit}</span>
        </div>
      </div>
      <div style={{ position: "relative", height: 6 }}>
        <div style={{ position: "absolute", inset: 0, borderRadius: 3, background: T.border }} />
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: `${Math.max(0, Math.min(100, filled))}%`,
            borderRadius: 3,
            background: "linear-gradient(90deg, #6B8AFF, #3A5BD9)",
          }}
        />
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={Math.max(min, Math.min(max, value))}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            opacity: 0,
            cursor: "pointer",
            height: "100%",
          }}
        />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, color: T.textMuted }}>
        <span>
          허용 {min} ~ {max}
          {unit}
        </span>
        {target !== undefined && <span>목표값: {target}{unit}</span>}
      </div>
      {out && (
        <span style={{ fontSize: 11, color: T.error, fontWeight: 600 }}>
          허용 범위({min} ~ {max}{unit})를 벗어났습니다
        </span>
      )}
    </div>
  );
}

// ── 점수 게이지 (합격선 마커 포함) ───────────────────────────────────────────

/**
 * 예상 품질 점수 표시 문자열.
 *
 * 소수 1자리로 반올림하면 **합격선을 건너뛴다.** 실측 사례(QA-A D-03):
 * 서버가 `69.977 / passed:false` 를 줬는데 화면은 `70.0 점` + `불합격` 배지를 함께 띄웠다.
 * 판정 자체는 서버 `passed` 라 옳았지만, 숫자만 보면 "70점인데 왜 불합격이냐" 가 된다.
 *
 * 반올림 결과가 판정과 어긋나면 **자리수를 늘려** 실제 값을 그대로 보여준다.
 * 숫자를 판정에 맞춰 왜곡하지 않는다 — 어긋난 쪽은 표시 정밀도이지 값이 아니다.
 */
function displayScore(score: number, passScore: number, passed: boolean): string {
  if (!Number.isFinite(score)) return "—";
  for (const digits of [1, 2, 3]) {
    const shown = Number(score.toFixed(digits));
    if (shown >= passScore === passed) return score.toFixed(digits);
  }
  return String(score);
}

function QualityGauge({ score, passScore, passed }: { score: number; passScore: number; passed: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const W = 220;
    const H = 128;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.scale(dpr, dpr);
    const TK = readTokens();
    const cx = W / 2;
    const cy = H - 12;
    const r = 86;

    // 트랙
    ctx.beginPath();
    ctx.arc(cx, cy, r, Math.PI, 2 * Math.PI);
    ctx.lineWidth = 14;
    // canvas 는 `var()` 를 무시하고 검정으로 칠한다 → 실행 시점에 토큰을 해석해 쓴다
    ctx.strokeStyle = TK.border;
    ctx.lineCap = "round";
    ctx.stroke();

    // 🔴 색은 **합격 여부 2값**이다. 등급 4단계(90/80/70)를 섞지 않는다.
    const color = passed ? "#16A34A" : "#DC2626";
    const ratio = Math.max(0, Math.min(score / 100, 1));
    const end = Math.PI + ratio * Math.PI;
    ctx.beginPath();
    ctx.arc(cx, cy, r, Math.PI, end);
    ctx.lineWidth = 14;
    ctx.strokeStyle = color;
    ctx.lineCap = "round";
    ctx.stroke();

    // 합격선 마커 — 값은 `/settings/public` 에서 온다
    const pa = Math.PI + Math.max(0, Math.min(passScore / 100, 1)) * Math.PI;
    ctx.beginPath();
    ctx.moveTo(cx + (r - 11) * Math.cos(pa), cy + (r - 11) * Math.sin(pa));
    ctx.lineTo(cx + (r + 11) * Math.cos(pa), cy + (r + 11) * Math.sin(pa));
    ctx.strokeStyle = TK.text;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = "#687182";
    ctx.font = "600 10px -apple-system, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(`${passScore}`, cx + (r + 22) * Math.cos(pa), cy + (r + 22) * Math.sin(pa) + 3);
  }, [score, passScore, passed]);

  return <canvas ref={canvasRef} style={{ width: 220, height: 128, display: "block" }} />;
}

// ── 페이지 ────────────────────────────────────────────────────────────────────

export default function PredictPage() {
  const settings = usePublicSettings();
  const passScore = passScoreOf(settings.data?.settings);
  const snTarget = settings.data?.settings.sn_target ?? 62.0;
  const agTarget = settings.data?.settings.ag_target ?? 3.0;
  const cuTarget = settings.data?.settings.cu_target ?? 0.5;

  // 기본값 62.0 / 3.0 / 0.5 / 34.5 — SF-TD3 §3.2 와이어프레임 값이며 합계가 정확히 100.0 이다
  const [sn, setSn] = useState(62.0);
  const [ag, setAg] = useState(3.0);
  const [cu, setCu] = useState(0.5);
  const [pb, setPb] = useState(34.5);
  const [temp, setTemp] = useState(250);
  const [processTime, setProcessTime] = useState(45);
  const [supplier, setSupplier] = useState<SupplierName>("SUP_A");

  const [models, setModels] = useState<ModelInfo[] | null>(null);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [model, setModel] = useState<ModelName | null>(null);

  const [result, setResult] = useState<PredictResponse | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<{ status: number; message: string } | null>(null);

  // ── 모델 목록 — 유일한 출처는 `GET /models` 다 (BUG-002) ────────────────────
  const loadModels = useCallback(() => {
    setModelsError(null);
    setModels(null);
    fetchModels()
      .then((list) => {
        setModels(list);
        // 기본 선택은 `active === true` 인 모델. 'gradient_boosting' 을 하드코딩하지 않는다 —
        // 재학습으로 서빙 모델이 바뀌면 화면이 틀린다.
        const serving = list.find((m) => m.active) ?? list[0];
        if (serving) setModel(serving.name as ModelName);
      })
      .catch((err: unknown) => {
        // 🔴 하드코딩 4종 배열로 대체하지 않는다. 실패는 실패로 보인다.
        setModelsError(err instanceof Error ? err.message : "모델 목록을 불러오지 못했습니다");
      });
  }, []);

  useEffect(loadModels, [loadModels]);

  /** SF-TD3 §3.2 순서로 정렬. 응답에 없는 이름은 그대로 뒤에 붙인다 */
  const orderedModels = useMemo(() => {
    if (!models) return [];
    const rank = (n: string) => {
      const i = MODEL_ORDER.indexOf(n as ModelName);
      return i === -1 ? MODEL_ORDER.length : i;
    };
    return [...models].sort((a, b) => rank(a.name) - rank(b.name));
  }, [models]);

  const selected = models?.find((m) => m.name === model) ?? null;

  const total = sn + ag + cu + pb;
  const sumOk = Math.abs(total - 100) <= SUM_TOLERANCE;

  const inBounds =
    sn >= COMPONENT_BOUNDS.sn[0] &&
    sn <= COMPONENT_BOUNDS.sn[1] &&
    ag >= COMPONENT_BOUNDS.ag[0] &&
    ag <= COMPONENT_BOUNDS.ag[1] &&
    cu >= COMPONENT_BOUNDS.cu[0] &&
    cu <= COMPONENT_BOUNDS.cu[1] &&
    pb >= COMPONENT_BOUNDS.pb[0] &&
    pb <= COMPONENT_BOUNDS.pb[1] &&
    temp >= MELT_TEMP_RANGE[0] &&
    temp <= MELT_TEMP_RANGE[1] &&
    processTime > 0;

  const canPredict = sumOk && inBounds && model !== null && !running;

  async function handlePredict() {
    if (!model) return;
    setRunning(true);
    setError(null);
    // 직전 조건의 결과가 새 조건의 결과로 오독되지 않게 지운다 (plan-g1 §9)
    setResult(null);
    const started = performance.now();
    try {
      const res = await fetchPrediction({
        model,
        sn_ratio: sn,
        ag_ratio: ag,
        cu_ratio: cu,
        pb_ratio: pb,
        temperature: temp,
        process_time: processTime,
        supplier,
      });
      const elapsed = performance.now() - started;
      if (elapsed > PREDICT_BUDGET_MS) {
        console.warn(`[NFR-P-02] /predict ${Math.round(elapsed)}ms — 3초 예산 초과`);
      }
      setResult(res);
    } catch (err) {
      // 🔴 `catch {}` 로 하드코딩 결과를 끼워넣지 않는다 (goal.md 3절).
      setResult(null);
      setError({
        status: err instanceof ApiError ? err.status : 0,
        message: err instanceof Error ? err.message : "예측 요청에 실패했습니다",
      });
    } finally {
      setRunning(false);
    }
  }

  const passBadge = result ? passBadgeFromServer(result.passed) : null;
  // 모델 정보는 **선택한 모델**을 따라간다. 결과가 그 모델의 것이면 응답값을 쓴다.
  const metrics =
    result && result.model_used === model ? result.model_metrics : selected?.metrics ?? null;

  const errorText =
    error === null
      ? null
      : error.status === 422
        ? "성분 합계는 100%여야 합니다"
        : error.status === 404
          ? "모델을 찾을 수 없습니다"
          : error.status === 503
            ? "서비스 일시 중단"
            : error.message;

  return (
    <PageShell>
      <PageHeader
        title="품질 예측 (ML 모델)"
        subtitle="배합비율·공정 조건 입력 → ML 모델 기반 품질 점수 예측 (FR-M-03 · 응답 3초 이내)"
      />

      <SettingsFallbackBanner settings={settings.data} />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, alignItems: "start" }}>
        {/* ── 좌: 배합비율 입력 ────────────────────────────────────────────── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* 모델 선택 — SF-TD3 §3.2 는 드롭다운이 아니라 라디오 4개다 */}
          <div className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: T.text }}>모델 선택</span>

            {modelsError ? (
              <InlineError message={`모델 목록을 불러오지 못했습니다 — ${modelsError}`} onRetry={loadModels} />
            ) : models === null ? (
              <CenterBox minHeight={120}>
                <Spinner size="md" />
              </CenterBox>
            ) : orderedModels.length === 0 ? (
              <span style={{ fontSize: 12.5, color: T.textMuted }}>사용 가능한 모델이 없습니다</span>
            ) : (
              <div role="radiogroup" aria-label="모델 선택" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {orderedModels.map((m) => {
                  const active = m.name === model;
                  return (
                    <label
                      key={m.name}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        padding: "9px 12px",
                        borderRadius: 8,
                        border: `1px solid ${active ? T.primary : T.border}`,
                        background: active ? "#EEF1FD" : T.surface,
                        cursor: "pointer",
                      }}
                    >
                      <input
                        type="radio"
                        name="predict-model"
                        value={m.name}
                        checked={active}
                        onChange={() => setModel(m.name as ModelName)}
                        style={{ accentColor: "#3A5BD9" }}
                      />
                      <span style={{ fontSize: 13, fontWeight: 600, color: T.text, flex: 1 }}>
                        {m.display_name}
                      </span>
                      {/* baseline 은 성능이 낮다는 사실을 회색 보조 텍스트로 병기한다 (api-contract §7.3) */}
                      {m.tier === "baseline" && (
                        <span style={{ fontSize: 11, color: T.textMuted }}>R² {num(m.metrics.r2, 2)}</span>
                      )}
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          {/* 성분 비율 */}
          <div className="card" style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: T.text }}>배합비율 입력</span>
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  color: sumOk ? "#15803D" : "#B91C1C",
                  background: sumOk ? "#ECFDF3" : "#FEF1F2",
                  padding: "3px 10px",
                  borderRadius: 20,
                }}
              >
                합계: {total.toFixed(1)}% {sumOk ? "✅" : "⚠"}
              </span>
            </div>

            <SliderInput
              label="Sn 비율 (%)"
              value={sn}
              min={COMPONENT_BOUNDS.sn[0]}
              max={COMPONENT_BOUNDS.sn[1]}
              step={0.1}
              unit="%"
              target={snTarget}
              onChange={setSn}
            />
            <SliderInput
              label="Ag 비율 (%)"
              value={ag}
              min={COMPONENT_BOUNDS.ag[0]}
              max={COMPONENT_BOUNDS.ag[1]}
              step={0.1}
              unit="%"
              target={agTarget}
              onChange={setAg}
            />
            <SliderInput
              label="Cu 비율 (%)"
              value={cu}
              min={COMPONENT_BOUNDS.cu[0]}
              max={COMPONENT_BOUNDS.cu[1]}
              step={0.05}
              unit="%"
              target={cuTarget}
              onChange={setCu}
            />
            {/* Pb 에는 목표값이 없다 — 잔량이다 */}
            <SliderInput
              label="Pb 비율 (%)"
              value={pb}
              min={COMPONENT_BOUNDS.pb[0]}
              max={COMPONENT_BOUNDS.pb[1]}
              step={0.1}
              unit="%"
              onChange={setPb}
            />

            {!sumOk && (
              <span style={{ fontSize: 12, color: T.error, fontWeight: 600 }}>
                성분 합계는 100%여야 합니다 (허용 오차 ±{SUM_TOLERANCE})
              </span>
            )}
          </div>

          {/* 공정 조건 — SF-TD3 §3.2 와이어프레임에는 없지만 `PredictRequest` 필수 필드다 */}
          <div className="card" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: T.text }}>공정 조건</span>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
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
                    height: 34,
                    padding: "0 10px",
                    borderRadius: 8,
                    border: `1px solid ${temp < MELT_TEMP_RANGE[0] || temp > MELT_TEMP_RANGE[1] ? T.error : T.border}`,
                    fontSize: 13,
                    fontFamily: "inherit",
                  }}
                />
                <span style={{ fontSize: 10.5, color: T.textMuted }}>
                  {MELT_TEMP_RANGE[0]} ~ {MELT_TEMP_RANGE[1]}°C
                </span>
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
                    height: 34,
                    padding: "0 10px",
                    borderRadius: 8,
                    border: `1px solid ${processTime > 0 ? T.border : T.error}`,
                    fontSize: 13,
                    fontFamily: "inherit",
                  }}
                />
                <span style={{ fontSize: 10.5, color: T.textMuted }}>계약에 범위 없음</span>
              </label>

              <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: T.textSub }}>공급사</span>
                <select
                  value={supplier}
                  onChange={(e) => setSupplier(e.target.value as SupplierName)}
                  style={{
                    height: 34,
                    padding: "0 10px",
                    borderRadius: 8,
                    border: `1px solid ${T.border}`,
                    fontSize: 13,
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
            </div>
          </div>

          <button
            type="button"
            className="btn pri"
            onClick={handlePredict}
            disabled={!canPredict}
            style={{ width: "100%", justifyContent: "center", padding: "12px 0", fontSize: 14 }}
          >
            {running ? "예측 중…" : "예측하기"}
          </button>
          {!canPredict && !running && (
            <span style={{ fontSize: 11.5, color: T.textMuted, textAlign: "center" }}>
              {model === null
                ? "모델 목록을 불러오지 못해 예측을 실행할 수 없습니다"
                : !sumOk
                  ? "성분 합계가 100%가 아니면 요청을 보내지 않습니다"
                  : "입력값이 허용 범위를 벗어났습니다"}
            </span>
          )}
        </div>

        {/* ── 우: 예측 결과 ────────────────────────────────────────────────── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {errorText && <ErrorAlert message={errorText} />}

          {running ? (
            <div className="card">
              <CenterBox minHeight={380}>
                <Spinner size="lg" />
              </CenterBox>
            </div>
          ) : result && passBadge ? (
            <>
              <div
                className="card"
                style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, padding: "24px 20px" }}
              >
                <span style={{ fontSize: 13, fontWeight: 700, color: T.text, alignSelf: "flex-start" }}>
                  예상 품질 점수
                </span>
                <QualityGauge score={result.predicted_quality} passScore={passScore} passed={result.passed} />
                <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: -14 }}>
                  <span
                    style={{
                      fontSize: 40,
                      fontWeight: 800,
                      color: T.text,
                      letterSpacing: "-0.03em",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {displayScore(result.predicted_quality, passScore, result.passed)}
                  </span>
                  <span style={{ fontSize: 15, color: T.textMuted }}>점</span>
                </div>

                {/* 🚨 합격 판정 — 서버 `passed`. 69.9 와 70.0 이 다른 색·다른 문구로 그려진다 */}
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <StatusBadge variant={passBadge.variant} label={passBadge.label} dot />
                  <span style={{ fontSize: 12, color: T.textSub }}>(기준: {passScore}점 이상)</span>
                </div>

                <span style={{ fontSize: 11.5, color: T.textMuted }}>
                  사용 모델: <strong style={{ color: T.textSub }}>{result.model_used}</strong>
                </span>
              </div>

              {/* 성분 편차 — 서버 계산값. 프론트에서 `- 62.0` 을 하지 않는다 */}
              <div className="card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: T.text }}>성분 편차</span>
                {(
                  [
                    { key: "Sn", dev: result.deviations.sn, target: snTarget },
                    { key: "Ag", dev: result.deviations.ag, target: agTarget },
                    { key: "Cu", dev: result.deviations.cu, target: cuTarget },
                  ] as const
                ).map(({ key, dev, target }) => (
                  <div
                    key={key}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      fontSize: 13,
                      color: T.text,
                    }}
                  >
                    <span>
                      <strong>{key}</strong>: {signed(dev, 1)}%
                    </span>
                    <span style={{ fontSize: 12, color: T.textMuted }}>(목표: {num(target, 1)}%)</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="card">
              <CenterBox minHeight={380}>
                <span style={{ fontSize: 13, color: T.textMuted }}>
                  성분 조건 입력 후 예측하기를 누르세요
                </span>
              </CenterBox>
            </div>
          )}

          {/* 모델 정보 — 선택한 모델을 따라간다. 숫자를 TSX 에 쓰지 않는다 */}
          <div className="card" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: T.text }}>모델 정보</span>
            {metrics ? (
              <>
                <span style={{ fontSize: 13, color: T.text, fontVariantNumeric: "tabular-nums" }}>
                  RMSE: {num(metrics.rmse, 2)} / R²: {num(metrics.r2, 4)}
                </span>
                <span style={{ fontSize: 11, color: T.textMuted }}>
                  MAE {num(metrics.mae, 2)} · MAPE {num(metrics.mape, 2)}% · (합성 시드 데이터 기준)
                </span>
              </>
            ) : (
              <span style={{ fontSize: 12.5, color: T.textMuted }}>
                모델을 선택하면 성능 지표가 표시됩니다
              </span>
            )}
          </div>
        </div>
      </div>
    </PageShell>
  );
}
