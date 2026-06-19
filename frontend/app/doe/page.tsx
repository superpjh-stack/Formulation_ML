"use client";

import { useEffect, useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ScatterChart,
  Scatter,
  ReferenceLine,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { ErrorAlert } from "@/components/ui/ErrorAlert";
import {
  fetchDoeMethods,
  createDesign,
  simulateDoe,
  analyzeDoe,
  optimizeDoe,
} from "@/lib/doe-api";
import type {
  DoeMethodKey,
  DoeMethodMeta,
  FactorSpec,
  DesignResponse,
  SimulateResponse,
  AnalyzeResponse,
  OptimizeResponse,
} from "@/types/doe";

// ── 상수 ────────────────────────────────────────────────────────────────────

type TabKey = "design" | "simulate" | "analyze" | "optimize";

const TABS: { key: TabKey; label: string }[] = [
  { key: "design", label: "1. 설계" },
  { key: "simulate", label: "2. 시뮬레이션" },
  { key: "analyze", label: "3. 분석" },
  { key: "optimize", label: "4. 최적화" },
];

const DEFAULT_FACTORS: Record<string, FactorSpec> = {
  sn_pct: { min: 58, max: 68, levels: 3 },
  ag_pct: { min: 2, max: 4, levels: 3 },
  cu_pct: { min: 0.3, max: 0.7, levels: 3 },
};

const MODEL_OPTIONS = ["gradient_boosting", "random_forest", "xgboost", "ridge"];
const SUPPLIER_OPTIONS = ["SUP_A", "SUP_B", "SUP_C"] as const;

// ── 유틸 ────────────────────────────────────────────────────────────────────

function fmt(n: number | null | undefined, digits = 3) {
  if (n == null) return "—";
  return n.toFixed(digits);
}

// ── 컴포넌트 ─────────────────────────────────────────────────────────────────

export default function DoePage() {
  const [tab, setTab] = useState<TabKey>("design");

  // ── 설계 탭 상태
  const [methods, setMethods] = useState<Record<DoeMethodKey, DoeMethodMeta> | null>(null);
  const [methodsError, setMethodsError] = useState<string | null>(null);
  const [selectedMethod, setSelectedMethod] = useState<DoeMethodKey>("ccd");
  const [factors, setFactors] = useState<Record<string, FactorSpec>>(DEFAULT_FACTORS);
  const [designResult, setDesignResult] = useState<DesignResponse | null>(null);
  const [designLoading, setDesignLoading] = useState(false);
  const [designError, setDesignError] = useState<string | null>(null);

  // ── 시뮬레이션 탭 상태
  const [simModel, setSimModel] = useState("gradient_boosting");
  const [simSupplier, setSimSupplier] = useState<"SUP_A" | "SUP_B" | "SUP_C">("SUP_A");
  const [simTemp, setSimTemp] = useState(250);
  const [simTime, setSimTime] = useState(45);
  const [simResult, setSimResult] = useState<SimulateResponse | null>(null);
  const [simLoading, setSimLoading] = useState(false);
  const [simError, setSimError] = useState<string | null>(null);

  // ── 분석 탭 상태
  const [analyzeResult, setAnalyzeResult] = useState<AnalyzeResponse | null>(null);
  const [analyzeLoading, setAnalyzeLoading] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);

  // ── 최적화 탭 상태
  const [optModel, setOptModel] = useState("gradient_boosting");
  const [optSupplier, setOptSupplier] = useState<"SUP_A" | "SUP_B" | "SUP_C">("SUP_A");
  const [optTemp, setOptTemp] = useState(250);
  const [optTime, setOptTime] = useState(45);
  const [optMethod, setOptMethod] = useState<"slsqp" | "lhs">("slsqp");
  const [optResult, setOptResult] = useState<OptimizeResponse | null>(null);
  const [optLoading, setOptLoading] = useState(false);
  const [optError, setOptError] = useState<string | null>(null);

  // ── DOE 방법 로드
  useEffect(() => {
    fetchDoeMethods()
      .then((r) => setMethods(r.metadata))
      .catch((e) => setMethodsError(e.message));
  }, []);

  // ── 핸들러: 설계 행렬 생성
  async function handleDesign() {
    setDesignLoading(true);
    setDesignError(null);
    try {
      const res = await createDesign({
        method: selectedMethod,
        factors,
        n_samples: 30,
      });
      setDesignResult(res);
    } catch (e: unknown) {
      setDesignError(e instanceof Error ? e.message : "설계 행렬 생성 실패");
    } finally {
      setDesignLoading(false);
    }
  }

  // ── 핸들러: 시뮬레이션
  async function handleSimulate() {
    if (!designResult) {
      setSimError("먼저 설계 탭에서 설계 행렬을 생성하세요.");
      return;
    }
    setSimLoading(true);
    setSimError(null);
    try {
      const res = await simulateDoe({
        design_matrix: designResult.design_matrix,
        model: simModel,
        supplier: simSupplier,
        melt_temp_c: simTemp,
        melt_time_min: simTime,
      });
      setSimResult(res);
    } catch (e: unknown) {
      setSimError(e instanceof Error ? e.message : "시뮬레이션 실패");
    } finally {
      setSimLoading(false);
    }
  }

  // ── 핸들러: 분석
  async function handleAnalyze() {
    if (!simResult) {
      setAnalyzeError("먼저 시뮬레이션 탭에서 예측을 실행하세요.");
      return;
    }
    setAnalyzeLoading(true);
    setAnalyzeError(null);
    try {
      const res = await analyzeDoe({ simulated_data: simResult.simulated_data });
      setAnalyzeResult(res);
    } catch (e: unknown) {
      setAnalyzeError(e instanceof Error ? e.message : "분석 실패");
    } finally {
      setAnalyzeLoading(false);
    }
  }

  // ── 핸들러: 최적화
  async function handleOptimize() {
    setOptLoading(true);
    setOptError(null);
    try {
      const res = await optimizeDoe({
        model: optModel,
        supplier: optSupplier,
        melt_temp_c: optTemp,
        melt_time_min: optTime,
        method: optMethod,
      });
      setOptResult(res);
    } catch (e: unknown) {
      setOptError(e instanceof Error ? e.message : "최적화 실패");
    } finally {
      setOptLoading(false);
    }
  }

  // ── 공통 입력 클래스
  const inputCls =
    "block w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500";
  const labelCls = "block text-xs font-medium text-gray-600 mb-1";

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">DOE 시뮬레이터</h1>
        <p className="mt-1 text-sm text-gray-500">
          실험계획법(DOE) 설계 → ML 시뮬레이션 → 통계 분석 → 최적화
        </p>
      </div>

      {/* 탭 */}
      <div className="flex gap-1 rounded-xl border border-gray-200 bg-gray-50 p-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              tab === t.key
                ? "bg-white text-blue-600 shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── 탭 1: 설계 ──────────────────────────────────────────────────── */}
      {tab === "design" && (
        <div className="space-y-5">
          {methodsError && <ErrorAlert message={methodsError} />}

          {/* DOE 방법 선택 */}
          <Card>
            <CardHeader>
              <CardTitle>DOE 방법 선택</CardTitle>
            </CardHeader>
            <CardContent>
              {!methods ? (
                <div className="flex justify-center py-6">
                  <Spinner />
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {(Object.entries(methods) as [DoeMethodKey, DoeMethodMeta][]).map(
                    ([key, meta]) => (
                      <button
                        key={key}
                        onClick={() => setSelectedMethod(key)}
                        className={`rounded-lg border p-3 text-left transition-colors ${
                          selectedMethod === key
                            ? "border-blue-500 bg-blue-50"
                            : "border-gray-200 bg-white hover:border-blue-300"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-semibold text-gray-900">
                            {meta.name}
                          </span>
                          {selectedMethod === key && (
                            <span className="rounded-full bg-blue-500 px-2 py-0.5 text-xs text-white">
                              선택
                            </span>
                          )}
                        </div>
                        <p className="mt-1 text-xs text-gray-500 line-clamp-2">
                          {meta.description}
                        </p>
                        <div className="mt-2 flex gap-2 text-xs text-gray-400">
                          <span>인자: {meta.recommended_factors}</span>
                          <span>·</span>
                          <span>실험수: {meta.typical_experiments}</span>
                        </div>
                      </button>
                    )
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* 인자 설정 */}
          <Card>
            <CardHeader>
              <CardTitle>인자 설정</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {Object.entries(factors).map(([name, spec]) => (
                  <div key={name} className="grid grid-cols-4 gap-3 items-end">
                    <div>
                      <label className={labelCls}>{name}</label>
                      <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
                        {name}
                      </div>
                    </div>
                    <div>
                      <label className={labelCls}>최솟값</label>
                      <input
                        type="number"
                        className={inputCls}
                        value={spec.min}
                        onChange={(e) =>
                          setFactors((f) => ({
                            ...f,
                            [name]: { ...f[name], min: Number(e.target.value) },
                          }))
                        }
                      />
                    </div>
                    <div>
                      <label className={labelCls}>최댓값</label>
                      <input
                        type="number"
                        className={inputCls}
                        value={spec.max}
                        onChange={(e) =>
                          setFactors((f) => ({
                            ...f,
                            [name]: { ...f[name], max: Number(e.target.value) },
                          }))
                        }
                      />
                    </div>
                    <div>
                      <label className={labelCls}>수준 수</label>
                      <input
                        type="number"
                        min={2}
                        max={10}
                        className={inputCls}
                        value={spec.levels}
                        onChange={(e) =>
                          setFactors((f) => ({
                            ...f,
                            [name]: { ...f[name], levels: Number(e.target.value) },
                          }))
                        }
                      />
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-5 flex items-center gap-3">
                <Button onClick={handleDesign} loading={designLoading}>
                  설계 행렬 생성
                </Button>
                {designResult && (
                  <span className="text-sm text-green-600">
                    {designResult.n_experiments}개 실험 생성 완료
                  </span>
                )}
              </div>

              {designError && <ErrorAlert message={designError} className="mt-3" />}
            </CardContent>
          </Card>

          {/* 설계 행렬 테이블 */}
          {designResult && (
            <Card>
              <CardHeader>
                <CardTitle>
                  설계 행렬 — {designResult.method_name} ({designResult.n_experiments}개 실험)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200">
                        <th className="pb-2 pr-4 text-left text-xs font-medium text-gray-500">
                          #
                        </th>
                        {Object.keys(designResult.design_matrix[0] ?? {}).map((col) => (
                          <th
                            key={col}
                            className="pb-2 pr-4 text-left text-xs font-medium text-gray-500"
                          >
                            {col}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {designResult.design_matrix.slice(0, 20).map((row, i) => (
                        <tr
                          key={i}
                          className="border-b border-gray-100 last:border-0 hover:bg-gray-50"
                        >
                          <td className="py-1.5 pr-4 text-gray-400">{i + 1}</td>
                          {Object.values(row).map((v, j) => (
                            <td key={j} className="py-1.5 pr-4 font-mono">
                              {typeof v === "number" ? v.toFixed(4) : String(v)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {designResult.design_matrix.length > 20 && (
                    <p className="mt-2 text-xs text-gray-400">
                      … 외 {designResult.design_matrix.length - 20}개 행 생략
                    </p>
                  )}
                </div>

                <Button
                  variant="secondary"
                  size="sm"
                  className="mt-4"
                  onClick={() => setTab("simulate")}
                >
                  시뮬레이션 탭으로 →
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* ── 탭 2: 시뮬레이션 ────────────────────────────────────────────── */}
      {tab === "simulate" && (
        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>공정 조건 설정</CardTitle>
            </CardHeader>
            <CardContent>
              {!designResult && (
                <div className="mb-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-700">
                  설계 탭에서 설계 행렬을 먼저 생성하세요.
                </div>
              )}

              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <label className={labelCls}>모델</label>
                  <select
                    className={inputCls}
                    value={simModel}
                    onChange={(e) => setSimModel(e.target.value)}
                  >
                    {MODEL_OPTIONS.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>공급사</label>
                  <select
                    className={inputCls}
                    value={simSupplier}
                    onChange={(e) =>
                      setSimSupplier(e.target.value as "SUP_A" | "SUP_B" | "SUP_C")
                    }
                  >
                    {SUPPLIER_OPTIONS.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>용해 온도 (°C)</label>
                  <input
                    type="number"
                    className={inputCls}
                    value={simTemp}
                    onChange={(e) => setSimTemp(Number(e.target.value))}
                  />
                </div>
                <div>
                  <label className={labelCls}>가열 시간 (분)</label>
                  <input
                    type="number"
                    className={inputCls}
                    value={simTime}
                    onChange={(e) => setSimTime(Number(e.target.value))}
                  />
                </div>
              </div>

              <div className="mt-5 flex items-center gap-3">
                <Button
                  onClick={handleSimulate}
                  loading={simLoading}
                  disabled={!designResult}
                >
                  ML 예측 실행
                </Button>
                {simResult && (
                  <span className="text-sm text-green-600">
                    {simResult.summary.n_experiments}개 실험 예측 완료
                  </span>
                )}
              </div>

              {simError && <ErrorAlert message={simError} className="mt-3" />}
            </CardContent>
          </Card>

          {simResult && (
            <>
              {/* 요약 통계 */}
              <div className="grid gap-3 sm:grid-cols-4">
                {[
                  { label: "평균 품질", value: fmt(simResult.summary.mean) },
                  { label: "표준편차", value: fmt(simResult.summary.std) },
                  { label: "최솟값", value: fmt(simResult.summary.min) },
                  { label: "최댓값", value: fmt(simResult.summary.max) },
                ].map(({ label, value }) => (
                  <Card key={label} className="p-4">
                    <p className="text-xs text-gray-500">{label}</p>
                    <p className="mt-1 text-xl font-bold text-gray-900">{value}</p>
                  </Card>
                ))}
              </div>

              {/* 최적 포인트 */}
              <Card>
                <CardHeader>
                  <CardTitle>최적 실험 조건</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-3">
                    {Object.entries(simResult.optimal_point).map(([k, v]) => (
                      <div
                        key={k}
                        className="rounded-lg border border-green-200 bg-green-50 px-3 py-2"
                      >
                        <p className="text-xs text-gray-500">{k}</p>
                        <p className="text-sm font-semibold text-green-700">
                          {typeof v === "number" ? v.toFixed(4) : String(v)}
                        </p>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              {/* 산점도: sn_pct vs predicted_quality */}
              <Card>
                <CardHeader>
                  <CardTitle>SN 비율 vs 예측 품질 점수</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={280}>
                    <ScatterChart margin={{ top: 10, right: 20, bottom: 20, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis
                        type="number"
                        dataKey="sn_pct"
                        name="SN (%)"
                        label={{ value: "SN (%)", position: "insideBottom", offset: -10 }}
                        tick={{ fontSize: 11 }}
                      />
                      <YAxis
                        type="number"
                        dataKey="predicted_quality"
                        name="품질"
                        tick={{ fontSize: 11 }}
                      />
                      <Tooltip
                        cursor={{ strokeDasharray: "3 3" }}
                        formatter={(v: number) => v.toFixed(3)}
                      />
                      <ReferenceLine
                        y={simResult.optimal_point.predicted_quality}
                        stroke="#16a34a"
                        strokeDasharray="4 4"
                        label={{ value: "최적", fill: "#16a34a", fontSize: 11 }}
                      />
                      <Scatter
                        data={simResult.simulated_data.map((r) => ({
                          sn_pct: r.sn_pct,
                          predicted_quality: r.predicted_quality,
                        }))}
                        fill="#3b82f6"
                        fillOpacity={0.7}
                      />
                    </ScatterChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              <Button
                variant="secondary"
                size="sm"
                onClick={() => setTab("analyze")}
              >
                분석 탭으로 →
              </Button>
            </>
          )}
        </div>
      )}

      {/* ── 탭 3: 분석 ──────────────────────────────────────────────────── */}
      {tab === "analyze" && (
        <div className="space-y-5">
          <Card>
            <CardContent>
              {!simResult && (
                <div className="mb-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-700">
                  시뮬레이션 탭에서 먼저 ML 예측을 실행하세요.
                </div>
              )}

              <div className="flex items-center gap-3">
                <Button
                  onClick={handleAnalyze}
                  loading={analyzeLoading}
                  disabled={!simResult}
                >
                  통계 분석 실행
                </Button>
                {analyzeResult && (
                  <span className="text-sm text-green-600">
                    R² = {fmt(analyzeResult.r_squared, 4)}
                  </span>
                )}
              </div>

              {analyzeError && <ErrorAlert message={analyzeError} className="mt-3" />}
            </CardContent>
          </Card>

          {analyzeResult && (
            <>
              {/* 주효과 차트 */}
              <Card>
                <CardHeader>
                  <CardTitle>주효과 (Main Effects)</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart
                      layout="vertical"
                      data={Object.entries(analyzeResult.main_effects)
                        .map(([name, val]) => ({ name, value: val, abs: Math.abs(val) }))
                        .sort((a, b) => b.abs - a.abs)}
                      margin={{ top: 0, right: 20, bottom: 0, left: 80 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis type="number" tick={{ fontSize: 11 }} />
                      <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} width={80} />
                      <Tooltip formatter={(v: number) => v.toFixed(5)} />
                      <Bar
                        dataKey="value"
                        fill="#3b82f6"
                        radius={[0, 4, 4, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              {/* ANOVA 테이블 */}
              {analyzeResult.anova_table && analyzeResult.anova_table.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle>ANOVA 테이블</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-gray-200">
                            {["Source", "SS", "df", "MS", "F", "p-value"].map((h) => (
                              <th
                                key={h}
                                className="pb-2 pr-6 text-left text-xs font-medium text-gray-500"
                              >
                                {h}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {analyzeResult.anova_table.map((row, i) => (
                            <tr
                              key={i}
                              className="border-b border-gray-100 last:border-0 hover:bg-gray-50"
                            >
                              <td className="py-2 pr-6 font-medium">{row.source}</td>
                              <td className="py-2 pr-6 font-mono">{fmt(row.ss, 3)}</td>
                              <td className="py-2 pr-6 font-mono">{row.df}</td>
                              <td className="py-2 pr-6 font-mono">{fmt(row.ms, 3)}</td>
                              <td className="py-2 pr-6 font-mono">
                                {row.f_value != null ? fmt(row.f_value, 3) : "—"}
                              </td>
                              <td className="py-2 pr-6 font-mono">
                                {row.p_value != null ? (
                                  <span
                                    className={
                                      row.p_value < 0.05
                                        ? "text-green-600 font-semibold"
                                        : "text-gray-600"
                                    }
                                  >
                                    {row.p_value.toFixed(4)}
                                    {row.p_value < 0.05 ? " *" : ""}
                                  </span>
                                ) : (
                                  "—"
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <p className="mt-2 text-xs text-gray-400">* p &lt; 0.05: 통계적으로 유의</p>
                  </CardContent>
                </Card>
              )}

              {/* 교호작용 */}
              {Object.keys(analyzeResult.interactions).length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle>교호작용 (Interactions)</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex flex-wrap gap-3">
                      {Object.entries(analyzeResult.interactions).map(([k, v]) => (
                        <div
                          key={k}
                          className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2"
                        >
                          <p className="text-xs text-gray-500">{k}</p>
                          <p
                            className={`text-sm font-semibold ${
                              Math.abs(v) > 0.01 ? "text-blue-600" : "text-gray-600"
                            }`}
                          >
                            {v.toFixed(5)}
                          </p>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </div>
      )}

      {/* ── 탭 4: 최적화 ────────────────────────────────────────────────── */}
      {tab === "optimize" && (
        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>최적화 조건 설정</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <div>
                  <label className={labelCls}>모델</label>
                  <select
                    className={inputCls}
                    value={optModel}
                    onChange={(e) => setOptModel(e.target.value)}
                  >
                    {MODEL_OPTIONS.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>공급사</label>
                  <select
                    className={inputCls}
                    value={optSupplier}
                    onChange={(e) =>
                      setOptSupplier(e.target.value as "SUP_A" | "SUP_B" | "SUP_C")
                    }
                  >
                    {SUPPLIER_OPTIONS.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>최적화 방법</label>
                  <select
                    className={inputCls}
                    value={optMethod}
                    onChange={(e) => setOptMethod(e.target.value as "slsqp" | "lhs")}
                  >
                    <option value="slsqp">SLSQP (기울기 기반)</option>
                    <option value="lhs">LHS (전역 탐색)</option>
                  </select>
                </div>
                <div>
                  <label className={labelCls}>용해 온도 (°C)</label>
                  <input
                    type="number"
                    className={inputCls}
                    value={optTemp}
                    onChange={(e) => setOptTemp(Number(e.target.value))}
                  />
                </div>
                <div>
                  <label className={labelCls}>가열 시간 (분)</label>
                  <input
                    type="number"
                    className={inputCls}
                    value={optTime}
                    onChange={(e) => setOptTime(Number(e.target.value))}
                  />
                </div>
              </div>

              <div className="mt-5 flex items-center gap-3">
                <Button onClick={handleOptimize} loading={optLoading}>
                  최적 배합 탐색
                </Button>
              </div>

              {optError && <ErrorAlert message={optError} className="mt-3" />}
            </CardContent>
          </Card>

          {optResult && (
            <>
              {/* 최적 조건 */}
              <Card>
                <CardHeader>
                  <CardTitle>최적 배합 조건</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="mb-4 flex items-center gap-3">
                    <div className="rounded-xl bg-green-50 px-5 py-3 text-center">
                      <p className="text-xs text-gray-500">예측 품질 점수</p>
                      <p className="mt-0.5 text-3xl font-bold text-green-600">
                        {fmt(optResult.predicted_quality, 2)}
                      </p>
                    </div>
                    <div className="text-xs text-gray-400">
                      <p>방법: {optResult.method}</p>
                      <p>모델: {optResult.model}</p>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-3">
                    {Object.entries(optResult.optimal_conditions).map(([k, v]) => (
                      <div
                        key={k}
                        className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2"
                      >
                        <p className="text-xs text-gray-500">{k}</p>
                        <p className="text-sm font-semibold text-blue-700">
                          {typeof v === "number" ? v.toFixed(4) : String(v)}
                        </p>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              {/* 상위 5개 후보 */}
              {optResult.top5_candidates && optResult.top5_candidates.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle>상위 5개 후보 조건</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-gray-200">
                            <th className="pb-2 pr-4 text-left text-xs font-medium text-gray-500">
                              순위
                            </th>
                            {Object.keys(optResult.top5_candidates[0]).map((col) => (
                              <th
                                key={col}
                                className="pb-2 pr-4 text-left text-xs font-medium text-gray-500"
                              >
                                {col}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {optResult.top5_candidates.map((row, i) => (
                            <tr
                              key={i}
                              className={`border-b border-gray-100 last:border-0 ${
                                i === 0 ? "bg-green-50" : "hover:bg-gray-50"
                              }`}
                            >
                              <td className="py-2 pr-4 font-semibold text-gray-500">
                                {i === 0 ? "★" : i + 1}
                              </td>
                              {Object.values(row).map((v, j) => (
                                <td key={j} className="py-2 pr-4 font-mono">
                                  {typeof v === "number" ? v.toFixed(4) : String(v)}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
