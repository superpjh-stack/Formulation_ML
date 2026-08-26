"""고려솔더 AI 스마트공장 — API 레이어 (`/api/v1`).

계약: `contracts/api-contract.md` (경로·권한·오류·감사로그의 단일 진실).

모듈 구성
    deps.py           JWT 발급·검증, `get_current_user`, `require_roles` (§3)
    middleware.py     감사로그 미들웨어 · deprecated 별칭 헤더 (§6)
    errors.py         전역 예외 핸들러 — 503/401/403/404/409 (§5)
    model_cache.py    ML 모델 싱글톤 (`DEF-IT-001` 회귀 방지)
    serialization.py  NaN/Inf/Decimal/numpy 직렬화 (`DEF-IT-002` 회귀 방지, §4.1)
    schemas.py        페이징 봉투 · 공통 쿼리 (§4.2·§4.3)
    settings_store.py `system_settings` 키-값 접근 계층
    dto.py            테이블 → 응답 DTO 변환 (ts-types.md §5)
    router.py         `/api/v1` 라우터 조립
    routers/          그룹별 라우터
"""
