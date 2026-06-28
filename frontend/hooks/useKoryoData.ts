'use client';

import { useState, useEffect, useCallback } from 'react';
import * as api from '@/lib/koryo-api';
import type {
  LotRecord,
  ComponentData,
  EquipmentStatus,
  KpiData,
  QualityResult,
  AlertItem,
  DeviationSummary,
} from '@/lib/koryo-api';

// ── 공통 훅 상태 타입 ─────────────────────────────────────────────────────────
interface HookState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

/** 비동기 데이터 페치를 위한 내부 팩토리 훅 */
function useAsyncData<T>(
  fetcher: () => Promise<T>,
  deps: unknown[] = []
): HookState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const refetch = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetcher()
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((err) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : '데이터 로드 실패');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, ...deps]);

  return { data, loading, error, refetch };
}

// ── LOT 목록 ──────────────────────────────────────────────────────────────────
export function useLotList(): HookState<LotRecord[]> {
  return useAsyncData<LotRecord[]>(() => api.getLotList());
}

// ── 성분 이력 ──────────────────────────────────────────────────────────────────
export function useComponentHistory(days = 30): HookState<ComponentData[]> {
  return useAsyncData<ComponentData[]>(() => api.getComponentHistory(days), [days]);
}

// ── 설비 상태 ──────────────────────────────────────────────────────────────────
export function useEquipmentStatus(): HookState<EquipmentStatus[]> {
  return useAsyncData<EquipmentStatus[]>(() => api.getEquipmentStatus());
}

// ── KPI 월별 ──────────────────────────────────────────────────────────────────
export function useKpiMonthly(): HookState<KpiData[]> {
  return useAsyncData<KpiData[]>(() => api.getKpiMonthly());
}

// ── 성분 편차 요약 ─────────────────────────────────────────────────────────────
export function useDeviationSummary(): HookState<DeviationSummary> {
  return useAsyncData<DeviationSummary>(() => api.getDeviationSummary());
}

// ── 알림 ──────────────────────────────────────────────────────────────────────
export function useAlerts(): HookState<AlertItem[]> {
  return useAsyncData<AlertItem[]>(() => api.getAlerts());
}

// ── 품질 이력 (부가 제공) ──────────────────────────────────────────────────────
export function useQualityHistory(days = 30): HookState<QualityResult[]> {
  return useAsyncData<QualityResult[]>(() => api.getQualityHistory(days), [days]);
}
