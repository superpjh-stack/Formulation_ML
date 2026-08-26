'use client';

/**
 * 데이터 훅 — `contracts/ts-types.md` §7.3.
 *
 * `useAsyncData<T>` 의 취소 가드와 `{data, loading, error, refetch}` 규약은 이미 옳다.
 * **재작성하지 않았다.** 아래는 새 엔드포인트용 훅을 계약에 맞춰 **추가**한 것뿐이다.
 *
 * 🔴 모든 페이지는 세 갈래를 전부 렌더해야 한다 (`design-standards.md` §3.1):
 * ```tsx
 * const { data, loading, error, refetch } = useLotList();
 * if (loading) return <StatusScreen tone="loading" title="불러오는 중" />;
 * if (error)   return <ErrorAlert message={error} />;
 * if (!data?.length) return <StatusScreen tone="empty" title="데이터가 없습니다" />;
 * ```
 * `error` 를 안 그리면 개편의 의미가 없다 — 데이터 계층은 이제 실패를 **던진다.**
 */

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
  PublicSettingsState,
  ClaimQuery,
  ComponentQuery,
  LotQuery,
  ProcessHistoryQuery,
  QualityQuery,
  ReceiptQuery,
  ShipmentQuery,
  UserQuery,
  AuditLogQuery,
  DeviationComponent,
  ProcessPeriod,
  TrainingDataQuery,
} from '@/lib/koryo-api';
import type {
  AuditLogDto,
  ClaimDto,
  DashboardEquipmentDto,
  DashboardProductionDto,
  DashboardQualityDto,
  DashboardShippingDto,
  DateRangeQuery,
  DeviationBySupplierDto,
  DeviationTimeseriesDto,
  EquipmentDto,
  IntegrationDto,
  KpiProductionRow,
  KpiQualityRow,
  KpiTargetDto,
  MasterCodeDto,
  MasterCodeGroupDto,
  MasterGroupCode,
  NotificationRuleDto,
  Page,
  PageQuery,
  ProcessAnalysisDto,
  ProcessAnalysisFactor,
  ProcessConditionDto,
  ProcessHistoryDto,
  ProcessPerformanceRow,
  PublicSettingsDto,
  QualityStandardDto,
  ReceiptDto,
  ShipmentDto,
  SupplierDto,
  SystemSettingsDto,
  TrainingDataPage,
  UserDto,
  WorkStandardDto,
} from '@/types/api';

// ── 공통 훅 상태 타입 ─────────────────────────────────────────────────────────
export interface HookState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

/** 비동기 데이터 페치를 위한 내부 팩토리 훅 (기존 구현 유지 — 재작성 금지) */
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

/** 쿼리 객체를 deps 로 쓸 때의 안정 키 — 매 렌더 새 객체가 무한 루프를 만들지 않게 */
const key = (q: unknown) => JSON.stringify(q ?? null);

// ══════════════════════════════════════════════════════════════════════════════
// 기존 훅 (뷰모델) — 시그니처 유지
// ══════════════════════════════════════════════════════════════════════════════

export function useLotList(q: LotQuery = {}): HookState<LotRecord[]> {
  return useAsyncData<LotRecord[]>(() => api.getLotList(q), [key(q)]);
}

export function useComponentHistory(days = 30): HookState<ComponentData[]> {
  return useAsyncData<ComponentData[]>(() => api.getComponentHistory(days), [days]);
}

export function useEquipmentStatus(): HookState<EquipmentStatus[]> {
  return useAsyncData<EquipmentStatus[]>(() => api.getEquipmentStatus());
}

export function useKpiMonthly(months = 12): HookState<KpiData[]> {
  return useAsyncData<KpiData[]>(() => api.getKpiMonthly(months), [months]);
}

export function useDeviationSummary(days = 30): HookState<DeviationSummary> {
  return useAsyncData<DeviationSummary>(() => api.getDeviationSummary(days), [days]);
}

export function useAlerts(): HookState<AlertItem[]> {
  return useAsyncData<AlertItem[]>(() => api.getAlerts());
}

export function useQualityHistory(days = 30): HookState<QualityResult[]> {
  return useAsyncData<QualityResult[]>(() => api.getQualityHistory(days), [days]);
}

// ══════════════════════════════════════════════════════════════════════════════
// G0 — 공통 설정
// ══════════════════════════════════════════════════════════════════════════════

/**
 * `/settings/public` — 품질 배지·편차 경고를 그리는 **모든 화면**이 쓴다.
 * 세션당 1회만 실제 요청이 나가고 이후는 캐시다 (api-contract §8.1.1).
 *
 * ⚠ `data.source === 'fallback'` 이면 서버 값을 못 읽은 것이다. **숨기지 마라** —
 * 화면 상단에 "기준값을 불러오지 못해 기본값(70점)으로 표시 중" 배너를 띄워라.
 */
export function usePublicSettings(): HookState<PublicSettingsState> {
  return useAsyncData<PublicSettingsState>(() => api.loadPublicSettings());
}

/** 임계값만 필요할 때의 축약형. 폴백이면 `settings.source` 로 확인해라 */
export function usePassScore(): number {
  const { data } = usePublicSettings();
  return data?.settings.quality_pass_score ?? 70;
}

// ══════════════════════════════════════════════════════════════════════════════
// G1 — AI 대시보드 (FE-RT-02~05)
// ══════════════════════════════════════════════════════════════════════════════

export function useDashboardProduction(date?: string): HookState<DashboardProductionDto> {
  return useAsyncData<DashboardProductionDto>(() => api.getDashboardProduction(date), [date]);
}

export function useDashboardQuality(days = 30): HookState<DashboardQualityDto> {
  return useAsyncData<DashboardQualityDto>(() => api.getDashboardQuality(days), [days]);
}

export function useDashboardEquipment(): HookState<DashboardEquipmentDto> {
  return useAsyncData<DashboardEquipmentDto>(() => api.getDashboardEquipment());
}

export function useDashboardShipping(days = 7): HookState<DashboardShippingDto> {
  return useAsyncData<DashboardShippingDto>(() => api.getDashboardShipping(days), [days]);
}

// ══════════════════════════════════════════════════════════════════════════════
// G2 — 입고관리 (FE-RT-06~09)
// ══════════════════════════════════════════════════════════════════════════════

export function useReceipts(q: ReceiptQuery = {}): HookState<Page<ReceiptDto>> {
  return useAsyncData<Page<ReceiptDto>>(() => api.getReceipts(q), [key(q)]);
}

export function useReceiptHistory(q: ReceiptQuery = {}): HookState<Page<ReceiptDto>> {
  return useAsyncData<Page<ReceiptDto>>(() => api.getReceiptHistory(q), [key(q)]);
}

export function useComponents(q: ComponentQuery = {}): HookState<Page<import('@/types/api').ComponentDto>> {
  return useAsyncData(() => api.getComponents(q), [key(q)]);
}

export function useSuppliers(active?: boolean): HookState<Page<SupplierDto>> {
  return useAsyncData<Page<SupplierDto>>(() => api.getSuppliers(active), [active]);
}

// ══════════════════════════════════════════════════════════════════════════════
// G3 — 배합비율 최적화AI (FE-RT-11~12)
// ══════════════════════════════════════════════════════════════════════════════

export function useTrainingData(q: TrainingDataQuery = {}): HookState<TrainingDataPage> {
  return useAsyncData<TrainingDataPage>(() => api.getTrainingData(q), [key(q)]);
}

/** `warn_threshold` 가 응답에 실려 온다 — 프론트가 임계값을 정하지 않는다 */
export function useDeviationTimeseries(
  component: DeviationComponent = 'sn',
  days = 90
): HookState<DeviationTimeseriesDto> {
  return useAsyncData<DeviationTimeseriesDto>(
    () => api.getDeviationTimeseries(component, days),
    [component, days]
  );
}

/** `recommended` 공급사도 **서버 계산**이다. 화면에서 다시 고르지 마라 */
export function useDeviationBySupplier(days = 90): HookState<DeviationBySupplierDto> {
  return useAsyncData<DeviationBySupplierDto>(() => api.getDeviationBySupplier(days), [days]);
}

// ══════════════════════════════════════════════════════════════════════════════
// G4 — 포장출하관리 (FE-RT-16~19)
// ══════════════════════════════════════════════════════════════════════════════

export function useShipments(q: ShipmentQuery = {}): HookState<Page<ShipmentDto>> {
  return useAsyncData<Page<ShipmentDto>>(() => api.getShipments(q), [key(q)]);
}

export function useLots(q: LotQuery = {}): HookState<Page<import('@/types/api').LotDto>> {
  return useAsyncData(() => api.getLots(q), [key(q)]);
}

export function useLotDetail(lotId: string | null): HookState<import('@/types/api').LotDetailDto> {
  return useAsyncData(
    () =>
      lotId
        ? api.getLotDetail(lotId)
        : Promise.reject(new Error('LOT 번호가 지정되지 않았습니다')),
    [lotId]
  );
}

export function useQuality(q: QualityQuery = {}): HookState<Page<import('@/types/api').QualityDto>> {
  return useAsyncData(() => api.getQuality(q), [key(q)]);
}

export function useClaims(q: ClaimQuery = {}): HookState<Page<ClaimDto>> {
  return useAsyncData<Page<ClaimDto>>(() => api.getClaims(q), [key(q)]);
}

export function useClaimHistory(
  claimNo: string | null
): HookState<import('@/types/api').ClaimHistoryDto[]> {
  return useAsyncData(
    () =>
      claimNo
        ? api.getClaimHistory(claimNo)
        : Promise.reject(new Error('클레임 번호가 지정되지 않았습니다')),
    [claimNo]
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// G5 — 공정관리 (FE-RT-21~25)
// ══════════════════════════════════════════════════════════════════════════════

export function useProcessPerformance(
  q: { period?: ProcessPeriod } & DateRangeQuery = {}
): HookState<ProcessPerformanceRow[]> {
  return useAsyncData<ProcessPerformanceRow[]>(() => api.getProcessPerformance(q), [key(q)]);
}

/**
 * 설비 DTO — **온도 경고는 서버 판정 `temp_warning`** 을 쓴다.
 * FE-RT-22 실시간 모니터는 `pollMs` 로 10초 폴링한다. WebSocket 을 쓰지 마라.
 */
export function useEquipment(
  status?: import('@/types/api').EquipmentState,
  pollMs?: number
): HookState<Page<EquipmentDto>> {
  const state = useAsyncData<Page<EquipmentDto>>(() => api.getEquipment(status), [status]);
  const { refetch } = state;
  useEffect(() => {
    if (!pollMs) return;
    const id = setInterval(refetch, pollMs);
    return () => clearInterval(id);
  }, [pollMs, refetch]);
  return state;
}

export function useProcessConditions(
  q: { product_code?: string; active?: boolean } & PageQuery = {}
): HookState<Page<ProcessConditionDto>> {
  return useAsyncData<Page<ProcessConditionDto>>(() => api.getProcessConditions(q), [key(q)]);
}

/** 응답 원소를 **`row.kind` 로 좁혀라** (`api.isConditionRow` / `api.isAlarmRow`) */
export function useProcessHistory(
  q: ProcessHistoryQuery = {}
): HookState<Page<ProcessHistoryDto>> {
  return useAsyncData<Page<ProcessHistoryDto>>(() => api.getProcessHistory(q), [key(q)]);
}

export function useProcessAnalysis(
  factor: ProcessAnalysisFactor = 'temperature',
  days = 90
): HookState<ProcessAnalysisDto> {
  return useAsyncData<ProcessAnalysisDto>(
    () => api.getProcessAnalysis(factor, days),
    [factor, days]
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// G6 — 사용자/시스템관리 (FE-RT-26~29) — 전부 admin 전용 (비관리자는 403)
// ══════════════════════════════════════════════════════════════════════════════

export function useUsers(q: UserQuery = {}): HookState<Page<UserDto>> {
  return useAsyncData<Page<UserDto>>(() => api.getUsers(q), [key(q)]);
}

export function useAuditLogs(q: AuditLogQuery = {}): HookState<Page<AuditLogDto>> {
  return useAsyncData<Page<AuditLogDto>>(() => api.getAuditLogs(q), [key(q)]);
}

export function useNotificationRules(): HookState<NotificationRuleDto[]> {
  return useAsyncData<NotificationRuleDto[]>(() => api.getNotificationRules());
}

/** admin 전용. 품질 배지를 그리는 화면은 `usePublicSettings()` 를 써라 */
export function useSystemSettings(): HookState<SystemSettingsDto> {
  return useAsyncData<SystemSettingsDto>(() => api.getSettings());
}

// ══════════════════════════════════════════════════════════════════════════════
// G7 — 기준정보관리 (FE-RT-30~32) — GET 은 **활성 최신 1행만** 온다
// ══════════════════════════════════════════════════════════════════════════════

export function useQualityStandards(
  q: { active?: boolean; product_code?: string } & PageQuery = {}
): HookState<Page<QualityStandardDto>> {
  return useAsyncData<Page<QualityStandardDto>>(() => api.getQualityStandards(q), [key(q)]);
}

export function useWorkStandards(
  q: { active?: boolean; process_code?: string } & PageQuery = {}
): HookState<Page<WorkStandardDto>> {
  return useAsyncData<Page<WorkStandardDto>>(() => api.getWorkStandards(q), [key(q)]);
}

export function useMasterCodes(
  q: { active?: boolean; group_code?: MasterGroupCode } & PageQuery = {}
): HookState<Page<MasterCodeDto>> {
  return useAsyncData<Page<MasterCodeDto>>(() => api.getMasterCodes(q), [key(q)]);
}

export function useMasterCodeGroups(): HookState<MasterCodeGroupDto[]> {
  return useAsyncData<MasterCodeGroupDto[]>(() => api.getMasterCodeGroups());
}

// ══════════════════════════════════════════════════════════════════════════════
// G8 — 데이터관리시스템 (FE-RT-33~36)
// ══════════════════════════════════════════════════════════════════════════════

/** admin 전용. `system` 이 식별자다 */
export function useIntegrations(): HookState<IntegrationDto[]> {
  return useAsyncData<IntegrationDto[]>(() => api.getIntegrations());
}

/** `columns` 가 같이 오므로 테이블 헤더를 하드코딩하지 마라 */
export function useDataQuery(
  entity: import('@/types/api').QueryEntity,
  q: import('@/lib/koryo-api').DataQueryFilters = {}
): HookState<import('@/types/api').DataQueryDto> {
  return useAsyncData(() => api.getDataQuery(entity, q), [entity, key(q)]);
}

export function useDataVisualization(
  chart: import('@/types/api').VisualizationChart = 'trend',
  days = 90
): HookState<import('@/types/api').DataVisualizationDto> {
  return useAsyncData(() => api.getDataVisualization(chart, days), [chart, days]);
}

// ══════════════════════════════════════════════════════════════════════════════
// G10 — KPI 관리 (FE-RT-43~45)
//   `achieved` 판정과 `direction` 은 **서버가 준다.** 프론트가 하드코딩하지 마라.
// ══════════════════════════════════════════════════════════════════════════════

export function useKpiProduction(months = 12): HookState<KpiProductionRow[]> {
  return useAsyncData<KpiProductionRow[]>(() => api.getKpiProduction(months), [months]);
}

export function useKpiQuality(months = 12): HookState<KpiQualityRow[]> {
  return useAsyncData<KpiQualityRow[]>(() => api.getKpiQuality(months), [months]);
}

export function useKpiTargets(period?: string): HookState<KpiTargetDto[]> {
  return useAsyncData<KpiTargetDto[]>(() => api.getKpiTargets(period), [period]);
}
