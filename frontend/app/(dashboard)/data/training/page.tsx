"use client";

/**
 * FE-RT-37 — 학습 데이터 · `/data/training` · FR-DT-05 (**선택**)
 *
 * 명세: `specs/plan-g3.md` FE-RT-37. 와이어프레임 없음(SF-TD3 §3).
 * 저장 테이블: **없음 — 501 유지.** CR-DB-001 이 *"우선순위가 '선택'이며 v1 범위에서
 * 화면 동작까지만 구현하므로 본 개정에 포함하지 않는다"* 로 **의도적으로 제외**했다
 * (db-schema §6.2·§6.12). 향후 **CR-DB-002** 후보다.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * v1 범위 — 선택 요구사항이므로 **UI 동작까지만** (goal.md 2.1)
 *
 *   | 기능 | v1 |
 *   |---|---|
 *   | 데이터셋 목록 조회 | ✅ `GET /training-datasets` 연동 (501 배너) |
 *   | 레이블링 진행률 | ✅ 응답 필드가 있으면 표시, 없으면 열 숨김 |
 *   | 레이블링 편집 | ❌ 계약 누락 — 쓰기 엔드포인트가 없다 |
 *   | 재학습 트리거 | ❌ **범위 밖** (아래 3건) |
 *   | 새 데이터셋 생성 | ❌ 계약 누락 — POST 없음 |
 *
 * **재학습 트리거를 만들지 않는 이유**
 *   1. `/training-datasets` 는 **GET 하나뿐**이다. 학습 실행 엔드포인트가 계약에 없다
 *   2. NFR-M-01 은 *"분기별 1회 이상 재학습 **가능 구조**"* 를 요구한다 — 화면 버튼이
 *      아니라 **구조**다. 현재 재학습 경로는 `scripts/train.py` CLI 다
 *   3. 학습 실행은 저장된 4개 모델을 교체하는 **파괴적 작업**이라, 계약 없이 버튼을
 *      노출하면 FE-RT-13(품질 예측)·FE-RT-14(배합 최적화)를 한 번에 망가뜨릴 수 있다
 *
 * 라운드 2 에서 지운 것:
 *   - 하드코딩 데이터셋 6건
 *   - 재학습 모달 + 실행 함수 — **상태만 `학습중` 으로 바꾸고 아무 API 도 부르지 않으면서
 *     "재학습이 시작되었습니다" 토스트를 띄워 동작하는 것처럼 보이게 했다** (goal.md 3절 위반)
 *   - `+ 새 데이터셋 생성` 버튼 (`onClick` 없음)
 *   - 데이터셋별 R²/RMSE(`0.921` 등) — **계약에 데이터셋 단위 성능 필드가 없고,
 *     실측 최고 R² 는 GB 0.8739(합성 데이터)다. 근거 없는 수치이며
 *     api-contract §7.4 의 허위 인용 금지에 저촉된다**
 *   - mock 파생 KPI 카드 4개(`bestAcc`·`totalRows` 등)
 *
 * ⚠ `/training-data`(FE-RT-11) 와 **혼동하지 마라.** 경로명이 비슷하지만 다른
 *   엔드포인트다 (`/training-data` vs `/training-datasets`).
 *
 * ⚠ `TrainingDatasetOut` 의 필드가 **DB 도 계약도 정의한 바가 없다.**
 *   **필드를 발명하지 않는다** — FE-RT-34 와 같은 방식(응답 키 기반 동적 렌더링)으로
 *   서버가 실제로 주는 키를 표시한다 (§5).
 * ══════════════════════════════════════════════════════════════════════════════
 */

import { useMemo, useState } from "react";
import { getTrainingDatasets } from "@/lib/koryo-api";
import { T } from "@/components/ui/tokens";
import { InlineError, PageHeader, PageShell, Pagination, Section } from "../../_g1/ui";
import { PendingBanner, cell, isNotImplemented, useApi } from "../../_g3/ui";

const PAGE_SIZE = 50;

export default function DataTrainingPage() {
  const [page, setPage] = useState(1);

  const state = useApi(() => getTrainingDatasets({ page, page_size: PAGE_SIZE }), [page]);

  const pending = isNotImplemented(state.status, state.error);
  const rows = useMemo(() => state.data?.items ?? [], [state.data]);
  const total = state.data?.total ?? 0;

  /** 열은 **응답 키에서 파생**한다. 라벨을 지어내지 않는다 */
  const columns = useMemo(() => {
    const keys: string[] = [];
    for (const r of rows) {
      for (const k of Object.keys(r)) if (!keys.includes(k)) keys.push(k);
    }
    return keys;
  }, [rows]);

  return (
    <PageShell>
      <PageHeader title="학습 데이터" subtitle="ML 재학습용 학습 데이터셋 현황" />

      {pending && (
        <PendingBanner note="학습 데이터셋을 저장할 테이블이 없어 조회 결과가 0건입니다. 재학습 실행은 v1 범위 밖이며, 현재 재학습 경로는 scripts/train.py CLI 입니다." />
      )}

      {/* 501 이 아닌 실패는 오류로 그린다 */}
      {!pending && state.error && <InlineError message={state.error} onRetry={state.refetch} />}

      <Section title={`데이터셋 목록 (${pending ? 0 : total.toLocaleString()}건)`}>
        <div style={{ overflowX: "auto", border: `1px solid ${T.border}`, borderRadius: 12 }}>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: 12.5,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            <thead>
              <tr style={{ background: "#F8F9FB" }}>
                {columns.length === 0 ? (
                  <th
                    style={{
                      padding: "10px 12px",
                      fontSize: 12,
                      fontWeight: 600,
                      color: T.textSub,
                      textAlign: "left",
                      borderBottom: `1px solid ${T.border}`,
                    }}
                  >
                    데이터셋
                  </th>
                ) : (
                  columns.map((k) => (
                    <th
                      key={k}
                      style={{
                        padding: "10px 12px",
                        fontSize: 12,
                        fontWeight: 600,
                        color: T.textSub,
                        textAlign: "left",
                        whiteSpace: "nowrap",
                        borderBottom: `1px solid ${T.border}`,
                      }}
                    >
                      {k}
                    </th>
                  ))
                )}
              </tr>
            </thead>
            <tbody>
              {state.loading && (
                <tr>
                  <td
                    colSpan={Math.max(1, columns.length)}
                    style={{ padding: "28px 12px", textAlign: "center", color: T.textMuted }}
                  >
                    불러오는 중…
                  </td>
                </tr>
              )}

              {!state.loading && rows.length === 0 && (
                <tr>
                  <td
                    colSpan={Math.max(1, columns.length)}
                    style={{ padding: "28px 12px", textAlign: "center", color: T.textMuted }}
                  >
                    {pending
                      ? "v1 범위에서는 학습 데이터셋을 저장·조회하지 않습니다."
                      : "등록된 학습 데이터셋이 없습니다."}
                  </td>
                </tr>
              )}

              {!state.loading &&
                rows.map((row, i) => (
                  <tr key={i} style={{ borderTop: `1px solid ${T.border}` }}>
                    {columns.map((k) => (
                      <td
                        key={k}
                        style={{ padding: "9px 12px", color: T.text, whiteSpace: "nowrap" }}
                      >
                        {cell(row[k])}
                      </td>
                    ))}
                  </tr>
                ))}
            </tbody>
          </table>
        </div>

        {!pending && (
          <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />
        )}

        <span style={{ fontSize: 11, color: T.textMuted, lineHeight: 1.6 }}>
          ⓘ `TrainingDatasetOut` 의 필드 구성이 DB 에도 계약에도 정의돼 있지 않아, 서버가 주는
          응답 키를 그대로 열로 표시합니다. 스키마가 확정되면 열 라벨을 계약에 맞춰 고정합니다.
          모델 성능(R²/RMSE)은 데이터셋 단위 필드가 계약에 없어 표시하지 않습니다 — 모델 성능은
          FE-RT-13 이 담당합니다.
        </span>
      </Section>
    </PageShell>
  );
}
