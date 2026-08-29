"use client";

/**
 * FE-RT-15 — 배합 AI Agent · `/mixing/agent` · `FR-M-05`
 *
 * ── 2026-08-30: 501 을 해제했다 ──────────────────────────────────────────────
 * 초판에는 `MOCK_RESPONSES` 사전과 900ms 지연 연출이 있었다. 그걸 걷어내고
 * 501 을 정직하게 보여주는 상태로 두었다가, 오케스트레이터·도구·검증기가
 * 갖춰진 지금 연다.
 *
 * ── 도구 3개는 기존 API 와 **같은 함수**를 부른다 ───────────────────────────
 * `predict_quality` → `app.predict()` · `recommend_mix` → `app.recommend()`.
 * 여기서 다시 구현하면 경계 검증(`API_BOUNDS`)·피처 순서(`BUG-001`)·baseline
 * 차단이 두 벌이 되고 한쪽만 고쳐지는 날이 온다. 실제로 **Agent 가 추천한
 * 배합을 예측 API 가 거부하는** 모순이 있었다(2차 QA).
 *
 * ── 모델 목록 도구는 없다 ───────────────────────────────────────────────────
 * 설계서 §7.7 T-5 가 `ml_models` 를 "어느 역할에도 도구로 노출되지 않는"
 * 테이블로 못박았다. 모델 성능은 FE-RT-16 모델 관리 화면이 보여준다.
 *
 * ⚠ `sales` 는 이 화면에서 도구를 못 쓴다 (`ROLE_SCOPES`). 배합은 제조·품질의
 *   일이고, 영업이 배합비를 조회할 업무 근거가 없다. 문서 근거로는 답한다.
 */

import { AgentChat } from "@/components/agent/AgentChat";
import { askMixingAgent } from "@/lib/koryo-api";
import { PageHeader, PageShell } from "../../_g1/ui";

/** 조회형(도구)과 기준형(문서)을 섞었다 — 이 화면이 둘 다 한다 */
const EXAMPLES = [
  // 도구 — 예측·추천·실적
  "250도 45분 SUP_A 조건에서 최적 배합비율을 추천해줘",
  "Sn 62 Ag 3 Cu 0.5 배합의 품질 점수를 예측해줘",
  "260도로 올리면 추천 배합이 어떻게 달라져?",
  "최근 30일 배합 실적 중 불합격 LOT 을 보여줘",
  "SUP_B 조건에서 추천 배합을 알려줘",
  // 문서 — 배합 기준·절차
  "배합 편차가 규격 폭 50 % 를 넘었어. 어떻게 해?",
  "유연 배치 500 kg 인데 Sn 이 62.30 % 나왔어. 63.00 % 로 맞추려면 순 Sn 을 몇 kg 넣어야 해?",
  "보정 원료를 넣은 뒤에 뭘 해야 해?",
  "배합 이론값은 어떻게 계산해?",
  "SAC305 의 Ag 규격이 몇 % 야?",
] as const;

export default function MixingAgentPage() {
  return (
    <PageShell>
      <PageHeader
        title="배합 AI Agent"
        subtitle="배합비율 예측·최적화 및 배합 기준 조회 (FR-M-05)"
      />
      <AgentChat
        title="배합비율 최적화 AI Agent"
        scope="mixing"
        intro={
          "배합비율을 묻거나, 공정 조건을 주고 최적 배합을 요청하세요.\n" +
          "작업표준서의 배합 절차와 보정량 계산식도 함께 답합니다.\n\n" +
          "추천값은 예상치입니다. 투입 후 XRF 재측정으로 확인해야 하며, " +
          "계산만으로 합격 판정을 내리는 것은 금지입니다 (WS-KS-001 부속서 B)."
        }
        exampleQuestions={EXAMPLES}
        ask={askMixingAgent}
      />
    </PageShell>
  );
}
