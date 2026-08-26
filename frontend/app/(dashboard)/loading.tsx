import { StatusScreen } from "@/components/layout/StatusScreen";

/**
 * 44화면 공통 로딩 화면.
 *
 * 라우트 전환 중 서버 작업이 끝나기 전까지 사이드바·헤더는 그대로 두고 본문만 이걸로 채운다.
 * 화면 안에서 카드 하나가 로딩 중인 경우에는 이걸 쓰지 마라 —
 * 그 카드 안에서 `<Spinner />` 를 돌린다 (specs/design-standards.md §3).
 */
export default function DashboardLoading() {
  return <StatusScreen tone="loading" title="불러오는 중" detail="잠시만 기다려 주세요." />;
}
