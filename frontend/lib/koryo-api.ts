/**
 * 고려솔더 데이터 계층 — `contracts/api-contract.md` §8 카탈로그의 프론트 구현.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * 이 파일이 하는 일은 **세 가지뿐**이다.
 *   1. `/api/v1/*` 요청 (상대경로 + Next rewrite 경유, 10초 타임아웃, Bearer 자동 첨부)
 *   2. **실패를 throw** — `useKoryoData` 의 `error` 가 화면에 뜬다
 *   3. snake_case DTO → camelCase 뷰모델 **매퍼** (여기 한 곳에만 둔다)
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * 🔴 **`fallback` 인자를 되살리지 마라.** 개편 전 `tryFetch<T>(path, fallback)` 은
 * 3초 타임아웃 뒤 조용히 mock 을 반환해서 **백엔드가 죽어도 화면상 구분이 안 됐다.**
 * goal.md 3절이 이것을 이 프로젝트 최대 결함으로 지목했고, `api-contract.md` §5.2 ·
 * `ts-types.md` §7.1 이 제거를 지시했다. 실패는 전부 `ApiError` 로 던진다.
 *
 * 타임아웃 기본값은 **10초**다. 이전 3초는 NFR-P-03(배합 최적화 5초 허용)을 위반해
 * 정상 응답을 실패로 만들었다. 예외는 둘뿐이다:
 *   - `GET /data/export` — 타임아웃 없음 (§7.1)
 *   - **LLM 을 호출하는 `/agents/*` 6개 — `AGENT_TIMEOUT_MS` 65초**
 *     (LLM 응답이 5~20초라 10초로는 정상 응답이 전부 실패로 그려진다. 아래 상수 주석 참고)
 */

// 기존 ML 계열은 `lib/api.ts` 가 정본이다. 여기서 재수출만 한다 (호출부 호환).
export { fetchPrediction, fetchRecommendation, fetchModels, fetchEdaStats, ApiError } from './api';

import { ApiError } from './api';
import { authHeaders, redirectToLogin } from './auth';

import type {
  AlarmHistoryDto,
  AlertDto,
  AuditLogDto,
  ClaimDto,
  ClaimHistoryDto,
  ClaimIn,
  ClaimPatch,
  ClaimStatus,
  ComponentDto,
  ComponentIn,
  ConditionHistoryDto,
  DashboardEquipmentDto,
  DashboardProductionDto,
  DashboardQualityDto,
  DashboardShippingDto,
  DataQueryDto,
  DataVisualizationDto,
  DateRangeQuery,
  DeviationBySupplierDto,
  DeviationTimeseriesDto,
  EquipmentDto,
  EquipmentState,
  ExportEntity,
  ExportFormat,
  ExportedFile,
  HealthDto,
  IntegrationDto,
  IntegrationSystem,
  IntegrationTestResult,
  KpiProductionRow,
  KpiQualityRow,
  KpiTargetDto,
  KpiTargetIn,
  LotDetailDto,
  LotDto,
  LotStatus,
  MasterCodeDto,
  MasterCodeGroupDto,
  MasterCodeIn,
  MasterGroupCode,
  NotificationRuleDto,
  Page,
  PageQuery,
  ProcessAnalysisDto,
  ProcessAnalysisFactor,
  ProcessConditionDto,
  ProcessConditionIn,
  ProcessHistoryDto,
  ProcessHistoryKind,
  ProcessPerformanceRow,
  PublicSettingsDto,
  QualityCertificateDto,
  QualityDto,
  QualityIn,
  QualityStandardDto,
  QualityStandardIn,
  QueryEntity,
  ReceiptDto,
  ReceiptIn,
  ReceiptPatch,
  ReceiptStatus,
  ShipmentCalendarCell,
  ShipmentDto,
  ShipmentIn,
  SupplierCode,
  SupplierDto,
  SupplierIn,
  SupplierStatsDto,
  SystemSettingsDto,
  SystemSettingsPatch,
  TrainingDataPage,
  TrainingUploadResult,
  UserDto,
  UserIn,
  UserPatch,
  VisualizationChart,
  WorkStandardDto,
  WorkStandardIn,
} from '@/types/api';

import {
  CU_TARGET,
  DEVIATION_WARN,
  EQUIPMENT_TEMP_WARN_C,
  QUALITY_PASS_SCORE,
  QUALITY_WARN_SCORE,
  AG_TARGET,
  SN_TARGET,
} from '@/types/api';

import type {
  AuditAction,
  AuthUser,
  LoginRequest,
  LoginResponse,
  RefreshResponse,
  UserRole,
} from '@/types/auth';

import type {
  AlertItem,
  ComponentData,
  EquipmentStatus,
  KpiData,
  LotRecord,
  QualityResult,
} from './mock-data';

/** 뷰모델 6종 — camelCase. 42화면이 이 형태를 쓴다 (ts-types §1.1 ③) */
export type {
  LotRecord,
  ComponentData,
  EquipmentStatus,
  KpiData,
  QualityResult,
  AlertItem,
} from './mock-data';

// ── 편차 통계 타입 (기존 호출부 호환) ────────────────────────────────────────

export interface DeviationStat {
  avg: number;
  max: number;
  warningCount: number;
}

export interface DeviationSummary {
  sn: DeviationStat;
  ag: DeviationStat;
  cu: DeviationStat;
  /** 판정에 쓴 임계값. 서버(`/settings/public`)에서 왔는지 폴백인지 드러낸다 */
  thresholds: { sn: number; ag: number; cu: number };
  thresholdSource: SettingsSource;
}

// ══════════════════════════════════════════════════════════════════════════════
// 1. 요청 계층
// ══════════════════════════════════════════════════════════════════════════════

/**
 * **빈 문자열 = 동일 출처 상대 요청** → `next.config.js` 의 rewrite 를 경유한다
 * (`api-contract.md` §1.2 ②). 값을 채우면 rewrite 를 건너뛰고 직접 호출하는데,
 * 그때는 백엔드 CORS 화이트리스트에 해당 오리진을 추가해야 한다.
 */
export const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

/** 정본 접두사 — SF-TD4 §2. `next.config.js` 가 `/api` 를 벗기지 않는다 */
export const API_PREFIX = '/api/v1';

/** NFR-P-03 이 배합 최적화에 5초를 허용한다. 3초는 정상 응답을 실패로 만들었다 */
export const REQUEST_TIMEOUT_MS = 10_000;

/**
 * AI Agent 전용 타임아웃 — **LLM 을 호출하는 엔드포인트에만** 쓴다.
 *
 * 🔴 기본 10초를 그대로 두면 **정상 응답이 전부 실패로 그려진다.** LLM 응답은 5~20초다.
 * 사용자에게는 "AI 가 고장났다" 로 보이는데 실제로는 잘 돌고 있다.
 * 프로젝트 최대 결함이 "실패를 성공으로 위장" 이었다면 이건 그 **거울상** —
 * "성공을 실패로 위장" 이다. 둘 다 화면이 사실과 다른 것을 말한다.
 *
 * **원칙: 클라이언트는 서버 상한보다 반드시 느슨하다** (`agent-architecture.md` §7.10.2).
 * 그래야 끊는 주체가 서버가 되어 사용자가 `answer_status="timeout"` + 근거를 받는다.
 * 클라이언트가 먼저 끊으면 연결만 끊기고 **아무 정보도 남지 않는다.**
 *
 * 계층: SQL 3초 · 검색 3초 · LLM 1회 30초 · **서버 전 구간 60초** · **프론트 65초**(여기).
 *
 * ⚠ `timeoutMs: null`(무한)을 쓰지 않는 이유 — `/data/export` 와 달리 응답이 안 오면
 * 영원히 매달리고, 오류 문구가 `(timeoutMs ?? REQUEST_TIMEOUT_MS)` 를 참조해
 * **"10초 초과" 라는 거짓 문구**가 나온다.
 */
export const AGENT_TIMEOUT_MS = 65_000;

export type QueryValue = string | number | boolean | null | undefined;

/** `undefined`·`null` 키는 통째로 뺀다 — 서버가 빈 문자열을 필터로 오해하지 않게 */
function qs(params: Record<string, QueryValue> = {}): string {
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    sp.set(key, String(value));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** `null` = 타임아웃 없음 (`/data/export` 전용 예외 — ts-types §7.1) */
  timeoutMs?: number | null;
  /** `FormData` 등 JSON 이 아닌 본문 */
  rawBody?: BodyInit;
  accept?: string;
}

function timeoutSignal(ms: number | null | undefined): AbortSignal | undefined {
  if (ms === null) return undefined;
  const value = ms ?? REQUEST_TIMEOUT_MS;
  if (typeof AbortSignal === 'undefined' || typeof AbortSignal.timeout !== 'function') {
    return undefined;
  }
  return AbortSignal.timeout(value);
}

/** FastAPI 오류 본문에서 사람이 읽을 문장을 뽑는다 (`{detail}` 또는 422 배열) */
function extractDetail(raw: string, status: number): string {
  if (!raw) return `HTTP ${status}`;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && 'detail' in parsed) {
      const detail = (parsed as { detail: unknown }).detail;
      if (typeof detail === 'string') return detail;
      if (Array.isArray(detail)) {
        const msgs = detail
          .map((d) =>
            d && typeof d === 'object' && 'msg' in d ? String((d as { msg: unknown }).msg) : ''
          )
          .filter(Boolean);
        if (msgs.length > 0) return msgs.join(' / ');
      }
    }
  } catch {
    // JSON 이 아니면 원문 그대로 — **삼키지 않는다** (design-standards §3.3 규칙 3)
  }
  return raw.slice(0, 500);
}

/**
 * 모든 요청의 단일 통로.
 *
 * - 401 → 토큰 삭제 + 로그인 화면으로 보내고 **그래도 throw** 한다
 * - !ok → `ApiError(status, detail)` throw
 * - 네트워크 실패·타임아웃 → `ApiError(0, ...)` throw (`error-contract.ts` 가 "분류 불가"로 표시)
 *
 * 어떤 경로로도 **mock 을 반환하지 않는다.**
 */
async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, rawBody, timeoutMs, accept } = options;
  const url = `${BASE_URL}${API_PREFIX}${path}`;

  const headers: Record<string, string> = { ...authHeaders() };
  if (accept) headers.Accept = accept;
  if (rawBody === undefined && body !== undefined) headers['Content-Type'] = 'application/json';

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: rawBody ?? (body !== undefined ? JSON.stringify(body) : undefined),
      signal: timeoutSignal(timeoutMs),
    });
  } catch (err) {
    const aborted = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
    throw new ApiError(
      0,
      aborted
        ? `서버 응답이 없습니다 (${method} ${path} — ${(timeoutMs ?? REQUEST_TIMEOUT_MS) / 1000}초 초과)`
        : `서버에 연결할 수 없습니다 (${method} ${path})`
    );
  }

  if (res.status === 401) {
    redirectToLogin();
    throw new ApiError(401, extractDetail(await res.text().catch(() => ''), 401));
  }
  if (!res.ok) {
    throw new ApiError(res.status, extractDetail(await res.text().catch(() => ''), res.status));
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

const apiGet = <T>(path: string, timeoutMs?: number | null) =>
  request<T>(path, { method: 'GET', timeoutMs });
const apiPost = <T>(path: string, body?: unknown, timeoutMs?: number | null) =>
  request<T>(path, { method: 'POST', body, timeoutMs });
const apiPut = <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body });
const apiPatch = <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body });
const apiDelete = <T>(path: string) => request<T>(path, { method: 'DELETE' });

// ══════════════════════════════════════════════════════════════════════════════
// 2. 매퍼 계층 — DTO(snake_case) → 뷰모델(camelCase)
//    ts-types.md §3. **페이지 컴포넌트 안에서 변환하지 마라.**
//    `?? 0` 은 "값 없음"과 "값 0"이 의미상 같은 곳에만 쓴다 (§3.1 경고).
// ══════════════════════════════════════════════════════════════════════════════

/** `LotDto.status` 는 4값, `LotRecord.status` 는 3값 → `pending` 을 `warning` 으로 접는다 */
function foldLotStatus(status: LotStatus): LotRecord['status'] {
  return status === 'pending' ? 'warning' : status;
}

export const toLotRecord = (d: LotDto): LotRecord => ({
  lotId: d.lot_id,
  date: d.date,
  supplier: d.supplier_code,
  snRatio: d.sn_ratio,
  agRatio: d.ag_ratio,
  cuRatio: d.cu_ratio,
  pbRatio: d.pb_ratio,
  qualityScore: d.quality_score ?? 0, // 미검사 LOT (NULL 허용 — db-schema §3.1)
  status: foldLotStatus(d.status),
});

export const toComponentData = (d: ComponentDto): ComponentData => ({
  date: d.date,
  sn: d.sn,
  ag: d.ag,
  cu: d.cu,
  pb: d.pb,
  snDeviation: d.sn_deviation,
  agDeviation: d.ag_deviation,
  cuDeviation: d.cu_deviation,
});

export const toEquipmentStatus = (d: EquipmentDto): EquipmentStatus => ({
  id: d.eq_id,
  name: d.name,
  status: d.status,
  temperature: d.temperature ?? 0,
  uptime: d.uptime ?? 0,
  lastMaintenance: d.last_maintenance ?? '',
});

export const toAlertItem = (d: AlertDto): AlertItem => ({
  id: `ALT-${String(d.id).padStart(3, '0')}`,
  level: d.level,
  message: d.message,
  timestamp: d.created_at,
  resolved: d.resolved,
});

export const toQualityResult = (d: QualityDto): QualityResult => ({
  date: d.tested_at.slice(0, 10),
  lotId: d.lot_id,
  score: d.score,
  passed: d.passed, // 🔴 서버 판정을 그대로 쓴다. 프론트가 다시 계산하지 않는다
  model: d.model_used,
});

/**
 * KPI 뷰모델은 **두 엔드포인트를 월로 조인**해서 만든다.
 * `/kpi/production` 에 `quality_avg` 가 없고 `/kpi/quality` 에 `yield` 가 없다.
 *
 * ⚠ `productionVolume`·`qualityAvg` 는 없으면 **`null` 을 그대로 화면까지 보낸다.**
 * 0 으로 채우면 "생산 0" 으로 오독된다 (ts-types §3.1 경고).
 */
export function toKpiData(prod: KpiProductionRow, quality?: KpiQualityRow): KpiData {
  return {
    month: prod.month,
    yield: prod.yield_pct,
    defectRate: prod.defect_rate,
    productionVolume: prod.production_volume ?? null,
    qualityAvg: quality?.quality_avg ?? null,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// 3. G0 — 인증 · 공통 설정
// ══════════════════════════════════════════════════════════════════════════════

export const getHealth = () => apiGet<HealthDto>('/health');

export const login = (body: LoginRequest) => apiPost<LoginResponse>('/auth/login', body);
export const logout = () => apiPost<{ ok: boolean }>('/auth/logout');
export const refreshToken = () => apiPost<RefreshResponse>('/auth/refresh');
export const getMe = () => apiGet<AuthUser>('/auth/me');

export type SettingsSource = 'server' | 'fallback';

export interface PublicSettingsState {
  settings: PublicSettingsDto;
  /** `'fallback'` 이면 서버 값을 못 읽었다는 뜻이다. 화면은 이 사실을 숨기지 마라 */
  source: SettingsSource;
  error: string | null;
}

/**
 * `/settings/public` 을 못 읽었을 때만 쓰는 폴백. **판정 기준의 정본이 아니다.**
 * 값의 출처는 `types/api.ts` 상수 = goal.md 2.3 하드 비즈니스 룰이다.
 */
export const FALLBACK_PUBLIC_SETTINGS: PublicSettingsDto = {
  sn_target: SN_TARGET,
  ag_target: AG_TARGET,
  cu_target: CU_TARGET,
  quality_pass_score: QUALITY_PASS_SCORE,
  quality_warn_score: QUALITY_WARN_SCORE,
  temp_warn_c: EQUIPMENT_TEMP_WARN_C,
  deviation_warn: { ...DEVIATION_WARN },
};

let settingsCache: Promise<PublicSettingsDto> | null = null;

/**
 * `GET /settings/public` — **세션당 1회만** 조회하고 보관한다 (api-contract §8.1.1).
 * 실패하면 throw 한다. 폴백이 필요하면 `loadPublicSettings()` 를 써라.
 */
export function getPublicSettings(): Promise<PublicSettingsDto> {
  if (!settingsCache) {
    settingsCache = apiGet<PublicSettingsDto>('/settings/public').catch((err: unknown) => {
      settingsCache = null; // 실패한 promise 를 캐시에 남기지 않는다
      throw err;
    });
  }
  return settingsCache;
}

/**
 * 임계값이 없어도 화면은 그려져야 하므로 폴백을 허용하되, **폴백 사실을 숨기지 않는다.**
 * `source: 'fallback'` 과 `error` 를 함께 돌려주므로 호출부가 배너를 띄울 수 있다.
 * 이것이 `catch {}` 와 다른 점이다 — 실패가 값에 실려 밖으로 나온다.
 */
export async function loadPublicSettings(): Promise<PublicSettingsState> {
  try {
    return { settings: await getPublicSettings(), source: 'server', error: null };
  } catch (err) {
    return {
      settings: FALLBACK_PUBLIC_SETTINGS,
      source: 'fallback',
      error: err instanceof Error ? err.message : '설정을 불러오지 못했습니다',
    };
  }
}

/** 로그아웃·설정 변경 후 다음 조회에서 다시 받아오게 한다 */
export function clearPublicSettingsCache(): void {
  settingsCache = null;
}

// ══════════════════════════════════════════════════════════════════════════════
// 4. G1 — AI 대시보드 (FE-RT-02~05)
// ══════════════════════════════════════════════════════════════════════════════

export const getDashboardProduction = (date?: string) =>
  apiGet<DashboardProductionDto>(`/dashboard/production${qs({ date })}`);

export const getDashboardQuality = (days = 30) =>
  apiGet<DashboardQualityDto>(`/dashboard/quality${qs({ days })}`);

export const getDashboardEquipment = () => apiGet<DashboardEquipmentDto>('/dashboard/equipment');

export const getDashboardShipping = (days = 7) =>
  apiGet<DashboardShippingDto>(`/dashboard/shipping${qs({ days })}`);

/** 알림은 생산 대시보드에 임베드돼 온다 (ts-types §7.2) */
export async function getAlerts(): Promise<AlertItem[]> {
  const data = await getDashboardProduction();
  return data.alerts.map(toAlertItem);
}

// ══════════════════════════════════════════════════════════════════════════════
// 5. G2 — 입고관리 (FE-RT-06~10)
// ══════════════════════════════════════════════════════════════════════════════

export interface ReceiptQuery extends PageQuery, DateRangeQuery {
  status?: ReceiptStatus;
  supplier?: SupplierCode;
  material?: string;
}

export const getReceipts = (q: ReceiptQuery = {}) =>
  apiGet<Page<ReceiptDto>>(`/receipts${qs({ ...q })}`);

export const createReceipt = (body: ReceiptIn) => apiPost<ReceiptDto>('/receipts', body);

export const patchReceipt = (receiptNo: string, body: ReceiptPatch) =>
  apiPatch<ReceiptDto>(`/receipts/${encodeURIComponent(receiptNo)}`, body);

export const getReceiptHistory = (q: ReceiptQuery = {}) =>
  apiGet<Page<ReceiptDto>>(`/receipts/history${qs({ ...q })}`);

/**
 * @deprecated `getReceipts()` 를 써라. 이름만 남긴 호환 래퍼다.
 *
 * `ts-types.md` §7.2 는 이 함수를 "501 throw" 로 적었지만 그건 CR-DB-001 승인 **전** 판정이다.
 * `api-contract.md` §8.3.1 이 "CR-DB-001 승인(2026-08-25)으로 `receipts` 테이블이 실재한다.
 * FE-RT-06·07 은 구현 가능하다" 로 갱신했으므로 실제 엔드포인트를 부른다.
 */
export async function getReceivingHistory(q: ReceiptQuery = {}): Promise<ReceiptDto[]> {
  return (await getReceipts(q)).items;
}

export interface ComponentQuery extends PageQuery, DateRangeQuery {
  lot_id?: string;
  supplier?: SupplierCode;
  days?: number;
}

export const getComponents = (q: ComponentQuery = {}) =>
  apiGet<Page<ComponentDto>>(`/components${qs({ ...q })}`);

export const getComponentByLot = (lotId: string) =>
  apiGet<ComponentDto>(`/components/${encodeURIComponent(lotId)}`);

/** 편차 3종은 **보내지 않는다.** 서버가 `sn - 62.0` 식으로 계산해 저장한다 (§8.3) */
export const createComponent = (body: ComponentIn) => apiPost<ComponentDto>('/components', body);

/** 성분 이력 (뷰모델) — 기본 30일 */
export async function getComponentHistory(days = 30): Promise<ComponentData[]> {
  const page = await getComponents({ days, page_size: 200 });
  return page.items.map(toComponentData);
}

export const getSuppliers = (active?: boolean) =>
  apiGet<Page<SupplierDto>>(`/suppliers${qs({ active })}`);

export const createSupplier = (body: SupplierIn) => apiPost<SupplierDto>('/suppliers', body);

export const patchSupplier = (id: number, body: Partial<SupplierIn>) =>
  apiPatch<SupplierDto>(`/suppliers/${id}`, body);

export const getSupplierStats = (code: SupplierCode, days = 90) =>
  apiGet<SupplierStatsDto>(`/suppliers/${encodeURIComponent(code)}/stats${qs({ days })}`);

// ══════════════════════════════════════════════════════════════════════════════
// 6. G3 — 배합비율 최적화AI (FE-RT-11~15) ★ 핵심 기능
//    `/predict`·`/recommend`·`/models` 는 `lib/api.ts` 가 정본이다 (상단 재수출).
// ══════════════════════════════════════════════════════════════════════════════

export interface TrainingDataQuery extends PageQuery, DateRangeQuery {
  supplier?: SupplierCode;
}

export const getTrainingData = (q: TrainingDataQuery = {}) =>
  apiGet<TrainingDataPage>(`/training-data${qs({ ...q })}`);

/** CSV 업로드 — `multipart/form-data`. `Content-Type` 은 브라우저가 boundary 와 함께 붙인다 */
export function uploadTrainingData(file: File): Promise<TrainingUploadResult> {
  const form = new FormData();
  form.append('file', file);
  return request<TrainingUploadResult>('/training-data/upload', {
    method: 'POST',
    rawBody: form,
  });
}

export type DeviationComponent = 'sn' | 'ag' | 'cu';

/** `warn_threshold` 는 **서버가 준다.** 프론트가 임계값을 하드코딩하지 않는다 */
export const getDeviationTimeseries = (component: DeviationComponent, days = 90) =>
  apiGet<DeviationTimeseriesDto>(`/deviation/timeseries${qs({ days, component })}`);

/**
 * 공급사별 편차 비교 — `recommended` 도 **서버 계산**이다 (api-contract §8.4.3).
 * ⚠ `?supplier=` 필터를 넣지 마라. `ISS-002` 는 v1.1 범위 밖이다.
 */
export const getDeviationBySupplier = (days = 90) =>
  apiGet<DeviationBySupplierDto>(`/deviation/by-supplier${qs({ days })}`);

/**
 * 성분 편차 요약 (Sn/Ag/Cu 평균·최대·경고건수).
 *
 * 🔴 **임계값을 하드코딩하지 않는다.** 개편 전에는 `1.0`/`0.15`/`0.05` 가 코드에 박혀 있었는데
 * 정본은 goal.md 2.3 의 `2.0`/`0.3`/`0.1` 이다 (`ts-types.md` §8 #13 — Ag 는 2배 차이였다).
 * 지금은 `GET /settings/public` 의 `deviation_warn` 을 읽고, 못 읽으면 폴백을 쓰되
 * `thresholdSource: 'fallback'` 으로 그 사실을 반환값에 실어 보낸다.
 *
 * TODO(TODO-FE-002): `ts-types.md` §7.2 는 이 집계를 서버로 옮기라고 한다. 다만 계약 §8 에
 * 대응 엔드포인트(`/deviation/summary`)가 없고 `/deviation/by-supplier` 는 응답 형태가 다르다
 * (`{suppliers[], recommended, basis}`). 서버에 추가되면 이 함수는 그 호출로 대체한다.
 */
export async function getDeviationSummary(days = 30): Promise<DeviationSummary> {
  const [history, settings] = await Promise.all([
    getComponentHistory(days),
    loadPublicSettings(),
  ]);
  const warn = settings.settings.deviation_warn;

  function stat(values: number[], threshold: number): DeviationStat {
    if (values.length === 0) return { avg: 0, max: 0, warningCount: 0 };
    const abs = values.map(Math.abs);
    const avg = +(abs.reduce((a, b) => a + b, 0) / abs.length).toFixed(3);
    const max = +Math.max(...abs).toFixed(3);
    const warningCount = abs.filter((v) => v > threshold).length;
    return { avg, max, warningCount };
  }

  return {
    sn: stat(history.map((d) => d.snDeviation), warn.sn),
    ag: stat(history.map((d) => d.agDeviation), warn.ag),
    cu: stat(history.map((d) => d.cuDeviation), warn.cu),
    thresholds: { sn: warn.sn, ag: warn.ag, cu: warn.cu },
    thresholdSource: settings.source,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// 7. G4 — 포장출하관리 (FE-RT-16~20)
// ══════════════════════════════════════════════════════════════════════════════

export interface ShipmentQuery extends PageQuery, DateRangeQuery {
  customer?: string;
  lot_id?: string;
}

export const getShipments = (q: ShipmentQuery = {}) =>
  apiGet<Page<ShipmentDto>>(`/shipments${qs({ ...q })}`);

export const createShipment = (body: ShipmentIn) => apiPost<ShipmentDto>('/shipments', body);

/** 월 단위 집계 — 봉투 없음 (§4.2 예외) */
export const getShipmentCalendar = (month: string) =>
  apiGet<ShipmentCalendarCell[]>(`/shipments/calendar${qs({ month })}`);

/** 출하 이력 — 대응 뷰모델이 없어 **DTO 를 그대로** 쓴다 (ts-types §7.2) */
export async function getShippingHistory(q: ShipmentQuery = {}): Promise<ShipmentDto[]> {
  return (await getShipments(q)).items;
}

export interface LotQuery extends PageQuery, DateRangeQuery {
  status?: LotStatus;
  supplier?: SupplierCode;
  lot_id?: string;
}

export const getLots = (q: LotQuery = {}) => apiGet<Page<LotDto>>(`/lots${qs({ ...q })}`);

/** `{lot_id}` 는 **문자열** `LOT-2026-001` 이다. 내부 BIGINT id 를 쓰지 마라 */
export const getLotDetail = (lotId: string) =>
  apiGet<LotDetailDto>(`/lots/${encodeURIComponent(lotId)}`);

export const patchLotStatus = (lotId: string, status: LotStatus) =>
  apiPatch<LotDto>(`/lots/${encodeURIComponent(lotId)}/status`, { status });

/** LOT 목록 (뷰모델). 응답은 `Page<LotDto>` 봉투이므로 `.items` 를 벗겨 매핑한다 */
export async function getLotList(q: LotQuery = {}): Promise<LotRecord[]> {
  const page = await getLots(q);
  return page.items.map(toLotRecord);
}

export interface QualityQuery extends PageQuery, DateRangeQuery {
  lot_id?: string;
  passed?: boolean;
  days?: number;
}

export const getQuality = (q: QualityQuery = {}) =>
  apiGet<Page<QualityDto>>(`/quality${qs({ ...q })}`);

/** `passed` 는 **서버 계산**이다. 클라이언트가 보낸 값을 서버가 믿지 않는다 */
export const createQuality = (body: QualityIn) => apiPost<QualityDto>('/quality', body);

/** 성적서는 **JSON 만**. PDF 는 `ISS-001` 로 v1.1 범위 밖이다 */
export const getQualityCertificate = (lotId: string) =>
  apiGet<QualityCertificateDto>(`/quality/${encodeURIComponent(lotId)}/certificate`);

export async function getQualityHistory(days = 30): Promise<QualityResult[]> {
  const page = await getQuality({ days, page_size: 200 });
  return page.items.map(toQualityResult);
}

export interface ClaimQuery extends PageQuery {
  status?: ClaimStatus;
  customer?: string;
}

export const getClaims = (q: ClaimQuery = {}) => apiGet<Page<ClaimDto>>(`/claims${qs({ ...q })}`);

/** `claim_no` 는 **서버가 채번**한다. 본문에 실어 보내지 마라 */
export const createClaim = (body: ClaimIn) => apiPost<ClaimDto>('/claims', body);

/**
 * 종결 전이(`resolved`/`rejected`)인데 `resolution` 이 비면 서버가 **422** 를 낸다.
 * 역행 전이는 서버가 막지 않는다 — 프론트가 확인 대화상자만 띄운다 (api-contract §8.5.1).
 */
export const patchClaim = (claimNo: string, body: ClaimPatch) =>
  apiPatch<ClaimDto>(`/claims/${encodeURIComponent(claimNo)}`, body);

/** 봉투 없는 배열 (§4.2 예외). `audit_logs` 로 재구성되며 `ip_address` 는 오지 않는다 */
export const getClaimHistory = (claimNo: string) =>
  apiGet<ClaimHistoryDto[]>(`/claims/${encodeURIComponent(claimNo)}/history`);

// ══════════════════════════════════════════════════════════════════════════════
// 8. G5 — 공정관리 (FE-RT-21~25)
// ══════════════════════════════════════════════════════════════════════════════

export type ProcessPeriod = 'day' | 'week' | 'month';

/** 배열 응답 (§4.2 예외). `input_qty`/`output_qty` 는 항상 null → 해당 열을 숨긴다 */
export const getProcessPerformance = (
  q: { period?: ProcessPeriod } & DateRangeQuery = {}
) => apiGet<ProcessPerformanceRow[]>(`/process/performance${qs({ ...q })}`);

/**
 * 설비 목록.
 *
 * `page_size` 를 **명시해야 한다.** 안 보내면 서버 기본값 50 이 걸리는데,
 * FE-RT-22 실시간 모니터는 페이지네이션이 없는 관제 화면이라
 * 설비가 51대를 넘는 순간 **나머지가 아무 안내 없이 사라진다** (QA-B DEF-B-02:
 * 서버 `total:100` 인데 화면에 50대만 표시됐다).
 * 200 은 서버 `MAX_PAGE_SIZE` 다. 그보다 늘어나면 화면이 `total` 과 대조해 경고한다.
 */
export const getEquipment = (status?: EquipmentState, pageSize = 200) =>
  apiGet<Page<EquipmentDto>>(`/equipment${qs({ status, page_size: pageSize })}`);

export const getEquipmentById = (eqId: string) =>
  apiGet<EquipmentDto>(`/equipment/${encodeURIComponent(eqId)}`);

/**
 * 설비 상태 (뷰모델).
 * ⚠ 온도 경고는 **서버 판정 `temp_warning`** 을 쓴다. 프론트가 255 를 다시 비교하지 마라.
 * 뷰모델(`EquipmentStatus`)에는 그 필드가 없으므로, 경고가 필요한 화면은
 * `getEquipment()` 로 DTO 를 직접 받아라 (FE-RT-22 실시간 모니터는 10초 폴링).
 */
export async function getEquipmentStatus(status?: EquipmentState): Promise<EquipmentStatus[]> {
  const page = await getEquipment(status);
  return page.items.map(toEquipmentStatus);
}

export const getProcessConditions = (q: { product_code?: string; active?: boolean } & PageQuery = {}) =>
  apiGet<Page<ProcessConditionDto>>(`/process/conditions${qs({ ...q })}`);

export const createProcessCondition = (body: ProcessConditionIn) =>
  apiPost<ProcessConditionDto>('/process/conditions', body);

export const patchProcessCondition = (id: number, body: Partial<ProcessConditionIn>) =>
  apiPatch<ProcessConditionDto>(`/process/conditions/${id}`, body);

export interface ProcessHistoryQuery extends PageQuery, DateRangeQuery {
  kind?: ProcessHistoryKind;
  condition_id?: number;
  product_code?: string;
  level?: AlarmHistoryDto['level'];
}

/**
 * 판별 유니온 응답. **`row.kind` 로 좁혀라** — 자기가 보낸 `kind` 쿼리를 기억해
 * 해석하면 탭 전환 시 경쟁 조건이 생긴다 (api-contract §8.6.1).
 */
export const getProcessHistory = (q: ProcessHistoryQuery = {}) =>
  apiGet<Page<ProcessHistoryDto>>(`/process/history${qs({ ...q })}`);

/** 타입 가드 — 화면에서 `if (isConditionRow(row))` 로 쓴다 */
export const isConditionRow = (row: ProcessHistoryDto): row is ConditionHistoryDto =>
  row.kind === 'condition';
export const isAlarmRow = (row: ProcessHistoryDto): row is AlarmHistoryDto => row.kind === 'alarm';

/** 응답의 `scatter.factor` 가 어느 인자를 그린 것인지 되돌려준다 */
export const getProcessAnalysis = (factor: ProcessAnalysisFactor = 'temperature', days = 90) =>
  apiGet<ProcessAnalysisDto>(`/process/analysis${qs({ days, factor })}`);

// ══════════════════════════════════════════════════════════════════════════════
// 9. G6 — 사용자/시스템관리 (FE-RT-26~29) — 전부 `admin` 전용
// ══════════════════════════════════════════════════════════════════════════════

export interface UserQuery extends PageQuery {
  role?: UserRole;
  active?: boolean;
}

export const getUsers = (q: UserQuery = {}) => apiGet<Page<UserDto>>(`/users${qs({ ...q })}`);
export const createUser = (body: UserIn) => apiPost<UserDto>('/users', body);
export const patchUser = (id: number, body: UserPatch) => apiPatch<UserDto>(`/users/${id}`, body);
/** **소프트 삭제**다 — `active=false` 로 바뀔 뿐 행은 남는다 (api-contract §8.7.1) */
export const deleteUser = (id: number) => apiDelete<void>(`/users/${id}`);

export interface AuditLogQuery extends PageQuery, DateRangeQuery {
  user_id?: number;
  action?: AuditAction;
}

export const getAuditLogs = (q: AuditLogQuery = {}) =>
  apiGet<Page<AuditLogDto>>(`/audit-logs${qs({ ...q })}`);

/** 6행 고정 배열 (§4.2 예외) */
export const getNotificationRules = () => apiGet<NotificationRuleDto[]>('/notification-rules');

/** **전체 교체다.** 6행 전부를 보내라 — 바뀐 행만 보내면 나머지가 삭제된다 */
export const putNotificationRules = (rules: NotificationRuleDto[]) =>
  apiPut<NotificationRuleDto[]>('/notification-rules', rules);

/** `admin` 전용. 비관리자 화면은 `getPublicSettings()` 를 쓴다 */
export const getSettings = () => apiGet<SystemSettingsDto>('/settings');

/**
 * **부분 갱신**이다. `sn_target`/`ag_target`/`cu_target` 은 타입에서 제외돼 있다 —
 * 보내면 422 다 (v1 에서 목표값 변경 불가, api-contract §8.7).
 */
export async function putSettings(body: SystemSettingsPatch): Promise<SystemSettingsDto> {
  const updated = await apiPut<SystemSettingsDto>('/settings', body);
  clearPublicSettingsCache(); // 합격선이 바뀌었을 수 있다
  return updated;
}

// ══════════════════════════════════════════════════════════════════════════════
// 10. G7 — 기준정보관리 (FE-RT-30~32)
//     `GET` 은 **활성 최신 1행만** 온다. 클라이언트에서 최신 버전을 고르지 마라.
//     `DELETE` 는 없다 — `PATCH {active:false}`, 버튼 라벨은 "비활성".
// ══════════════════════════════════════════════════════════════════════════════

export interface MasterQuery extends PageQuery {
  active?: boolean;
}

export const getQualityStandards = (q: MasterQuery & { product_code?: string } = {}) =>
  apiGet<Page<QualityStandardDto>>(`/master/quality-standards${qs({ ...q })}`);

export const createQualityStandard = (body: QualityStandardIn) =>
  apiPost<QualityStandardDto>('/master/quality-standards', body);

/** `version+1` 새 행을 INSERT 하고 이전 행을 `active=false` 로 내린다 (§8.8.1) */
export const patchQualityStandard = (id: number, body: Partial<QualityStandardIn> & { active?: boolean }) =>
  apiPatch<QualityStandardDto>(`/master/quality-standards/${id}`, body);

export const getWorkStandards = (q: MasterQuery & { process_code?: string } = {}) =>
  apiGet<Page<WorkStandardDto>>(`/master/work-standards${qs({ ...q })}`);

export const createWorkStandard = (body: WorkStandardIn) =>
  apiPost<WorkStandardDto>('/master/work-standards', body);

/** **버전 자동 증가.** 프론트가 `version` 을 계산해 보내지 마라 */
export const patchWorkStandard = (id: number, body: Partial<WorkStandardIn> & { active?: boolean }) =>
  apiPatch<WorkStandardDto>(`/master/work-standards/${id}`, body);

/**
 * 공통 코드 목록.
 *
 * `q` 는 코드·명칭 부분 일치 검색이며 **서버가 거른다.**
 * 클라이언트에서 현재 페이지만 필터하면 다음 페이지에 있는 항목을 검색했을 때
 * 실재하는데도 "검색 결과가 없습니다" 가 뜬다 (QA-C DEF-C-04).
 */
export const getMasterCodes = (
  q: MasterQuery & { group_code?: MasterGroupCode; q?: string } = {}
) => apiGet<Page<MasterCodeDto>>(`/master/codes${qs({ ...q })}`);

export const createMasterCode = (body: MasterCodeIn) =>
  apiPost<MasterCodeDto>('/master/codes', body);

export const patchMasterCode = (id: number, body: Partial<MasterCodeIn> & { active?: boolean }) =>
  apiPatch<MasterCodeDto>(`/master/codes/${id}`, body);

export const getMasterCodeGroups = () => apiGet<MasterCodeGroupDto[]>('/master/code-groups');

// ══════════════════════════════════════════════════════════════════════════════
// 11. G8 — 데이터관리시스템 (FE-RT-33~37)
// ══════════════════════════════════════════════════════════════════════════════

/** `admin` 전용. 배열 응답이고 **`system` 이 식별자**다 (id 가 아니다) */
export const getIntegrations = () => apiGet<IntegrationDto[]>('/integrations');

/** `integration.*` 네임스페이스 안에서만 교체된다 */
export const putIntegrations = (body: IntegrationDto[]) =>
  apiPut<IntegrationDto[]>('/integrations', body);

export const testIntegration = (system: IntegrationSystem) =>
  apiPost<IntegrationTestResult>(`/integrations/${system}/test`);

/**
 * 컬럼이 동적인 유일한 엔드포인트. `entity` 는 **화이트리스트 3종**뿐이다
 * (임의 테이블명·SQL 조각 금지 — NFR-S-05).
 */
/** 엔티티별 필터가 동적이라 인덱스 시그니처를 허용한다 (`/data/query` 전용) */
export interface DataQueryFilters extends PageQuery, DateRangeQuery {
  [key: string]: QueryValue;
}

export const getDataQuery = (entity: QueryEntity, q: DataQueryFilters = {}) =>
  apiGet<DataQueryDto>(`/data/query${qs({ entity, ...q })}`);

export const getDataVisualization = (chart: VisualizationChart = 'trend', days = 90) =>
  apiGet<DataVisualizationDto>(`/data/visualization${qs({ chart, days })}`);

/** `GET /eda-stats` — SF-TD4 §2.4 의 하이픈 표기가 정본이다 (`/eda/stats` 아니다) */
export const getEdaStatsV1 = () => apiGet<import('@/types').EdaStats>('/eda-stats');

function parseFilename(disposition: string | null, fallback: string): string {
  if (!disposition) return fallback;
  const star = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  if (star) {
    try {
      return decodeURIComponent(star[1]);
    } catch {
      /* 원문 유지 */
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(disposition);
  return plain ? plain[1] : fallback;
}

/**
 * 내보내기 — **유일하게 JSON 이 아닌 응답**이다.
 *
 * ⚠ 두 가지를 지켜라 (api-contract §8.9 · ts-types §7.1):
 *   1. `window.location.href` 나 `<a href>` 로 받지 마라 — **인증 헤더가 안 붙는다.**
 *   2. **이 요청만 타임아웃이 없다** — 최대 10만 행 스트리밍이라 10초를 넘길 수 있다.
 */
export async function exportData(
  entity: ExportEntity,
  format: ExportFormat = 'csv',
  filters: DateRangeQuery & Record<string, QueryValue> = {}
): Promise<ExportedFile> {
  const path = `/data/export${qs({ entity, format, ...filters })}`;
  const url = `${BASE_URL}${API_PREFIX}${path}`;

  let res: Response;
  try {
    res = await fetch(url, { headers: { ...authHeaders() } }); // signal 없음 = 타임아웃 없음
  } catch {
    throw new ApiError(0, `서버에 연결할 수 없습니다 (GET ${path})`);
  }
  if (res.status === 401) {
    redirectToLogin();
    throw new ApiError(401, extractDetail(await res.text().catch(() => ''), 401));
  }
  if (!res.ok) {
    throw new ApiError(res.status, extractDetail(await res.text().catch(() => ''), res.status));
  }
  return {
    blob: await res.blob(),
    filename: parseFilename(
      res.headers.get('Content-Disposition'),
      `${entity}.${format}`
    ),
  };
}

/** 🚧 저장 테이블 없음 → 서버가 **501** 을 낸다. 빈 배열로 위장하지 마라 */
export const getTrainingDatasets = (q: PageQuery = {}) =>
  apiGet<Page<Record<string, unknown>>>(`/training-datasets${qs({ ...q })}`);

// ══════════════════════════════════════════════════════════════════════════════
// 12. G9 — AI Agent (FE-RT-10·15·20·38~42, 전부 선택)
//     전 엔드포인트가 **501** 이다. 가짜 문자열로 "동작하는 것처럼" 만들지 마라.
// ══════════════════════════════════════════════════════════════════════════════

/**
 * `agent-architecture.md` §7.5 — **닫힌 집합.** 새 값을 발명하지 마라.
 *
 *   ok              정상. `answer` 는 문자열, `sources` 1건 이상
 *   no_evidence     근거 0건 — LLM 을 아예 부르지 않았다
 *   out_of_scope    이 화면이 답할 수 없는 질문
 *   timeout         생성 시간 초과
 *   rule_violation  룰 검증 재위반 → 답변 폐기. `answer` 는 null 이고 근거만 남는다
 */
export type AgentAnswerStatus =
  | 'ok'
  | 'no_evidence'
  | 'out_of_scope'
  | 'timeout'
  | 'rule_violation';

/** §7.11 — `sources: string[]` 에서 승격됐다. `kind` 는 사용자 노출 어휘다. */
export interface AgentCitation {
  ord: number;
  kind: 'data' | 'doc' | 'model';
  label: string;
  link?: string | null;
  snippet?: string | null;
  score?: number | null;
  detail?: string | null;
  /** `data` 일 때 조회 건수. **null 이면 근거로 세지 않는다.** 0 은 유효하다 */
  count?: number | null;
}

export interface AgentAnswer {
  message_id: number | null;
  session_id: number;
  /** 🔴 **null 이 정상 값이다.** 빈 문자열로 위장하지 않는다 (§6.4) */
  answer: string | null;
  answer_status: AgentAnswerStatus;
  sources: AgentCitation[];
  violations: string[];
  partial: boolean;
  latency_ms: number;
  provider: string | null;
  model_id: string | null;
  /** FE-RT-15 전용. `recommend_mix` 도구가 실행됐을 때만 온다 */
  recommended_ratios?: { executed: boolean; label: string; detail?: string | null } | null;
}

/** §7.3 — 화면이 "준비됨/미구성" 을 판단하는 **유일한 근거**. 키 값은 오지 않는다 */
export interface AgentHealth {
  provider: string | null;
  model_id: string | null;
  configured: boolean;
  embed_model: string | null;
  index_ready: boolean;
  chunk_count: number;
  failed_sources: number;
  /** 미구성 사유 — 사람이 읽는 문장. 화면에 그대로 보여준다 */
  reason: string | null;
}

export const getAgentHealth = () => apiGet<AgentHealth>('/agents/health');

export const askReceivingAgent = (question: string, sessionId?: number) =>
  apiPost<AgentAnswer>(
    '/agents/receiving',
    { question, session_id: sessionId ?? null },
    AGENT_TIMEOUT_MS
  );

/** 👍/👎 — FE-RT-42 "정확도" 의 유일한 실측 원천 (§6.8) */
export const submitAgentFeedback = (
  messageId: number,
  body: { rating: 1 | -1; reason?: string; comment?: string }
) => apiPost<{ id: number }>(`/agents/messages/${messageId}/feedback`, body);

// ── 대화 세션 (§7.3 · 사업계획서 p.42 "사용자 질문이력") ──────────────────────

export interface AgentSession {
  id: number;
  /** `receiving` | `shipping` | … — 화면 스코프. **다른 스코프 세션을 열면 403 이다** */
  scope: string;
  /** 첫 질문에서 파생. 아직 질문하지 않았으면 null */
  title: string | null;
  started_at: string;
  last_active_at: string;
  /** user + assistant 합계. 한 번 주고받으면 2 다 */
  message_count: number;
}

export interface AgentSessionMessage {
  id: number;
  seq: number;
  role: "user" | "assistant";
  /** 🔴 assistant 인데 null 일 수 있다 — 근거 없음·룰 위반이면 답변을 버렸다 (§6.4) */
  content: string | null;
  answer_status: string | null;
  created_at: string;
  sources: AgentCitation[];
}

export interface AgentSessionDetail {
  session: AgentSession;
  messages: AgentSessionMessage[];
}

/** 본인 세션만 돌아온다. `scope` 를 넘기지 않으면 전 화면 세션이 섞인다 */
export const getAgentSessions = (scope?: string, q: PageQuery = {}) =>
  apiGet<Page<AgentSession>>(`/agents/sessions${qs({ scope, ...q })}`);

export const getAgentSession = (id: number) =>
  apiGet<AgentSessionDetail>(`/agents/sessions/${id}`);

/** 204. 메시지·인용은 CASCADE 로 함께 지워진다 (§6.3) */
export const deleteAgentSession = (id: number) =>
  apiDelete<void>(`/agents/sessions/${id}`);

export interface RecentQuestion {
  question: string;
  asked_at: string;
}

/**
 * 다시 묻기용 최근 질문. **`getAgentSessions` 와 다르다.**
 *
 * 세션 목록의 `title` 은 그 대화의 **첫 질문** 하나뿐이라 후속 질문이 전부
 * 빠진다. 이쪽은 실제로 물어본 문장을 최신순으로 준다(중복은 최근 것만).
 */
export const getRecentQuestions = (scope?: string, limit = 10) =>
  apiGet<{ items: RecentQuestion[] }>(
    `/agents/questions/recent${qs({ scope, limit })}`
  );

/**
 * FE-RT-15 배합 AI Agent — 예측·추천·실적 + 배합 기준 문서.
 *
 * `recommended_ratios` 는 `AgentAnswer` 에 이미 있다(선택 필드). 도구가
 * 실행됐을 때만 채워지고, **수렴 실패도 그대로 담아 준다.**
 */
export const askMixingAgent = (question: string, sessionId?: number) =>
  apiPost<AgentAnswer>(
    '/agents/mixing',
    { question, session_id: sessionId ?? null },
    AGENT_TIMEOUT_MS
  );

export const askShippingAgent = (question: string, sessionId?: number) =>
  apiPost<AgentAnswer>(
    '/agents/shipping',
    { question, session_id: sessionId ?? null },
    AGENT_TIMEOUT_MS
  );

/**
 * FE-RT-38 자연어 질의 — **문서 근거 전용** (스코프 `global`).
 *
 * `context` 를 더 이상 보내지 않는다. 서버 `AgentAskIn` 에 그런 필드가 없고,
 * 스코프가 도구 범위를 정하므로 클라이언트가 문맥을 지정할 자리가 아니다.
 */
export const askAgentQuery = (question: string, sessionId?: number) =>
  apiPost<AgentAnswer>(
    '/agents/query',
    { question, session_id: sessionId ?? null },
    AGENT_TIMEOUT_MS
  );

export const requestAgentAnalysis = (body: {
  topic: string;
  lot_id?: string;
  date_from?: string;
  date_to?: string;
}) => apiPost<{ report: string; charts: unknown[]; latency_ms: number }>('/agents/analysis', body, AGENT_TIMEOUT_MS);

/** FE-RT-40 의사결정 지원 — LOT 하나의 이상 소견 + 표준이 규정한 조치 */
export interface AgentDecision extends AgentAnswer {
  /**
   * 🔴 **"관측된 이상" 이지 확인된 근본 원인이 아니다.** 서버가 데이터에서
   * 결정적으로 뽑은 것이고 LLM 이 만들지 않는다. 화면은 `disclaimer` 를
   * 반드시 함께 보여준다 — 목록 형태는 사람이 확인된 사실로 읽는다.
   */
  root_causes: string[];
  /** 작업표준서·품질기준서가 그 이상에 대해 규정한 조치. 지어낸 것이 아니다 */
  recommendations: string[];
  /** 🔴 **항상 null.** 신뢰도를 계산할 근거가 없다 — 숫자를 넣으면 지어낸 지표다 */
  confidence: number | null;
  disclaimer: string;
}

export const requestAgentDecision = (lotId: string, sessionId?: number) =>
  apiPost<AgentDecision>(
    '/agents/decision',
    { lot_id: lotId, session_id: sessionId ?? null },
    AGENT_TIMEOUT_MS
  );

/** LLM 을 호출하지 않는 조회다 — 기본 타임아웃을 그대로 쓴다 (§7.10.5) */
export const getAgentRecommendations = (q: PageQuery = {}) =>
  apiGet<Page<Record<string, unknown>>>(`/agents/recommendations${qs({ ...q })}`);

/**
 * FE-RT-42 실행 로그 — **`admin` 전용** (`agent-architecture.md` §7.1).
 *
 * `agent_runs.prompt_sent`(외부 송출 전문)·`raw_answer` 는 서버가 내려주지 않는다.
 * 질문 원문(`question`)까지가 감사 범위다.
 *
 * ⚠ 필터 키는 `scope` 다. 예전 초안의 `agent` 가 아니다 — 서버가 화면 단위
 *   (`receiving`|`shipping`|…)로 기록한다.
 */
export const getAgentLogs = (
  q: PageQuery & DateRangeQuery & { scope?: string; status?: string } = {}
) => apiGet<Page<Record<string, unknown>>>(`/agents/logs${qs({ ...q })}`);

/** FE-RT-42 "정확도" 의 정본 — `agent_feedback` 기반 만족도 (§6.8) */
export interface AgentFeedbackSummary {
  positive: number;
  negative: number;
  rated: number;
  total_runs: number;
  /** 🔴 **평가가 0건이면 `null` 이다.** 0 으로 바꿔 표시하지 마라 —
   *  "아무도 평가 안 함" 이 "전원 불만족" 으로 읽힌다. */
  satisfaction: number | null;
  /** 값이 없는 이유를 사람이 읽는 문장으로 준다. 화면에 그대로 보여준다. */
  note: string | null;
}

export const getAgentFeedbackSummary = (scope?: string, days?: number) =>
  apiGet<AgentFeedbackSummary>(`/agents/feedback/summary${qs({ scope, days })}`);

// ══════════════════════════════════════════════════════════════════════════════
// 13. G10 — KPI 관리 (FE-RT-43~45)
//     `target`/`achieved` 는 **지표별 객체**이고 `achieved` 판정은 **서버가** 한다.
//     `direction` 을 프론트에서 하드코딩하면 낮을수록 좋은 지표를 반대로 판정한다.
// ══════════════════════════════════════════════════════════════════════════════

/** 배열 응답 (§4.2 예외). `months` 상한 36 */
export const getKpiProduction = (months = 12) =>
  apiGet<KpiProductionRow[]>(`/kpi/production${qs({ months })}`);

export const getKpiQuality = (months = 12) =>
  apiGet<KpiQualityRow[]>(`/kpi/quality${qs({ months })}`);

export const getKpiTargets = (period?: string) =>
  apiGet<KpiTargetDto[]>(`/kpi/targets${qs({ period })}`);

/** **전체 교체.** 목표를 비우려면 그 행을 아예 보내지 마라 (0 은 유효한 목표값이다) */
export const putKpiTargets = (targets: KpiTargetIn[]) =>
  apiPut<KpiTargetDto[]>('/kpi/targets', targets);

/**
 * KPI 월별 (뷰모델). `/kpi/production` + `/kpi/quality` 를 월로 조인한다.
 * 한쪽이 실패하면 **전체가 실패한다** — 반쪽 데이터를 화면에 그리지 않는다.
 */
export async function getKpiMonthly(months = 12): Promise<KpiData[]> {
  const [production, quality] = await Promise.all([
    getKpiProduction(months),
    getKpiQuality(months),
  ]);
  const byMonth = new Map(quality.map((q) => [q.month, q]));
  return production.map((p) => toKpiData(p, byMonth.get(p.month)));
}
