/**
 * 와이어 DTO — `contracts/ts-types.md` §4·§5·§9 의 정본 구현.
 *
 * **전부 snake_case 다.** FastAPI Pydantic 응답과 1:1 이며 여기 없는 필드를 프론트가
 * 지어내면 계약 위반이다 (`api-contract.md` §4.1).
 *
 * camelCase 뷰모델(`lib/mock-data.ts` 의 6종)로의 변환은 **`lib/koryo-api.ts` 의
 * 매퍼 한 곳**에서만 한다. 페이지 컴포넌트 안에서 변환하지 마라 (`ts-types.md` §3).
 *
 * ⚠ `types/index.ts`·`types/doe.ts` 에 이미 있는 이름
 * (`RecommendRequest`·`PredictRequest`·`FactorSpec`·`DesignRequest`·`OptimizeRequest`)
 * 을 여기서 재사용하지 마라 (`ts-types.md` §2). 배럴(re-export)도 만들지 마라.
 */

import type { SupplierName } from './index';
import type { UserRole, AuditAction } from './auth';

// ── 공통 봉투 ────────────────────────────────────────────────────────────────

/** 목록 응답 공통 봉투 — api-contract.md §4.2 */
export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}

/** 목록 공통 쿼리 — api-contract.md §4.3 */
export interface PageQuery {
  page?: number; // ≥1, 기본 1
  page_size?: number; // 1~200, 기본 50
  sort?: string; // "field:asc" | "field:desc"
}

export interface DateRangeQuery {
  date_from?: string; // "YYYY-MM-DD"
  date_to?: string;
}

/** FastAPI 오류 본문 — api-contract.md §5 */
export interface ApiErrorBody {
  detail: string | ValidationErrorItem[];
}

export interface ValidationErrorItem {
  loc: (string | number)[];
  msg: string;
  type: string;
}

/** SF-TD4 §5 의 6가지 오류 + 확장 3가지 */
export type ApiErrorStatus = 401 | 403 | 404 | 409 | 422 | 501 | 503;

/** api-contract.md §5.1 — CR-DB-001 미승인 화면이 받는 코드 */
export const NOT_IMPLEMENTED = 501 as const;

// ── 도메인 열거형 (DB 허용값과 1:1 — db-schema.md §3) ─────────────────────────

export type LotStatus = 'pass' | 'fail' | 'warning' | 'pending';
export type EquipmentState = 'normal' | 'warning' | 'error' | 'maintenance';
export type AlertLevel = 'info' | 'warning' | 'critical';
export type AlertSource = 'system' | 'ml' | 'equipment';
/** `types/index.ts` 의 `SupplierName` 과 **같은 값**이다 — 중복 정의하지 않는다 (§8 #20) */
export type SupplierCode = SupplierName;
export type AnalysisMethod = 'XRF' | 'ICP' | 'AAS';

/** 모델 등급 — api-contract.md §7.3 */
export type ModelTier = 'serving' | 'candidate' | 'baseline';

// ── 하드 비즈니스 룰 상수 (goal.md 2.3) ───────────────────────────────────────
// 값의 정본은 여기다. `lib/constants.ts` 는 이 파일을 re-export 한다 (§4 주석·§8 #8).
//
// 🔴 이 상수들은 **폴백·폼 기본값 전용**이다 (§10 #19).
//    화면 판정은 서버가 내린 `passed` 또는 `GET /settings/public` 값을 쓴다.

/** 품질 합격선. 판정용이 아니라 `/settings/public` 이 없을 때의 폴백이다 */
export const QUALITY_PASS_SCORE = 70;
/** pass/warning 경계 (db-schema.md §3.1) */
export const QUALITY_WARN_SCORE = 80;
export const EQUIPMENT_TEMP_WARN_C = 255;
export const SN_TARGET = 62.0;
export const AG_TARGET = 3.0;
export const CU_TARGET = 0.5;
/** 편차 경고 임계 — goal.md 2.3. 현 화면의 1.0/0.15/0.05 는 **값 오류**다 (§8 #13) */
export const DEVIATION_WARN = { sn: 2.0, ag: 0.3, cu: 0.1 } as const;
/**
 * 최적화 경계 — goal.md 2.3.
 *
 * TODO(TODO-FE-001): `src/models/optimize.py` 의 `DEFAULT_BOUNDS` 는 `ag 0~5` · `cu 0~2` 로
 * 계약 경계(`ag 1~5` · `cu 0.1~1.5`)와 다르다. 백엔드는 개발1·2 담당이라 손대지 않았다.
 * 프론트는 이 상수를 정본으로 쓰고, `POST /recommend` 에 `sn_bounds`/`ag_bounds`/`cu_bounds`
 * 를 **명시적으로 실어 보내** 서버 기본값이 적용되지 않게 한다 (api-contract.md §8.4.2).
 */
export const COMPONENT_BOUNDS = {
  sn: [55, 70],
  ag: [1, 5],
  cu: [0.1, 1.5],
  pb: [25, 45],
} as const;
export const MELT_TEMP_RANGE = [200, 320] as const;

// ── 5.1 핵심 5종 (SF-TD5 테이블 직결) ────────────────────────────────────────

/** GET /api/v1/lots — lots + suppliers 조인 */
export interface LotDto {
  lot_id: string; // "LOT-2026-001" (lots.lot_id UK)
  date: string; // "YYYY-MM-DD"
  supplier_code: SupplierCode; // suppliers.code (BIGINT id 는 노출 안 함)
  sn_ratio: number;
  ag_ratio: number;
  cu_ratio: number;
  pb_ratio: number;
  temperature: number | null;
  time_min: number | null;
  quality_score: number | null;
  status: LotStatus;
  created_at: string; // ISO 8601
  updated_at: string;
}

/** GET /api/v1/lots/{lot_id} — 상세 (성분·품질·출하 조인) */
export interface LotDetailDto extends LotDto {
  components: ComponentDto[];
  quality: QualityDto[];
  shipments: ShipmentDto[];
}

/** GET /api/v1/components */
export interface ComponentDto {
  id: number;
  lot_id: string; // 문자열 LOT ID 로 변환해서 내보낸다
  date: string;
  sn: number;
  ag: number;
  cu: number;
  pb: number;
  sn_deviation: number; // sn - 62.0 (서버 계산)
  ag_deviation: number; // ag - 3.0
  cu_deviation: number; // cu - 0.5
  analysis_method: AnalysisMethod | null;
  created_at: string;
}

/** POST /api/v1/components — 편차 3종은 **보내지 않는다.** 서버가 계산한다 */
export interface ComponentIn {
  lot_id: string;
  date: string;
  sn: number;
  ag: number;
  cu: number;
  pb: number;
  analysis_method?: AnalysisMethod | null;
}

/** GET /api/v1/suppliers */
export interface SupplierDto {
  id: number;
  code: SupplierCode;
  name: string;
  contact: string | null;
  primary_material: string | null;
  active: boolean;
  created_at: string;
}

export interface SupplierIn {
  code: SupplierCode;
  name: string;
  contact?: string | null;
  primary_material?: string | null;
  active?: boolean;
}

/** GET /api/v1/suppliers/{code}/stats */
export interface SupplierStatsDto {
  lot_count: number;
  avg_quality: number | null;
  pass_rate: number | null;
  sn_std: number | null;
  ag_std: number | null;
  cu_std: number | null;
}

/** GET /api/v1/quality */
export interface QualityDto {
  id: number;
  lot_id: string;
  score: number;
  passed: boolean; // score >= pass_score (**서버 계산 — 이 값이 합격 판정의 정본**)
  model_used: string;
  predicted_score: number | null;
  tested_at: string;
}

export interface QualityIn {
  lot_id: string;
  score: number;
  model_used: string;
  predicted_score?: number | null;
}

/** GET /api/v1/quality/{lot_id}/certificate — JSON 만. PDF 는 ISS-001 (v1.1) */
export interface QualityCertificateDto {
  lot_id: string;
  date: string;
  supplier: SupplierCode;
  components: { sn: number; ag: number; cu: number; pb: number };
  score: number;
  passed: boolean;
  issued_at: string;
}

/** GET /api/v1/equipment */
export interface EquipmentDto {
  id: number;
  eq_id: string; // "EQ-001" (UK)
  name: string;
  status: EquipmentState;
  temperature: number | null;
  uptime: number | null; // 시간
  last_maintenance: string | null; // "YYYY-MM-DD"
  temp_warning: boolean; // temperature > 255 (**서버 판정** — 프론트가 255 를 쓰지 않는다)
  updated_at: string;
}

// ── 5.2 나머지 DTO ───────────────────────────────────────────────────────────

/** GET /api/v1/alerts, 대시보드 임베드 */
export interface AlertDto {
  id: number;
  level: AlertLevel;
  message: string;
  source: AlertSource | null;
  lot_id: string | null;
  resolved: boolean;
  resolved_at: string | null;
  created_at: string;
}

/** GET /api/v1/shipments */
export interface ShipmentDto {
  id: number;
  lot_id: string;
  customer: string;
  product: string;
  quantity: number;
  unit: string;
  shipped_at: string;
}

export interface ShipmentIn {
  lot_id: string;
  customer: string;
  product: string;
  quantity: number;
  unit?: string;
}

/** GET /api/v1/shipments/calendar — 봉투 없음 (§4.2 예외) */
export interface ShipmentCalendarCell {
  date: string;
  count: number;
  quantity: number;
}

/** GET /api/v1/users — password_hash 는 절대 포함되지 않는다 */
export interface UserDto {
  id: number;
  username: string;
  email: string;
  role: UserRole; // types/auth.ts
  active: boolean;
  last_login: string | null;
  created_at: string;
}

export interface UserIn {
  username: string;
  email: string;
  password: string; // 8자 이상 (api-contract.md §8.7.1)
  role: UserRole;
}

export interface UserPatch {
  email?: string;
  role?: UserRole;
  active?: boolean;
  password?: string;
}

/** GET /api/v1/audit-logs — admin 전용 */
export interface AuditLogDto {
  id: number;
  user_id: number | null;
  username: string | null; // users 조인 (NULL = 시스템)
  action: AuditAction; // types/auth.ts
  target_table: string | null;
  target_id: number | null;
  detail: Record<string, unknown> | null; // JSONB
  ip_address: string | null; // INET
  created_at: string;
}

/** GET /api/v1/ml-models (ml_models 테이블) — GET /models 와 다르다 (ts-types §5.3) */
export interface MlModelDto {
  id: number;
  name: string;
  model_type: string;
  rmse: number | null;
  r2: number | null;
  mape: number | null;
  train_samples: number | null;
  artifact_path: string;
  active: boolean;
  trained_at: string;
}

// ── G1 대시보드 (api-contract.md §8.2) ───────────────────────────────────────

/** `*_delta` 는 전일 대비. 데이터가 없으면 **null** — 0 으로 채우지 마라 */
export interface DashboardProductionDto {
  kpi: {
    today_lots: number;
    yield_pct: number | null;
    defect_rate: number | null;
    avg_quality: number | null;
    today_lots_delta: number | null;
    yield_pct_delta: number | null;
    defect_rate_delta: number | null;
    avg_quality_delta: number | null;
  };
  weekly_yield: { date: string; value: number }[];
  alerts: AlertDto[];
  recent_lots: LotDto[];
}

export interface DashboardQualityDto {
  score_distribution: { range: string; count: number }[];
  pass_fail: { pass: number; warning: number; fail: number };
  deviation_heatmap: { supplier: SupplierCode; sn: number; ag: number; cu: number }[];
  recent: QualityDto[];
}

export interface DashboardEquipmentDto {
  items: EquipmentDto[];
  summary: { normal: number; warning: number; error: number; maintenance: number };
}

export interface DashboardShippingDto {
  today_qty: number;
  week_qty: number;
  by_customer: { customer: string; quantity: number }[];
  claims: { open: number; closed: number };
}

// ── G3 편차 (api-contract.md §8.4.3) ─────────────────────────────────────────

/** GET /api/v1/deviation/timeseries — `warn_threshold` 는 **서버가 준다** */
export interface DeviationTimeseriesDto {
  target: number;
  points: { date: string; value: number; deviation: number }[];
  warn_threshold: number;
}

/** GET /api/v1/deviation/by-supplier — `recommended` 도 **서버 계산**이다 */
export interface DeviationBySupplierDto {
  suppliers: { code: SupplierCode; sn: number; ag: number; cu: number }[];
  recommended: SupplierCode;
  basis: string;
}

// ── G5 공정 (api-contract.md §8.6) ───────────────────────────────────────────

/** GET /api/v1/process/performance — 벌거벗은 배열 (§4.2 예외) */
export interface ProcessPerformanceRow {
  period: string;
  lot_count: number;
  pass_count: number;
  fail_count: number;
  warning_count: number;
  /** 저장 컬럼이 없다 — 항상 null. 화면은 해당 열을 **숨긴다** */
  input_qty: number | null;
  output_qty: number | null;
  yield_pct: number;
}

export type ProcessAnalysisFactor =
  | 'temperature'
  | 'time_min'
  | 'sn_pct'
  | 'ag_pct'
  | 'cu_pct';

export interface ProcessAnalysisDto {
  days: number;
  sample_size: number;
  correlations: { factor: ProcessAnalysisFactor; quality_corr: number | null }[];
  scatter: { factor: ProcessAnalysisFactor; points: { x: number; y: number }[] };
}

// ── G8 데이터관리 (api-contract.md §8.9) ─────────────────────────────────────

export type QueryEntity = 'lots' | 'components' | 'quality';
export type ExportEntity = 'lots' | 'components' | 'quality' | 'shipments';
export type ExportFormat = 'csv' | 'xlsx';

export interface DataColumn {
  key: string;
  label: string;
  type: string;
}

/** GET /api/v1/data/query — 컬럼이 동적인 유일한 곳. `Record<string, unknown>` 허용 */
export interface DataQueryDto extends Page<Record<string, unknown>> {
  columns: DataColumn[];
}

export type VisualizationChart = 'trend' | 'distribution' | 'supplier';

export interface DataVisualizationDto {
  chart: VisualizationChart;
  series: { name: string; points: { x: number | string; y: number }[] }[];
}

/** `GET /data/export` 결과 — Blob + Content-Disposition 파싱 파일명 */
export interface ExportedFile {
  blob: Blob;
  filename: string;
}

// ══════════════════════════════════════════════════════════════════════════════
// §9 CR-DB-001~003 테이블 DTO 10블록
// ══════════════════════════════════════════════════════════════════════════════

// ── 9.1 receipts — FE-RT-06·07 ───────────────────────────────────────────────

export type ReceiptStatus = 'accepted' | 'rejected' | 'inspecting';
export type ReceiptMaterial = 'Sn ingot' | 'Ag powder' | 'Cu wire' | 'Pb ingot';

export interface ReceiptDto {
  id: number;
  receipt_no: string; // "RCV-00001" (UK, 서버 채번)
  date: string; // "YYYY-MM-DD"
  supplier_code: SupplierCode; // ⚠ supplier_id(BIGINT) 가 아니다
  material: ReceiptMaterial;
  quantity: number;
  unit: string; // 'kg'
  status: ReceiptStatus;
  // CR-DB-003 — 입고 시점 실측 성분. 검사 전에는 전부 null
  sn_pct: number | null;
  ag_pct: number | null;
  cu_pct: number | null;
  pb_pct: number | null;
  analysis_method: string | null;
  /**
   * 서버 계산 (저장 컬럼 아님). 측정 전이면 null.
   * ⚠ **경고 배지에 쓰지 마라** — 원재료는 단일 원소라 배합 목표 62.0% 와의 차이가
   * 품질 편차가 아니다 (api-contract.md §8.3.1). 편차 경고는 `ComponentDto` 에만.
   */
  deviations: { sn: number; ag: number; cu: number } | null;
  created_at: string;
}

export interface ReceiptIn {
  date: string;
  supplier_code: SupplierCode;
  material: ReceiptMaterial;
  quantity: number;
  unit?: string;
  status?: ReceiptStatus;
}

/** PATCH /receipts/{receipt_no} — 검사 결과 입력 */
export interface ReceiptPatch {
  status?: ReceiptStatus;
  sn_pct?: number | null;
  ag_pct?: number | null;
  cu_pct?: number | null;
  pb_pct?: number | null;
  analysis_method?: string | null;
}

export const RECEIPT_STATUS_LABELS: Record<ReceiptStatus, string> = {
  accepted: '수락',
  rejected: '거부',
  inspecting: '검사중',
};

// ── 9.2 claims — FE-RT-19 ────────────────────────────────────────────────────

export type ClaimStatus = 'open' | 'analyzing' | 'resolved' | 'rejected';

export interface ClaimDto {
  id: number;
  claim_no: string; // "CLM-00001" (UK, 서버 채번)
  lot_id: string; // 문자열 LOT ID (BIGINT 노출 금지)
  customer: string;
  reason: string;
  status: ClaimStatus;
  resolution: string | null;
  resolved_at: string | null;
  created_at: string;
}

export interface ClaimIn {
  lot_id: string;
  customer: string;
  reason: string;
}

/** PATCH /claims/{claim_no} — resolution 은 종결 전이 시 서버가 필수로 강제한다 (422) */
export interface ClaimPatch {
  status: ClaimStatus;
  resolution?: string;
}

export interface ClaimHistoryDto {
  changed_at: string;
  changed_by_username: string | null; // null = 시스템
  before: { status: ClaimStatus; resolution: string | null } | null;
  after: { status: ClaimStatus; resolution: string | null } | null;
}

export const CLAIM_STATUS_LABELS: Record<ClaimStatus, string> = {
  open: '접수',
  analyzing: '분석중',
  resolved: '처리완료',
  rejected: '기각',
};

// ── 9.3 process_conditions — FE-RT-23 ────────────────────────────────────────

export interface ProcessConditionDto {
  id: number;
  product_code: string;
  temp_min: number; // °C, 소수 1
  temp_max: number;
  time_min: number; // 분, 정수
  time_max: number;
  speed: number | null; // 단위 미정, 소수 2
  version: number;
  active: boolean;
  created_at: string;
}

export interface ProcessConditionIn {
  product_code: string; // PATCH 시 변경 불가
  temp_min: number;
  temp_max: number;
  time_min: number;
  time_max: number;
  speed?: number | null;
  active?: boolean;
}

// ── 9.4 condition_history + alerts — FE-RT-24 (판별 유니온) ──────────────────

export interface ConditionHistoryDto {
  kind: 'condition'; // 판별자
  id: number;
  created_at: string;
  condition_id: number;
  product_code: string; // process_conditions 조인
  changed_by_username: string | null; // users 조인 (null = 시스템)
  before: Record<string, unknown> | null; // null = 신규 등록
  after: Record<string, unknown>;
}

export interface AlarmHistoryDto {
  kind: 'alarm'; // 판별자
  id: number;
  created_at: string;
  level: AlertLevel;
  message: string;
  lot_id: string | null;
  resolved: boolean;
  resolved_at: string | null;
}

/**
 * **`kind` 로 좁혀서 쓴다.** 자기가 보낸 `kind` 쿼리 값을 기억해 해석하지 마라 —
 * 탭 전환 경쟁 조건이 생긴다 (api-contract.md §8.6.1).
 */
export type ProcessHistoryDto = ConditionHistoryDto | AlarmHistoryDto;

export type ProcessHistoryKind = ProcessHistoryDto['kind'];

// ── 9.5 notification_rules — FE-RT-28 ────────────────────────────────────────

export type NotificationEventType =
  | 'quality_fail'
  | 'deviation_exceed'
  | 'equipment_warning';
export type NotificationChannel = 'email' | 'system';

/**
 * **`id` 필드가 없다.** 행 identity 는 `(event_type, channel)` 복합키다.
 * `PUT` 은 **6행 전체 교체**다.
 */
export interface NotificationRuleDto {
  event_type: NotificationEventType;
  threshold: number | null; // v1 미사용 — 항상 null
  channel: NotificationChannel;
  enabled: boolean;
}

export const NOTIFICATION_EVENT_LABELS: Record<NotificationEventType, string> = {
  quality_fail: '품질 이상',
  deviation_exceed: '성분 편차 초과',
  equipment_warning: '설비 경고',
};

export const NOTIFICATION_CHANNEL_LABELS: Record<NotificationChannel, string> = {
  system: '시스템',
  email: '이메일',
};

// ── 9.6 system_settings — FE-RT-29 · 전 화면 ─────────────────────────────────

/** 🔴 `admin` 만 받는다. 나머지 화면은 `PublicSettingsDto` 를 쓴다 */
export interface SystemSettingsDto {
  sn_target: number; // 읽기 전용 (62.0)
  ag_target: number; // 읽기 전용 (3.0)
  cu_target: number; // 읽기 전용 (0.5)
  quality_pass_score: number; // 70
  temp_warn_c: number; // 255
  deviation_warn: { sn: number; ag: number; cu: number }; // 2.0 / 0.3 / 0.1
  updated_by_username: string | null;
  updated_at: string;
}

/** PUT body — 목표값 3종은 타입 레벨에서 제외한다 (보내면 422) */
export type SystemSettingsPatch = Partial<
  Pick<SystemSettingsDto, 'quality_pass_score' | 'temp_warn_c' | 'deviation_warn'>
>;

/**
 * GET /settings/public — 인증만 요구, 역할 무관. **품질 배지를 그리는 전 화면이 쓴다.**
 * 세션당 1회 조회해 보관한다 (`lib/koryo-api.ts` 의 `loadPublicSettings()`).
 */
export interface PublicSettingsDto {
  sn_target: number;
  ag_target: number;
  cu_target: number;
  quality_pass_score: number;
  quality_warn_score: number; // 80 — lots.status pass/warning 경계
  temp_warn_c: number;
  deviation_warn: { sn: number; ag: number; cu: number };
}

export const SETTING_LABELS = {
  sn_target: 'Sn 목표',
  ag_target: 'Ag 목표',
  cu_target: 'Cu 목표',
  quality_pass_score: '품질 합격 기준점',
  temp_warn_c: '설비 온도 경고',
  deviation_warn_sn: 'Sn 편차 경고',
  deviation_warn_ag: 'Ag 편차 경고',
  deviation_warn_cu: 'Cu 편차 경고',
} as const;

// ── 9.7 master_codes — FE-RT-30·31·32 ───────────────────────────────────────

export type MasterGroupCode =
  | 'QUALITY_STD'
  | 'WORK_STD'
  | 'SUPPLIER'
  | 'PRODUCT'
  | 'STATUS';

/** value JSONB 는 group_code 별로 스키마가 다르다 — 판별 유니온으로 좁힌다 */
export interface QualityStdValue {
  sn_min: number;
  sn_max: number;
  ag_min: number;
  ag_max: number;
  cu_min: number;
  cu_max: number;
  pb_min: number;
  pb_max: number;
  pass_score: number;
}

export interface WorkStdValue {
  content: string;
  author?: string; // ⚠ 자유 문자열. users FK 가 아니다
}

export interface MasterCodeDto<V = Record<string, unknown> | null> {
  id: number;
  group_code: MasterGroupCode;
  code: string;
  name: string;
  value: V;
  sort_order: number;
  version: number;
  active: boolean;
  created_at: string;
}

export type QualityStandardDto = MasterCodeDto<QualityStdValue>;
export type WorkStandardDto = MasterCodeDto<WorkStdValue>;

/** GET /master/code-groups */
export interface MasterCodeGroupDto {
  group_code: MasterGroupCode;
  count: number;
}

export interface QualityStandardIn {
  product_code: string;
  sn_min: number;
  sn_max: number;
  ag_min: number;
  ag_max: number;
  cu_min: number;
  cu_max: number;
  pb_min: number;
  pb_max: number;
  pass_score: number;
}

export interface WorkStandardIn {
  process_code: string;
  title: string;
  content: string;
  version?: number;
}

export interface MasterCodeIn {
  group_code: MasterGroupCode;
  code: string;
  name: string;
  sort_order?: number;
}

// ── 9.8 kpi_targets + KPI 응답 — FE-RT-43·44·45 ─────────────────────────────

export type KpiKey =
  | 'yield_pct'
  | 'production_volume'
  | 'defect_rate'
  | 'quality_avg'
  | 'pass_rate'
  | 'claim_rate';

export type KpiDirection = 'higher_better' | 'lower_better';

export interface KpiTargetDto {
  kpi_key: KpiKey;
  period: string; // "YYYY-MM"
  target_value: number | null; // null = 목표 미설정
  actual_value: number | null; // 월 마감 스냅샷 (화면 표시 출처가 아니다)
  actual_updated_at: string | null; // null = 미마감
  direction: KpiDirection; // **서버가 준다 — 프론트가 하드코딩하지 마라**
  achieved: boolean | null; // target 이 null 이면 null
}

export interface KpiTargetIn {
  kpi_key: KpiKey;
  period: string;
  target_value: number;
}

export interface KpiProductionRow {
  month: string;
  yield_pct: number;
  production_volume: number; // 단위: LOT
  defect_rate: number;
  target: {
    yield_pct: number | null;
    production_volume: number | null;
    defect_rate: number | null;
  };
  achieved: {
    yield_pct: boolean | null;
    production_volume: boolean | null;
    defect_rate: boolean | null;
  };
}

export interface KpiQualityRow {
  month: string;
  quality_avg: number;
  pass_rate: number;
  claim_rate: number; // COUNT(claims)/COUNT(shipments)*100
  target: {
    quality_avg: number | null;
    pass_rate: number | null;
    claim_rate: number | null;
  };
  achieved: {
    quality_avg: boolean | null;
    pass_rate: boolean | null;
    claim_rate: boolean | null;
  };
}

export const KPI_LABELS: Record<KpiKey, string> = {
  yield_pct: '수율',
  production_volume: '생산량',
  defect_rate: 'LOT 불량률',
  quality_avg: '평균 품질 점수',
  pass_rate: '합격률',
  claim_rate: '클레임 발생률',
};

export const KPI_DECIMALS: Record<KpiKey, number> = {
  yield_pct: 1,
  production_volume: 0,
  defect_rate: 1,
  quality_avg: 2,
  pass_rate: 1,
  claim_rate: 1,
};

export const KPI_UNITS: Record<KpiKey, string> = {
  yield_pct: '%',
  production_volume: 'LOT',
  defect_rate: '%',
  quality_avg: '점',
  pass_rate: '%',
  claim_rate: '%',
};

// ── 9.9 integrations — FE-RT-33 ─────────────────────────────────────────────

export type IntegrationSystem = 'erp' | 'xrf';
export type IntegrationStatus = 'in_use' | 'not_in_use'; // enabled 에서 2값 파생

export interface IntegrationDto {
  system: IntegrationSystem; // ⚠ 이것이 식별자다 (id 가 아니다)
  type: string; // 'REST' 등
  endpoint: string;
  enabled: boolean;
  /** v1 은 항상 null — "동기화 이력 없음"으로 표시한다. 0 이나 임의 시각으로 채우지 마라 */
  last_sync_at: null;
  status: IntegrationStatus;
}

export interface IntegrationTestResult {
  ok: boolean;
  latency_ms: number | null;
  message: string;
}

export const INTEGRATION_STATUS_LABELS: Record<IntegrationStatus, string> = {
  in_use: '사용중',
  not_in_use: '미사용',
};

// ── 9.10 TrainingRowDto — FE-RT-11 ──────────────────────────────────────────

/**
 * 필드명이 `lots` 컬럼명과 다르다 (`sn_ratio` → `sn_pct`, `temperature` → `melt_temp_c`).
 * `src/features/engineering.py` 의 `NUM_COLS` 와 맞춘 것이고 **서버가 매핑한다.**
 */
export interface TrainingRowDto {
  lot_id: string;
  date: string;
  supplier_code: SupplierCode;
  sn_pct: number;
  ag_pct: number;
  cu_pct: number;
  pb_pct: number;
  melt_temp_c: number | null;
  melt_time_min: number | null;
  quality_score: number | null;
  used_in_training: boolean; // quality_score IS NOT NULL (서버 파생)
}

export interface TrainingDataSummary {
  rows: number;
  date_min: string;
  date_max: string;
  quality_mean: number;
  quality_std: number;
}

/** GET /training-data — 목록 봉투 + summary */
export interface TrainingDataPage extends Page<TrainingRowDto> {
  summary: TrainingDataSummary;
}

/** POST /training-data/upload */
export interface TrainingUploadResult {
  accepted: number;
  rejected: number;
  errors: { row: number; message: string }[];
}

// ── 공통 헬스체크 ───────────────────────────────────────────────────────────

export interface HealthDto {
  status: string;
  loaded_models: string[];
  available_models: string[];
}
