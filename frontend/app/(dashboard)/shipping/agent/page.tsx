"use client";

/**
 * FE-RT-20 — 출하 AI Agent · `/shipping/agent` · `FR-S-05`
 *
 * 🔴 **v1.1 게이트 필수 화면**이다 (`agent-architecture.md` §2.12).
 *
 * ── 이 화면의 내력 ────────────────────────────────────────────────────────
 * 초판이 이 프로젝트에서 **조용한 실패가 가장 노골적인 곳**이었다.
 * `MOCK_RESPONSES` 3건을 900ms 지연 뒤 뿌려 동작하는 것처럼 보이게 했고,
 * "연결 데이터소스 · 연결됨" 초록불 4개가 붙어 있었다. 연결된 것은 없었다.
 *
 * 그다음 버전은 그것을 지우고 501 을 그대로 보여줬다. 정직했지만 화면이
 * 자기 상태를 상수로 갖고 있어 서버 상태와 어긋날 수 있었다.
 *
 * 지금은 `GET /agents/health` **하나만** 보고 판단한다 (§2.9).
 * 대화는 `agent_sessions`·`agent_messages` 에 저장된다 — 이제 테이블이 있다.
 *
 * 대화 UI 는 `components/agent/AgentChat` 이 갖고 있다. FE-RT-10 입고 Agent 와
 * 같은 계약이라 따로 구현하면 한쪽만 고쳐진다.
 */

import { AgentChat } from "@/components/agent/AgentChat";
import { askShippingAgent } from "@/lib/koryo-api";
import { PageHeader, PageShell } from "../../_g1/ui";

/** `FR-S-05` 원문 2구절 + 실제 코퍼스로 답할 수 있는 것 */
const EXAMPLES = [
  "이번 주 출하 실적을 고객사별로 정리해줘",
  "최근 클레임 현황과 처리 상태를 알려줘",
  "출하 전에 확인해야 하는 항목이 뭐야?",
  "LOT 번호 체계가 어떻게 돼?",
] as const;

export default function ShippingAgentPage() {
  return (
    <PageShell>
      <PageHeader
        title="출하 AI Agent"
        subtitle="출하 LOT 품질 요약 및 출하 기준 조회 (FR-S-05)"
      />
      <AgentChat
        title="포장출하 AI Agent"
        scope="shipping"
        intro={
          "출하 데이터와 사내 기준 문서에 대해 질문해 주세요.\n" +
          "출하 이력, 클레임 현황, 작업표준서·품질기준서의 출하·검사 기준을 다룹니다."
        }
        exampleQuestions={EXAMPLES}
        ask={askShippingAgent}
      />
    </PageShell>
  );
}
