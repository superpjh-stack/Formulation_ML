"use client";

/**
 * FE-RT-10 — 입고 AI Agent · `/receiving/agent` · `FR-R-05`
 *
 * 🔴 **v1.1 게이트 필수 화면**이다 (`agent-architecture.md` §2.12).
 *    선택 요구사항이었으나 사업계획서 p.23 「⓶ 입고/보관 공정 – RAG 기반 AI Agent
 *    적용」이 명시한 범위라 필수로 승격됐다.
 *
 * ── 이전 버전에서 걷어낸 것 ────────────────────────────────────────────────
 * 초판에는 `MOCK_RESPONSES` 5문답 사전과 `setTimeout(900)` 지연 연출, 초록
 * `● 온라인` 배지가 있었다. 서버가 501 인데 화면은 답을 하고 온라인이라고
 * 말했다. 존재하지 않는 `SUP_D`·`글로벌메탈` 을 근거로 든 답변도 있었다.
 *
 * 그다음 버전은 그것을 지우고 `AGENT_ENABLED = false` 상수로 화면을 잠갔다.
 * 정직했지만 **상수가 서버 상태와 무관**했다 — 서버가 준비돼도 화면은 계속
 * 잠겨 있고, 반대로 상수만 켜면 서버가 죽어도 열려 있다.
 *
 * 지금은 상수를 없앴다. 준비 여부는 `GET /agents/health` **하나만** 보고
 * 판단한다 (§2.9). 화면이 자기 상태를 추측하지 않는다.
 *
 * 대화 UI 는 `components/agent/AgentChat` 이 갖고 있다 — FE-RT-20 출하 Agent 와
 * 같은 계약이라 따로 구현하면 한쪽만 고쳐지는 일이 생긴다.
 */

import { AgentChat } from "@/components/agent/AgentChat";
import { askReceivingAgent } from "@/lib/koryo-api";
import { PageHeader, PageShell } from "../../_g1/ui";

/** `SF-AD2` §1.2 `FR-R-05` 본문 + 실제 코퍼스(WS-KS-001·QS-KS-001)로 답할 수 있는 것 */
const EXAMPLES = [
  "SUP_A 최근 90일 성분 편차가 어땠어?",
  "공급사별 Sn 편차 안정성을 비교해줘",
  "입고 원재료 성분은 무엇을 기준으로 등록해?",
  "무연 제품 납 상한이 얼마야?",
] as const;

export default function ReceivingAgentPage() {
  return (
    <PageShell>
      <PageHeader
        title="입고 AI Agent"
        subtitle="공급사별 성분 편차 패턴 분석 및 입고 기준 조회 (FR-R-05)"
      />
      <AgentChat
        title="입고관리 AI Agent"
        intro={
          "입고 데이터와 사내 기준 문서에 대해 질문해 주세요.\n" +
          "공급사별 성분 편차, 입고 이력, 작업표준서·품질기준서의 입고 관련 기준을 다룹니다."
        }
        exampleQuestions={EXAMPLES}
        ask={askReceivingAgent}
      />
    </PageShell>
  );
}
