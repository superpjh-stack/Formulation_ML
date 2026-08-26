/**
 * 고려솔더 **뷰모델 정의 + DB 시드 원본**.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * 🔴 **런타임 데이터 경로에서 이 파일의 상수를 import 하지 마라.**
 *    화면 데이터는 전부 `lib/koryo-api.ts` → `hooks/useKoryoData.ts` 로만 온다.
 *    이 파일의 배열은 이제 `db-schema.md` §4.1 의 **DB 시드 원본**일 뿐이다.
 *    API 응답으로 위장시키면 goal.md 3절 "조용한 실패"와 같은 죄다.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * 인터페이스 6종(camelCase)은 **뷰모델로 유지**한다 (`ts-types.md` §1.1 ③).
 * 42화면이 이 형태를 쓰고 있어 snake_case 로 바꾸면 전부 깨진다.
 * DTO(snake_case) ↔ 뷰모델(camelCase) 변환은 `lib/koryo-api.ts` 의 매퍼가 한다.
 *
 * ⚠ 이전 버전은 모듈 스코프에서 `Math.random()` 을 호출했다
 * (`design-standards.md` §7 #1). 서버 컴포넌트가 import 하는 순간 서버/클라이언트가
 * 다른 값을 만들어 **hydration mismatch** 가 난다. 아래 생성기는 고정 시드 LCG 라
 * import 순서·실행 환경과 무관하게 항상 같은 배열을 만든다.
 */

export interface LotRecord {
  lotId: string;
  date: string;
  supplier: string;
  snRatio: number;
  agRatio: number;
  cuRatio: number;
  pbRatio: number;
  qualityScore: number;
  status: 'pass' | 'fail' | 'warning';
}

export interface ComponentData {
  date: string;
  sn: number;
  ag: number;
  cu: number;
  pb: number;
  snDeviation: number;
  agDeviation: number;
  cuDeviation: number;
}

export interface EquipmentStatus {
  id: string;
  name: string;
  status: 'normal' | 'warning' | 'error' | 'maintenance';
  temperature: number;
  uptime: number; // hours
  lastMaintenance: string;
}

export interface KpiData {
  month: string;
  yield: number;
  defectRate: number;
  /**
   * ⚠ **`null` 을 그대로 화면까지 보낸다.** 투입/산출량 저장 컬럼이 없어
   * 서버가 `null` 을 줄 수 있고 (`api-contract.md` §8.11), 0 으로 채우면
   * "생산 0" 으로 오독된다 (`ts-types.md` §3.1). 화면은 위젯을 숨겨라.
   */
  productionVolume: number | null;
  /** `/kpi/quality` 에 해당 월이 없으면 null. 0 으로 채우지 마라 */
  qualityAvg: number | null;
}

export interface QualityResult {
  date: string;
  lotId: string;
  score: number;
  passed: boolean;
  model: string;
}

export interface AlertItem {
  id: string;
  level: 'info' | 'warning' | 'critical';
  message: string;
  timestamp: string;
  resolved: boolean;
}

// ── LOT 목록 ──────────────────────────────────────────────────────────────────
export const LOT_LIST: LotRecord[] = [
  { lotId: 'LOT-2026-001', date: '2026-06-27', supplier: 'SUP_A', snRatio: 62.1, agRatio: 3.0, cuRatio: 0.5, pbRatio: 34.4, qualityScore: 87.2, status: 'pass' },
  { lotId: 'LOT-2026-002', date: '2026-06-26', supplier: 'SUP_B', snRatio: 61.8, agRatio: 3.2, cuRatio: 0.48, pbRatio: 34.52, qualityScore: 84.1, status: 'pass' },
  { lotId: 'LOT-2026-003', date: '2026-06-25', supplier: 'SUP_A', snRatio: 63.5, agRatio: 2.8, cuRatio: 0.55, pbRatio: 33.15, qualityScore: 72.3, status: 'warning' },
  { lotId: 'LOT-2026-004', date: '2026-06-24', supplier: 'SUP_C', snRatio: 61.2, agRatio: 3.1, cuRatio: 0.5, pbRatio: 35.2, qualityScore: 65.8, status: 'fail' },
  { lotId: 'LOT-2026-005', date: '2026-06-23', supplier: 'SUP_A', snRatio: 62.0, agRatio: 3.0, cuRatio: 0.5, pbRatio: 34.5, qualityScore: 89.4, status: 'pass' },
  { lotId: 'LOT-2026-006', date: '2026-06-22', supplier: 'SUP_B', snRatio: 62.3, agRatio: 2.9, cuRatio: 0.52, pbRatio: 34.28, qualityScore: 85.7, status: 'pass' },
  { lotId: 'LOT-2026-007', date: '2026-06-21', supplier: 'SUP_A', snRatio: 61.9, agRatio: 3.05, cuRatio: 0.49, pbRatio: 34.56, qualityScore: 88.0, status: 'pass' },
  { lotId: 'LOT-2026-008', date: '2026-06-20', supplier: 'SUP_C', snRatio: 64.0, agRatio: 2.7, cuRatio: 0.6, pbRatio: 32.7, qualityScore: 60.2, status: 'fail' },
  { lotId: 'LOT-2026-009', date: '2026-06-19', supplier: 'SUP_B', snRatio: 62.1, agRatio: 3.0, cuRatio: 0.5, pbRatio: 34.4, qualityScore: 86.5, status: 'pass' },
  { lotId: 'LOT-2026-010', date: '2026-06-18', supplier: 'SUP_A', snRatio: 62.4, agRatio: 2.95, cuRatio: 0.51, pbRatio: 34.14, qualityScore: 83.9, status: 'pass' },
];

// ── 성분 이력 시드 (90일) ─────────────────────────────────────────────────────
//
// 🔴 `Math.random()` 을 다시 쓰지 마라. 모듈 스코프 난수는 서버/클라이언트가 다른 값을
//    만들어 hydration mismatch 를 낸다 (design-standards.md §7 #1).
//    아래 LCG 는 고정 시드라 항상 같은 배열을 만든다.

/** 결정적 난수 — 시드 42 (백엔드 학습 스크립트와 같은 시드) */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    // Numerical Recipes LCG
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

export function generateComponentHistory(days: number, seed = 42): ComponentData[] {
  const SN_TARGET = 62.0;
  const AG_TARGET = 3.0;
  const CU_TARGET = 0.5;
  const rand = seededRandom(seed);
  const result: ComponentData[] = [];
  const now = new Date('2026-06-27T00:00:00Z');
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - i);
    const sn = +(SN_TARGET + (rand() - 0.5) * 4).toFixed(2);
    const ag = +(AG_TARGET + (rand() - 0.5) * 0.6).toFixed(3);
    const cu = +(CU_TARGET + (rand() - 0.5) * 0.2).toFixed(3);
    const pb = +(100 - sn - ag - cu).toFixed(2);
    result.push({
      date: d.toISOString().slice(0, 10),
      sn, ag, cu, pb,
      snDeviation: +(sn - SN_TARGET).toFixed(2),
      agDeviation: +(ag - AG_TARGET).toFixed(3),
      cuDeviation: +(cu - CU_TARGET).toFixed(3),
    });
  }
  return result;
}
/** DB 시드 원본. 화면에서 쓰지 마라 — `koryo-api.getComponentHistory()` 를 써라 */
export const COMPONENT_HISTORY: ComponentData[] = generateComponentHistory(90);

// ── 설비 상태 ──────────────────────────────────────────────────────────────────
export const EQUIPMENT_STATUS: EquipmentStatus[] = [
  { id: 'EQ-001', name: '솔더링 머신 #1', status: 'normal', temperature: 248, uptime: 1420, lastMaintenance: '2026-06-01' },
  { id: 'EQ-002', name: '솔더링 머신 #2', status: 'warning', temperature: 258, uptime: 980, lastMaintenance: '2026-05-15' },
  { id: 'EQ-003', name: '용해로 #1', status: 'normal', temperature: 251, uptime: 2100, lastMaintenance: '2026-06-10' },
  { id: 'EQ-004', name: '용해로 #2', status: 'maintenance', temperature: 0, uptime: 0, lastMaintenance: '2026-06-27' },
  { id: 'EQ-005', name: '품질검사기 #1', status: 'normal', temperature: 25, uptime: 3600, lastMaintenance: '2026-04-20' },
  { id: 'EQ-006', name: '배합기 #1', status: 'error', temperature: 0, uptime: 0, lastMaintenance: '2026-05-30' },
];

// ── KPI 월별 ──────────────────────────────────────────────────────────────────
export const KPI_MONTHLY: KpiData[] = [
  { month: '2026-01', yield: 92.1, defectRate: 2.3, productionVolume: 4800, qualityAvg: 84.2 },
  { month: '2026-02', yield: 91.5, defectRate: 2.8, productionVolume: 4200, qualityAvg: 83.1 },
  { month: '2026-03', yield: 93.0, defectRate: 2.0, productionVolume: 5100, qualityAvg: 85.7 },
  { month: '2026-04', yield: 93.8, defectRate: 1.8, productionVolume: 5300, qualityAvg: 86.4 },
  { month: '2026-05', yield: 94.2, defectRate: 1.6, productionVolume: 5500, qualityAvg: 87.1 },
  { month: '2026-06', yield: 94.8, defectRate: 1.4, productionVolume: 3200, qualityAvg: 87.8 },
];

// ── 품질 이력 ──────────────────────────────────────────────────────────────────
export const QUALITY_HISTORY: QualityResult[] = LOT_LIST.map((lot) => ({
  date: lot.date,
  lotId: lot.lotId,
  score: lot.qualityScore,
  passed: lot.status === 'pass',
  model: 'gradient_boosting',
}));

// ── 입고 이력 ──────────────────────────────────────────────────────────────────
export const RECEIVING_HISTORY = [
  { id: 'RCV-001', date: '2026-06-25', supplier: 'SUP_A', material: 'Sn ingot', quantity: 500, unit: 'kg', status: 'accepted' },
  { id: 'RCV-002', date: '2026-06-24', supplier: 'SUP_B', material: 'Ag powder', quantity: 25, unit: 'kg', status: 'accepted' },
  { id: 'RCV-003', date: '2026-06-23', supplier: 'SUP_C', material: 'Cu wire', quantity: 10, unit: 'kg', status: 'rejected' },
  { id: 'RCV-004', date: '2026-06-22', supplier: 'SUP_A', material: 'Pb ingot', quantity: 300, unit: 'kg', status: 'accepted' },
  { id: 'RCV-005', date: '2026-06-20', supplier: 'SUP_B', material: 'Sn ingot', quantity: 450, unit: 'kg', status: 'accepted' },
];

// ── 출하 이력 ──────────────────────────────────────────────────────────────────
export const SHIPPING_HISTORY = [
  { id: 'SHP-001', date: '2026-06-27', customer: 'CUST-A', product: 'Sn62 솔더', quantity: 200, unit: 'kg', qualityScore: 87.2 },
  { id: 'SHP-002', date: '2026-06-26', customer: 'CUST-B', product: 'Sn63 솔더', quantity: 150, unit: 'kg', qualityScore: 84.1 },
  { id: 'SHP-003', date: '2026-06-25', customer: 'CUST-A', product: 'Sn62 솔더', quantity: 300, unit: 'kg', qualityScore: 72.3 },
  { id: 'SHP-004', date: '2026-06-24', customer: 'CUST-C', product: 'Sn60 솔더', quantity: 100, unit: 'kg', qualityScore: 65.8 },
];

// ── 알림 ──────────────────────────────────────────────────────────────────────
export const ALERTS: AlertItem[] = [
  { id: 'ALT-001', level: 'critical', message: 'LOT-2026-008 품질 점수 60.2 — 불합격 기준(70) 미달', timestamp: '2026-06-20T09:15:00', resolved: false },
  { id: 'ALT-002', level: 'warning', message: 'EQ-002 솔더링 머신 #2 온도 258°C 초과 (기준: 255°C)', timestamp: '2026-06-27T08:30:00', resolved: false },
  { id: 'ALT-003', level: 'critical', message: 'EQ-006 배합기 #1 오류 발생 — 즉시 점검 필요', timestamp: '2026-06-27T07:00:00', resolved: false },
  { id: 'ALT-004', level: 'warning', message: 'SUP_C 원자재 Sn 편차 +1.5% 초과 감지', timestamp: '2026-06-25T14:20:00', resolved: true },
  { id: 'ALT-005', level: 'info', message: '6월 수율 94.8% — 목표(93%) 초과 달성', timestamp: '2026-06-27T06:00:00', resolved: false },
  { id: 'ALT-006', level: 'warning', message: 'LOT-2026-003 Sn 비율 63.5% — 목표 대비 +1.5% 편차', timestamp: '2026-06-25T11:45:00', resolved: true },
];
