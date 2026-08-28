"""개발2 담당 범위 계약 테스트 — 인증/RBAC · 감사로그 · 오류 계약 · 직렬화.

근거: `contracts/api-contract.md` §3(인증·RBAC) · §4.1(직렬화) · §5(오류 계약) ·
§6(감사로그) · §8.1.1(`/settings/public`) · §8.7(`PUT /settings` 422) · §8.10(Agent 501).

DB 가 필요한 테스트는 접속 실패 시 `skip` 한다 — 순수 로직 테스트는 DB 없이도 돈다.
"""
from __future__ import annotations

import datetime as dt
import json
import math

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from src.api import deps, serialization
from src.api.middleware import _canonical_path, _redact, _table_for
from src.api.settings_store import DEFAULTS, INTEGRATION_PREFIX

# ══════════════════════════════════════════════════════════════════════════
# §4.1 직렬화 — `DEF-IT-002` 회귀 방지
# ══════════════════════════════════════════════════════════════════════════
class TestSerialization:
    def test_nan_becomes_null(self):
        assert serialization.safe_float(float("nan")) is None
        assert serialization.safe_float(float("inf")) is None
        assert serialization.safe_float(float("-inf")) is None

    def test_numpy_scalar_becomes_python_float(self):
        np = pytest.importorskip("numpy")
        value = serialization.safe_float(np.float64(3.14159))
        assert isinstance(value, float) and not hasattr(value, "dtype")

    def test_single_sample_std_is_nan_and_serializes_to_null(self):
        """표본 1건이면 `std()` 는 NaN 이다 — 이것이 `DEF-IT-002` 의 원인이었다."""
        pd = pytest.importorskip("pandas")
        assert math.isnan(pd.Series([1.0]).std())
        assert serialization.safe_float(pd.Series([1.0]).std()) is None

    def test_clean_recurses(self):
        out = serialization.clean({"a": [float("nan"), 1.0], "b": {"c": float("inf")}})
        assert out == {"a": [None, 1.0], "b": {"c": None}}

    def test_delta_returns_none_not_zero(self):
        """전일 데이터가 없으면 `null` — 0 으로 채우면 0%p 변화와 구분이 안 된다 (§8.2)."""
        assert serialization.delta(10.0, None) is None
        assert serialization.delta(None, 10.0) is None
        assert serialization.delta(10.0, 8.0) == 2.0

    def test_pct_zero_denominator(self):
        assert serialization.pct(0, 0) is None
        assert serialization.pct(1, 4) == 25.0


# ══════════════════════════════════════════════════════════════════════════
# §3 인증 · RBAC
# ══════════════════════════════════════════════════════════════════════════
class _FakeUser:
    def __init__(self, uid=1, username="tester", role="viewer"):
        self.id, self.username, self.role = uid, username, role


class TestAuth:
    def test_bcrypt_roundtrip(self):
        h = deps.hash_password("admin1234")
        assert h.startswith("$2b$")
        assert deps.verify_password("admin1234", h)
        assert not deps.verify_password("wrong", h)

    def test_password_over_72_bytes_does_not_crash(self):
        """bcrypt 는 72바이트 초과를 거부한다 — 잘라서 넘겨야 500 이 안 난다."""
        long = "가" * 100
        assert deps.verify_password(long, deps.hash_password(long))

    def test_verify_against_broken_hash_is_false_not_exception(self):
        assert deps.verify_password("x", "not-a-hash") is False
        assert deps.verify_password("x", None) is False

    def test_token_claims_and_30min_expiry(self):
        """§3.1 — 클레임 5종, `exp = now + 1800s` (NFR-S-01 세션 30분)."""
        token = deps.create_access_token(_FakeUser(7, "kim", "quality"))
        payload = deps.decode_token(token)
        assert payload["sub"] == "kim"
        assert payload["uid"] == 7
        assert payload["role"] == "quality"
        assert payload["exp"] - payload["iat"] == deps.ACCESS_TOKEN_EXPIRE_SECONDS == 1800

    def test_expired_token_is_401(self):
        token = deps.create_access_token(_FakeUser(), expires_in=-1)
        with pytest.raises(HTTPException) as exc:
            deps.decode_token(token)
        assert exc.value.status_code == 401
        assert exc.value.detail == "로그인이 필요합니다"

    def test_tampered_token_is_401(self):
        token = deps.create_access_token(_FakeUser())
        with pytest.raises(HTTPException) as exc:
            deps.decode_token(token[:-3] + "abc")
        assert exc.value.status_code == 401

    def test_peek_never_raises(self):
        assert deps.peek_token_payload(None) is None
        assert deps.peek_token_payload("garbage") is None

    def test_five_roles_is_canon(self):
        """goal.md 2.3 · SF-TD5 §3.8 — 5역할. SF-AD2 의 4역할 표기는 산출물 결함이다."""
        assert deps.USER_ROLES == ("admin", "manufacture", "quality", "sales", "viewer")

    def test_require_roles_rejects_typo_at_import_time(self):
        """오타를 조용히 통과시키면 권한 게이트가 무력화된다."""
        with pytest.raises(ValueError):
            deps.require_roles("aadmin")

    def test_require_roles_403_message(self):
        dep = deps.require_roles("admin")
        with pytest.raises(HTTPException) as exc:
            dep(user=_FakeUser(role="viewer"))
        assert exc.value.status_code == 403
        assert exc.value.detail == "접근 권한이 없습니다"

    def test_require_roles_passes_allowed(self):
        dep = deps.require_roles("admin", "sales")
        user = _FakeUser(role="sales")
        assert dep(user=user) is user

    def test_viewer_is_never_in_write_gates(self):
        """`viewer` 는 모든 쓰기에 403 — 쓰기 게이트 목록에 넣지 마라."""
        dep = deps.require_roles("admin", "manufacture", "quality", "sales")
        with pytest.raises(HTTPException) as exc:
            dep(user=_FakeUser(role="viewer"))
        assert exc.value.status_code == 403


# ══════════════════════════════════════════════════════════════════════════
# §6 감사로그
# ══════════════════════════════════════════════════════════════════════════
class TestAudit:
    def test_canonical_path_strips_api_v1(self):
        assert _canonical_path("/api/v1/lots/LOT-1") == "/lots/LOT-1"
        assert _canonical_path("/predict") == "/predict"

    def test_table_derived_from_path_longest_prefix_wins(self):
        assert _table_for("/auth/login") == "users"
        assert _table_for("/users/3") == "users"
        assert _table_for("/process/conditions/2") == "process_conditions"
        assert _table_for("/predict") == "ml_models"
        assert _table_for("/doe/simulate") == "ml_models"
        assert _table_for("/kpi/targets") == "kpi_targets"

    def test_password_hash_is_never_written_to_detail(self):
        """§6.3 — `password_hash` 는 절대 넣지 마라."""
        out = _redact({"username": "kim", "password_hash": "$2b$12$abc",
                       "nested": {"password": "p", "api_key": "k"}})
        assert out["username"] == "kim"
        assert out["password_hash"] == "***"
        assert out["nested"] == {"password": "***", "api_key": "***"}

    def test_actions_are_the_five_contract_values(self):
        from src.api.middleware import AUDIT_ACTIONS
        assert AUDIT_ACTIONS == ("CREATE", "UPDATE", "DELETE", "LOGIN", "PREDICT")

    def test_retention_is_one_year(self):
        from src.api.middleware import AUDIT_RETENTION_DAYS
        assert AUDIT_RETENTION_DAYS == 365   # NFR-S-04


# ══════════════════════════════════════════════════════════════════════════
# §5 오류 계약 — 앱 전체를 띄우고 확인
# ══════════════════════════════════════════════════════════════════════════
@pytest.fixture(scope="module")
def client():
    from app import app
    return TestClient(app, raise_server_exceptions=False)


#: `scripts/seed_db.py` (개발1) 가 넣는 시드 계정. 비밀번호는 전부 동일하다.
SEED_ADMIN = ("admin", "koryo1234!")
SEED_VIEWER = ("viewer01", "koryo1234!")


def _login(client, username: str, password: str) -> dict[str, str]:
    res = client.post("/api/v1/auth/login", json={"username": username, "password": password})
    if res.status_code != 200:
        pytest.skip(f"시드 계정 {username} 로 로그인 불가 (HTTP {res.status_code}) — "
                    "`python scripts/seed_db.py` 를 먼저 돌려라")
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


@pytest.fixture(scope="module")
def admin_headers(client):
    return _login(client, *SEED_ADMIN)


@pytest.fixture(scope="module")
def viewer_headers(client):
    return _login(client, *SEED_VIEWER)


class TestErrorContract:
    def test_health_is_auth_exempt(self, client):
        res = client.get("/api/v1/health")
        assert res.status_code == 200
        assert res.json()["status"] == "ok"

    def test_401_without_token(self, client):
        """§5 — 인증 실패 401 `"로그인이 필요합니다"`."""
        res = client.get("/api/v1/auth/me")
        assert res.status_code == 401
        assert res.json()["detail"] == "로그인이 필요합니다"

    def test_401_with_garbage_token(self, client):
        res = client.get("/api/v1/settings/public", headers={"Authorization": "Bearer nope"})
        assert res.status_code == 401
        assert res.json()["detail"] == "로그인이 필요합니다"

    def test_login_failure_is_401_not_404(self, client):
        """사용자 존재 여부를 구분해서 알려주지 마라 (§8.1)."""
        res = client.post("/api/v1/auth/login",
                          json={"username": "no_such_user_xyz", "password": "whatever1"})
        assert res.status_code == 401
        assert res.json()["detail"] == "로그인이 필요합니다"

    def test_predict_requires_auth_before_validation(self, client):
        """§3.4 — `/predict` 는 면제 목록에 없다. 토큰 없이는 **본문 검증 전에** 401 이다.

        (초기 구현에서 `/predict`·`/recommend`·`/models`·`/doe/*` 에 인증이 빠져 있었다.
        `/api/v1` 게이트를 무접두사 별칭으로 우회할 수 있는 구멍이었다.)
        """
        res = client.post("/api/v1/predict", json={})
        assert res.status_code == 401

    def test_422_component_sum_not_100(self, client, admin_headers):
        """§5 1번 — 성분 합계 ≠ 100% → 422 (goal.md 2.3 하드 룰)."""
        res = client.post("/api/v1/predict", headers=admin_headers, json={
            "model": "gradient_boosting", "sn_ratio": 62.0, "ag_ratio": 3.0,
            "cu_ratio": 0.5, "pb_ratio": 30.0,      # 합계 95.5
            "temperature": 250, "process_time": 45, "supplier": "SUP_A",
        })
        assert res.status_code == 422
        assert "100" in str(res.json()["detail"])

    def test_422_out_of_range_input(self, client, admin_headers):
        """입력 범위 (goal.md 2.3): `temperature` 200~320."""
        res = client.post("/api/v1/predict", headers=admin_headers, json={
            "model": "gradient_boosting", "sn_ratio": 62.0, "ag_ratio": 3.0,
            "cu_ratio": 0.5, "pb_ratio": 34.5,
            "temperature": 900, "process_time": 45, "supplier": "SUP_A",
        })
        assert res.status_code == 422

    def test_404_model_not_found(self, client, admin_headers):
        """§5 2번 — 모델 파일 없음 → 404 `"모델을 찾을 수 없습니다"` (문구 고정)."""
        res = client.post("/api/v1/predict", headers=admin_headers, json={
            "model": "no_such_model", "sn_ratio": 62.0, "ag_ratio": 3.0,
            "cu_ratio": 0.5, "pb_ratio": 34.5,
            "temperature": 250, "process_time": 45, "supplier": "SUP_A",
        })
        assert res.status_code == 404
        assert res.json()["detail"] == "모델을 찾을 수 없습니다"

    def test_predict_returns_contract_fields(self, client, admin_headers):
        """§8.4.1 — 기존 2필드 + `passed`·`deviations`·`model_metrics`."""
        res = client.post("/api/v1/predict", headers=admin_headers, json={
            "model": "gradient_boosting", "sn_ratio": 62.0, "ag_ratio": 3.0,
            "cu_ratio": 0.5, "pb_ratio": 34.5,
            "temperature": 250, "process_time": 45, "supplier": "SUP_A",
        })
        if res.status_code == 404:
            pytest.skip("모델 아티팩트 없음")
        assert res.status_code == 200
        body = res.json()
        assert set(body) >= {"predicted_quality", "model_used", "passed",
                             "deviations", "model_metrics"}
        assert body["passed"] is (body["predicted_quality"] >= 70)
        assert body["deviations"] == {"sn": 0.0, "ag": 0.0, "cu": 0.0}

    def test_recommend_rejects_baseline_model(self, client, admin_headers):
        """§7.3 — `tier:"baseline"`(ridge)은 `/recommend` 에서 400 이다."""
        res = client.post("/api/v1/recommend", headers=admin_headers, json={
            "model": "ridge", "temperature": 250, "process_time": 45, "supplier": "SUP_A",
        })
        assert res.status_code == 400

    def test_501_optional_agent_endpoints(self, client, viewer_headers):
        """`agent-architecture.md` §7.2 — v1.1 게이트 **밖**의 5종은 501 을 유지한다.

        입고(FE-RT-10)·출하(FE-RT-20) 는 필수로 승격돼 실동작한다. 나머지는
        여전히 "준비 중" 이며 **가짜 응답으로 채우지 않는다.**
        """
        posts = ["/agents/mixing", "/agents/query", "/agents/analysis", "/agents/decision"]
        for path in posts:
            res = client.post(f"/api/v1{path}", json={}, headers=viewer_headers)
            assert res.status_code == 501, path
            assert res.json()["detail"] == "미구현 — v1 범위 밖"
        res = client.get("/api/v1/agents/recommendations", headers=viewer_headers)
        assert res.status_code == 501

    def test_unset_provider_is_501_not_503(self, client, viewer_headers, monkeypatch):
        """§7.6 — 제공자 미설정은 **501**(미구현)이지 503(일시 장애)이 아니다.

        503 은 "잠시 뒤 다시 해보라" 는 뜻이라 담당자가 무한 재시도를 한다.
        키가 없는 것은 재시도로 해결되지 않는다.

        🔴 **키를 지우고 돌린다.** 초판은 `assert status in (200, 501)` 이었는데,
        `.env` 에 실제 키가 들어온 뒤로 이 테스트가 **매 실행마다 유료 LLM 을
        호출**했다 (실측 2026-08-28 — 레이트리밋 재시도에 걸려 스위트가 멈췄다).
        테스트는 네트워크와 과금에 의존하면 안 된다.
        """
        for env in ("ANTHROPIC_API_KEY", "OPENAI_API_KEY"):
            monkeypatch.delenv(env, raising=False)

        for path in ("/agents/receiving", "/agents/shipping"):
            res = client.post(f"/api/v1{path}", json={"question": "테스트"},
                              headers=viewer_headers)
            assert res.status_code == 501, path
            assert res.json()["detail"] == "미구현 — v1 범위 밖"

    def test_agent_logs_are_admin_only(self, client, viewer_headers):
        """§7.1 — `agent_runs.prompt_sent` 에 외부 송출 전문이 들어간다.

        다른 사용자의 질문 전문을 전 직원이 보면 안 된다.
        """
        res = client.get("/api/v1/agents/logs", headers=viewer_headers)
        assert res.status_code == 403

    def test_agent_health_never_leaks_the_key(self, client, viewer_headers, monkeypatch):
        """§2.9 — **키 값**·앞자리·길이를 절대 반환하지 않는다.

        환경변수 **이름**(`ANTHROPIC_API_KEY`)은 `reason` 에 나와도 된다 —
        담당자가 무엇을 설정해야 하는지 알아야 한다. 나오면 안 되는 것은 **값**이다.
        그래서 가짜 키를 심어 두고 그 문자열이 응답 어디에도 없는지 본다.
        """
        secret = "sk-test-DO-NOT-LEAK-4f9a2c"
        monkeypatch.setenv("ANTHROPIC_API_KEY", secret)
        monkeypatch.setenv("OPENAI_API_KEY", secret)

        res = client.get("/api/v1/agents/health", headers=viewer_headers)
        assert res.status_code == 200
        body = res.json()
        assert set(body) == {
            "provider", "model_id", "configured", "embed_model",
            "index_ready", "chunk_count", "failed_sources", "reason",
        }
        assert secret not in json.dumps(body, ensure_ascii=False)
        assert secret not in res.text

    def test_501_training_datasets(self, client, viewer_headers):
        res = client.get("/api/v1/training-datasets", headers=viewer_headers)
        assert res.status_code == 501

    def test_deprecated_alias_carries_headers(self, client):
        """§2.2 — 별칭 응답에 `Deprecation` + `Link` 헤더."""
        res = client.get("/")
        assert res.status_code == 200
        assert res.headers.get("Deprecation") == "true"
        assert res.headers.get("Link") == '</api/v1/health>; rel="successor-version"'

    def test_openapi_marks_aliases_deprecated(self, client):
        spec = client.get("/openapi.json").json()
        assert spec["paths"]["/predict"]["post"]["deprecated"] is True
        assert spec["paths"]["/api/v1/predict"]["post"].get("deprecated") is not True


# ══════════════════════════════════════════════════════════════════════════
# §3.4 인증 면제 목록 — 전수 확인
# ══════════════════════════════════════════════════════════════════════════
#: §3.4 — 이 5개 **외에는 전부 인증 필수**다.
#: `/docs`·`/openapi.json`·`/static/*` 은 FastAPI/Starlette 가 직접 서빙한다.
AUTH_EXEMPT_API_PATHS = {"/api/v1/health"}
AUTH_EXEMPT_API_OPS = {("/api/v1/auth/login", "post")}


class TestAuthCoverage:
    def test_every_api_v1_operation_requires_auth_except_exemptions(self, client):
        """카탈로그 전수 스윕 — 토큰 없이 부르면 401 이어야 한다.

        구멍이 하나라도 있으면 RBAC 전체가 무의미해진다. 새 엔드포인트가 추가돼도
        이 테스트가 자동으로 잡는다.
        """
        spec = client.get("/openapi.json").json()
        holes: list[str] = []
        for path, ops in spec["paths"].items():
            if not path.startswith("/api/v1"):
                continue
            if "{" in path:            # 경로 파라미터는 더미로 채운다
                probe = path.replace("{system}", "erp")
                probe = __import__("re").sub(r"\{[^}]+\}", "1", probe)
            else:
                probe = path
            for method in ("get", "post", "put", "patch", "delete"):
                if method not in ops:
                    continue
                if path in AUTH_EXEMPT_API_PATHS or (path, method) in AUTH_EXEMPT_API_OPS:
                    continue
                res = client.request(method, probe, json={})
                if res.status_code != 401:
                    holes.append(f"{method.upper()} {path} → {res.status_code}")
        assert not holes, "인증 없이 통과한 엔드포인트:\n  " + "\n  ".join(holes)

    def test_deprecated_aliases_also_require_auth(self, client):
        """별칭에 인증을 안 걸면 `/api/v1` 게이트를 무접두사로 우회할 수 있다."""
        for method, path in (("get", "/models"), ("post", "/predict"),
                             ("post", "/recommend"), ("get", "/eda/stats"),
                             ("get", "/doe/methods"), ("post", "/doe/simulate")):
            res = client.request(method, path, json={})
            assert res.status_code == 401, f"{method.upper()} {path}"

    def test_health_alias_stays_open(self, client):
        """`GET /` 헬스체크만 열려 있다 — 로드밸런서/컨테이너 프로브용."""
        assert client.get("/").status_code == 200
        assert client.get("/api/v1/health").status_code == 200


# ══════════════════════════════════════════════════════════════════════════
# §3.2 RBAC — 실제 시드 계정으로 403 확인
# ══════════════════════════════════════════════════════════════════════════
class TestRbacLive:
    @pytest.mark.parametrize("path", ["/api/v1/users", "/api/v1/audit-logs",
                                      "/api/v1/notification-rules", "/api/v1/settings",
                                      "/api/v1/integrations"])
    def test_viewer_gets_403_on_admin_only(self, client, viewer_headers, path):
        res = client.get(path, headers=viewer_headers)
        assert res.status_code == 403
        assert res.json()["detail"] == "접근 권한이 없습니다"

    def test_admin_gets_200_on_same_paths(self, client, admin_headers):
        for path in ("/api/v1/users", "/api/v1/audit-logs", "/api/v1/notification-rules",
                     "/api/v1/settings", "/api/v1/integrations"):
            assert client.get(path, headers=admin_headers).status_code == 200, path

    def test_viewer_cannot_write(self, client, viewer_headers):
        """`viewer` 는 모든 쓰기에 403 (§8.0)."""
        res = client.put("/api/v1/kpi/targets", headers=viewer_headers,
                         json=[{"kpi_key": "yield_pct", "period": "2026-06",
                                "target_value": 95}])
        assert res.status_code == 403

    def test_settings_public_is_role_agnostic(self, client, viewer_headers):
        """🔴 §8.1.1 — 인증만 요구하고 역할은 무관. `viewer` 도 200 이어야 한다.

        이게 403 이면 품질 점수를 표시하는 **9개 화면이 합격 기준을 못 읽는다.**
        """
        res = client.get("/api/v1/settings/public", headers=viewer_headers)
        assert res.status_code == 200
        body = res.json()
        assert body["quality_pass_score"] == 70
        assert body["deviation_warn"] == {"sn": 2.0, "ag": 0.3, "cu": 0.1}
        assert not any(k.startswith("integration") for k in body)


# ══════════════════════════════════════════════════════════════════════════
# §8.7 `PUT /settings` — 목표값 3종 변경 시 422
# ══════════════════════════════════════════════════════════════════════════
class TestSettingsWrite:
    @pytest.mark.parametrize("key", ["sn_target", "ag_target", "cu_target"])
    def test_target_change_is_422(self, client, admin_headers, key):
        res = client.put("/api/v1/settings", headers=admin_headers, json={key: 99.0})
        assert res.status_code == 422
        assert res.json()["detail"] == "목표값은 모델 재학습을 통해서만 변경할 수 있습니다"

    def test_pass_score_out_of_range_is_422(self, client, admin_headers):
        """범위: 0~100 정수. 밖이면 422 (§8.7.2)."""
        assert client.put("/api/v1/settings", headers=admin_headers,
                          json={"quality_pass_score": 150}).status_code == 422
        assert client.put("/api/v1/settings", headers=admin_headers,
                          json={"quality_pass_score": -1}).status_code == 422

    def test_get_settings_excludes_integration_namespace(self, client, admin_headers):
        """§8.7 — `GET /settings` 는 `integration.*` 를 반환하지 않는다."""
        body = client.get("/api/v1/settings", headers=admin_headers).json()
        assert not any(k.startswith("integration") for k in body)
        assert set(body) == {"sn_target", "ag_target", "cu_target", "quality_pass_score",
                             "temp_warn_c", "deviation_warn", "updated_by_username",
                             "updated_at"}


# ══════════════════════════════════════════════════════════════════════════
# §8.1.1 `/settings/public` — 노출 범위
# ══════════════════════════════════════════════════════════════════════════
class TestPublicSettings:
    def test_defaults_match_contract_values(self):
        """goal.md 2.3 하드 비즈니스 룰과 기본값이 일치해야 한다."""
        assert DEFAULTS["quality.pass_score"][0] == 70
        assert DEFAULTS["quality.warn_score"][0] == 80
        assert DEFAULTS["equipment.temp_warn_c"][0] == 255
        assert DEFAULTS["deviation.warn_sn"][0] == 2.0
        assert DEFAULTS["deviation.warn_ag"][0] == 0.3
        assert DEFAULTS["deviation.warn_cu"][0] == 0.1
        assert DEFAULTS["ml.sn_target"][0] == 62.0
        assert DEFAULTS["ml.ag_target"][0] == 3.0
        assert DEFAULTS["ml.cu_target"][0] == 0.5

    def test_no_operational_parameters_leak(self):
        """⛔ `integration.*` 를 절대 포함하지 마라 (§8.1.1)."""
        from src.api.settings_store import public_settings

        class _FakeDb:
            def execute(self, *_a, **_k):
                class _R:
                    @staticmethod
                    def scalars():
                        class _S:
                            @staticmethod
                            def all():
                                return []
                        return _S()
                return _R()

        payload = public_settings(_FakeDb())
        assert set(payload) == {
            "sn_target", "ag_target", "cu_target", "quality_pass_score",
            "quality_warn_score", "temp_warn_c", "deviation_warn",
        }
        assert not any(k.startswith(INTEGRATION_PREFIX) for k in payload)
        assert "updated_by" not in payload


# ══════════════════════════════════════════════════════════════════════════
# `DEF-IT-001` — ML 모델 싱글톤
# ══════════════════════════════════════════════════════════════════════════
class TestModelSingleton:
    def test_app_and_doe_share_one_cache(self):
        """`app.py._cache` 와 `src/doe/routes._doe_cache` 는 **같은 객체**여야 한다."""
        import app as app_module
        from src.api import model_cache
        from src.doe import routes as doe_routes

        assert app_module._cache is model_cache.shared_cache()
        assert doe_routes._doe_cache is model_cache.shared_cache()
        assert app_module._cache is doe_routes._doe_cache

    def test_concurrent_first_load_happens_once(self, monkeypatch):
        """20 스레드가 동시에 첫 요청을 보내도 `load_model` 은 한 번만 불린다 (NFR-P-04)."""
        import threading
        from src.api import model_cache

        calls: list[str] = []
        lock = threading.Lock()

        def _slow_load(name):
            with lock:
                calls.append(name)
            dt_start = dt.datetime.now()
            while (dt.datetime.now() - dt_start).total_seconds() < 0.05:
                pass
            return object()

        monkeypatch.setattr(model_cache, "load_model", _slow_load)
        monkeypatch.setattr(model_cache, "load_preprocessors", lambda name: (object(), object()))
        model_cache._BUNDLES.pop("_probe_model", None)

        barrier = threading.Barrier(20)

        def worker():
            barrier.wait()
            model_cache.get_bundle("_probe_model")

        threads = [threading.Thread(target=worker) for _ in range(20)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        assert calls == ["_probe_model"], f"중복 로드 {len(calls)}회 — DEF-IT-001 회귀"
        model_cache._BUNDLES.pop("_probe_model", None)


# ══════════════════════════════════════════════════════════════════════════
# §8.7 `PUT /settings` — 목표값 변경 불가
# ══════════════════════════════════════════════════════════════════════════
def test_target_keys_are_readonly():
    from src.api.settings_store import READONLY_KEYS
    assert READONLY_KEYS == {"ml.sn_target", "ml.ag_target", "ml.cu_target"}


# ══════════════════════════════════════════════════════════════════════════
# FE-RT-42 — 만족도 · 실행 로그 (agent-architecture.md §6.6·§6.8·§7.1)
# ══════════════════════════════════════════════════════════════════════════
class TestAgentLogsAndSatisfaction:
    """§6.8 — **정확도의 유일한 실측 원천은 사람의 평가다.**

    자동 지표를 지어내지 않는다. 그리고 평가가 0건이면 **0% 가 아니라 null** 이다.
    0% 를 내보내면 화면에 "만족도 0%" 가 뜨고, 그건 "아무도 평가하지 않음" 이
    아니라 "전원 불만족" 으로 읽힌다.
    """

    def test_summary_returns_null_not_zero_when_nothing_is_rated(self, client, admin_headers):
        res = client.get("/api/v1/agents/feedback/summary?days=1", headers=admin_headers)
        assert res.status_code == 200
        body = res.json()
        if body["rated"] == 0:
            assert body["satisfaction"] is None, "평가 0건인데 숫자를 만들어 냈다"
            assert body["note"], "값이 없으면 왜 없는지 말해야 한다"

    def test_summary_shape_is_stable(self, client, admin_headers):
        body = client.get("/api/v1/agents/feedback/summary", headers=admin_headers).json()
        assert set(body) == {
            "positive", "negative", "rated", "total_runs", "satisfaction", "note",
        }

    def test_satisfaction_is_positive_over_rated(self, client, admin_headers):
        """분모는 **평가 건수**이지 실행 건수가 아니다 — 미평가를 불만족으로 세지 않는다."""
        b = client.get("/api/v1/agents/feedback/summary", headers=admin_headers).json()
        if b["rated"]:
            assert b["satisfaction"] == pytest.approx(b["positive"] / b["rated"] * 100, abs=0.05)
            assert b["rated"] == b["positive"] + b["negative"]

    def test_logs_expose_the_audit_fields_the_screen_needs(self, client, admin_headers):
        """🔴 회귀 방지 — 화면이 `agent`·`latency_ms`·`status` 를 찾는데 서버가
        `scope`·`total_ms`·`answer_status` 를 주고 있었다. **19건이 있는데 표가
        비어 있었다** (실측 2026-08-28).
        """
        body = client.get("/api/v1/agents/logs?page_size=1", headers=admin_headers).json()
        if not body["items"]:
            pytest.skip("agent_runs 가 비어 있다")
        row = body["items"][0]
        assert {"scope", "total_ms", "answer_status", "username", "question", "rating"} <= set(row)

    def test_logs_never_leak_the_outbound_prompt(self, client, admin_headers):
        """§6.6 — `prompt_sent` 는 외부로 나간 전문이다. 목록에 싣지 않는다."""
        body = client.get("/api/v1/agents/logs?page_size=5", headers=admin_headers).json()
        for row in body["items"]:
            assert "prompt_sent" not in row
            assert "raw_answer" not in row

    def test_feedback_rejects_values_outside_the_two_defined_ratings(self, client, admin_headers):
        """§6.8 은 rating 을 `1`|`-1` 로만 정의했다. 0(중립)을 발명하지 않는다."""
        res = client.post("/api/v1/agents/messages/1/feedback",
                          headers=admin_headers, json={"rating": 0})
        assert res.status_code == 422
