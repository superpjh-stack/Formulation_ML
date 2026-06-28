// ── 고려솔더 확장 API 클라이언트 ─────────────────────────────────────────────
// 실 API 엔드포인트가 없을 때 mock-data를 반환하는 안전한 래퍼

export { fetchPrediction, fetchRecommendation, fetchModels, fetchEdaStats, ApiError } from './api';

import {
  LOT_LIST,
  COMPONENT_HISTORY,
  EQUIPMENT_STATUS,
  KPI_MONTHLY,
  QUALITY_HISTORY,
  RECEIVING_HISTORY,
  SHIPPING_HISTORY,
  ALERTS,
} from './mock-data';

export type {
  LotRecord,
  ComponentData,
  EquipmentStatus,
  KpiData,
  QualityResult,
  AlertItem,
} from './mock-data';

// ── 편차 통계 타입 ─────────────────────────────────────────────────────────────
export interface DeviationStat {
  avg: number;
  max: number;
  warningCount: number;
}

export interface DeviationSummary {
  sn: DeviationStat;
  ag: DeviationStat;
  cu: DeviationStat;
}

// ── 실 API URL ─────────────────────────────────────────────────────────────────
const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';

/** 실 API를 시도하고 실패하면 fallback을 반환하는 공통 래퍼 */
async function tryFetch<T>(path: string, fallback: T): Promise<T> {
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      headers: { 'Content-Type': 'application/json' },
      // 빠른 타임아웃으로 개발 환경에서 대기 최소화
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return fallback;
    return (await res.json()) as T;
  } catch {
    return fallback;
  }
}

// ── LOT 목록 ──────────────────────────────────────────────────────────────────
export async function getLotList(): Promise<typeof LOT_LIST> {
  return tryFetch('/lots', LOT_LIST);
}

// ── 성분 이력 ──────────────────────────────────────────────────────────────────
export async function getComponentHistory(
  days = 30
): Promise<typeof COMPONENT_HISTORY> {
  const data = await tryFetch<typeof COMPONENT_HISTORY>(
    `/components/history?days=${days}`,
    COMPONENT_HISTORY
  );
  // days 기준으로 최근 N개만 슬라이싱
  return data.slice(-days);
}

// ── 설비 상태 ──────────────────────────────────────────────────────────────────
export async function getEquipmentStatus(): Promise<typeof EQUIPMENT_STATUS> {
  return tryFetch('/equipment/status', EQUIPMENT_STATUS);
}

// ── KPI 월별 ──────────────────────────────────────────────────────────────────
export async function getKpiMonthly(): Promise<typeof KPI_MONTHLY> {
  return tryFetch('/kpi/monthly', KPI_MONTHLY);
}

// ── 품질 이력 ──────────────────────────────────────────────────────────────────
export async function getQualityHistory(
  days = 30
): Promise<typeof QUALITY_HISTORY> {
  const data = await tryFetch<typeof QUALITY_HISTORY>(
    `/quality/history?days=${days}`,
    QUALITY_HISTORY
  );
  return data.slice(-days);
}

// ── 입고 이력 ──────────────────────────────────────────────────────────────────
export async function getReceivingHistory(): Promise<typeof RECEIVING_HISTORY> {
  return tryFetch('/receiving', RECEIVING_HISTORY);
}

// ── 출하 이력 ──────────────────────────────────────────────────────────────────
export async function getShippingHistory(): Promise<typeof SHIPPING_HISTORY> {
  return tryFetch('/shipping', SHIPPING_HISTORY);
}

// ── 알림 ──────────────────────────────────────────────────────────────────────
export async function getAlerts(): Promise<typeof ALERTS> {
  return tryFetch('/alerts', ALERTS);
}

// ── 성분 편차 요약 ─────────────────────────────────────────────────────────────
// COMPONENT_HISTORY 기반으로 Sn/Ag/Cu 편차 통계를 계산
export async function getDeviationSummary(): Promise<DeviationSummary> {
  const history = await getComponentHistory(30);

  function stat(values: number[], threshold: number): DeviationStat {
    if (values.length === 0) return { avg: 0, max: 0, warningCount: 0 };
    const abs = values.map(Math.abs);
    const avg = +(abs.reduce((a, b) => a + b, 0) / abs.length).toFixed(3);
    const max = +(Math.max(...abs)).toFixed(3);
    const warningCount = abs.filter((v) => v > threshold).length;
    return { avg, max, warningCount };
  }

  return {
    sn: stat(history.map((d) => d.snDeviation), 1.0),   // ±1% 경고
    ag: stat(history.map((d) => d.agDeviation), 0.15),  // ±0.15% 경고
    cu: stat(history.map((d) => d.cuDeviation), 0.05),  // ±0.05% 경고
  };
}
