import type { KeyboardEvent } from "react";

/**
 * 한글 조합(IME) 중의 `Enter` 인가.
 *
 * ⚠ **한글 입력에서 `e.key === "Enter"` 만 보면 안 된다.**
 *
 * 한글은 조합형이라 `강` 을 치면 `ㄱ→가→강` 순으로 조합되고, 그 상태에서 `Enter` 는
 * **"조합을 확정한다"** 는 뜻이다. 전송하라는 뜻이 아니다. 그런데 확정 `Enter` 도
 * `keydown` 을 발생시키므로, 가드가 없으면 **문장이 중간에 잘린 채 전송된다.**
 *
 * 예: `불량률이 높은` 까지 치고 마지막 글자를 확정하려 `Enter` → `불량률이 높` 이 전송됨.
 *
 * 외부 LLM API 를 쓰기로 하면서 이 결함은 UX 문제에서 **비용 문제**가 됐다 —
 * 잘린 질문 → 엉뚱한 답 → 다시 입력 → **호출 2배**.
 *
 * 판정은 두 겹이다:
 *   - `nativeEvent.isComposing` — 표준. 최신 브라우저가 조합 중에 `true`
 *   - `keyCode === 229` — 레거시 폴백. 일부 브라우저·IME 가 조합 중 이 값을 준다
 *
 * 사용:
 * ```tsx
 * onKeyDown={(e) => {
 *   if (isComposing(e)) return;          // 조합 확정 — 전송하지 않는다
 *   if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
 * }}
 * ```
 */
export function isComposing(e: KeyboardEvent<HTMLElement>): boolean {
  const native = e.nativeEvent as unknown as { isComposing?: boolean; keyCode?: number };
  return native?.isComposing === true || native?.keyCode === 229;
}

/**
 * "조합 중이 아닌 Shift 없는 Enter" — 전송 키인가.
 *
 * 위 두 조건을 한 번에 본다. 세 화면이 같은 판정을 각자 쓰고 있어 한 곳으로 모았다.
 */
export function isSubmitKey(e: KeyboardEvent<HTMLElement>): boolean {
  return e.key === "Enter" && !e.shiftKey && !isComposing(e);
}
