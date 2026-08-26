import { AppLayout } from "@/components/layout/AppLayout";
import { StatusScreen } from "@/components/layout/StatusScreen";

/**
 * 앱 전역 404.
 *
 * 오류 계약(SF-TD4 §5)의 404 와 같은 상태지만 문구가 다르다.
 * 계약의 `"모델을 찾을 수 없습니다"` 는 **API 가 모델 파일을 못 찾은 경우**의 문구다
 * (`lib/error-contract.ts` 가 그쪽을 담당한다). 여기는 존재하지 않는 **URL** 이므로
 * 사용자에게는 페이지가 없다고 말해야 맞다. 새 오류 코드를 만든 게 아니라 같은 404 다.
 *
 * 사이드바를 함께 렌더해서 돌아갈 길을 남긴다 — 빈 화면에 사용자를 가두지 않는다.
 */
export default function NotFound() {
  return (
    <AppLayout title="페이지를 찾을 수 없습니다">
      <StatusScreen
        tone="empty"
        title="페이지를 찾을 수 없습니다"
        detail="주소가 잘못되었거나 삭제된 화면입니다. 왼쪽 메뉴에서 원하는 화면을 선택하세요."
        actions={[{ label: "생산 현황으로", href: "/dashboard/production", primary: true }]}
        source="HTTP 404"
      />
    </AppLayout>
  );
}
