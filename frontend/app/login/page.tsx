"use client";

/**
 * `/login` — 로그인 (NFR-S-01 JWT · 세션 30분)
 *
 * `lib/auth.ts` 의 `LOGIN_PATH = '/login'` 이 가리키는 화면이다.
 * 인증 만료·401 응답 시 `redirectToLogin()` 이 `?next=` 를 달아 여기로 보낸다.
 *
 * ── 이 파일이 없어서 생겼던 문제 (QA2 DEF-QA2-005) ──────────────────────────
 * 라운드 2 배정이 44화면(FE-RT-02~45) 기준이었는데 로그인은 그 44개에 속하지
 * 않아 아무에게도 할당되지 않았다. 결과:
 *   · `GET /login` 404 — 정상 경로로 로그인할 방법이 없었다
 *   · 토큰이 없으면 화면이 401 을 띄우지 않고 "불러오는 중…" 에 **영구 정체**
 *     (조용한 실패 — 이 프로젝트가 없애기로 한 바로 그 유형)
 *
 * `(dashboard)` 라우트 그룹 밖이라 사이드바·헤더가 없다. 의도된 것이다.
 */

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import * as api from "@/lib/koryo-api";
import { clearToken, getToken, isExpired, setToken } from "@/lib/auth";
import { ApiError } from "@/lib/api";

const HOME = "/dashboard/production";

/**
 * `?next=` 오픈 리다이렉트 방지 — 같은 출처의 절대 경로만 허용한다.
 *
 * ⚠️ 이 함수의 초판은 **우회 가능했다** (2차 QA 지적).
 * `startsWith("/") && !startsWith("//")` 만 봤는데, **브라우저가 백슬래시를 `/` 로 정규화**한다:
 *   `/\evil.com`  → `//evil.com`  → 프로토콜 상대 URL → **외부 사이트로 유출**
 *   `/\/evil.com` → 동일
 * `new URL(c, origin)` 로 실측 확인한 결과 둘 다 `http://evil.com/` 이 됐다.
 *
 * 문자열 접두사 검사로는 정규화 규칙을 다 따라갈 수 없으므로,
 * **브라우저와 같은 파서(`URL`)로 해석한 뒤 출처를 대조**하는 방식으로 바꿨다.
 */
function safeNext(raw: string | null): string {
  if (!raw) return HOME;
  // 백슬래시·공백·제어문자는 브라우저 정규화 시 의미가 바뀐다. 먼저 걷어낸다.
  // (하이픈은 `/training-data` 등 정상 경로에 흔하므로 절대 문자 클래스에 넣지 마라)
  if (/[\\\s\u0000-\u001F\u007F]/.test(raw)) return HOME;
  if (!raw.startsWith("/") || raw.startsWith("//")) return HOME;

  // 브라우저와 동일한 파서로 해석해 출처가 실제로 같은지 본다.
  if (typeof window !== "undefined") {
    try {
      const url = new URL(raw, window.location.origin);
      if (url.origin !== window.location.origin) return HOME;
      const path = url.pathname + url.search + url.hash;
      return path.startsWith("/login") ? HOME : path;
    } catch {
      return HOME;
    }
  }

  return raw.startsWith("/login") ? HOME : raw;
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const expired = params.get("reason") === "expired";

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // 이미 유효한 토큰이 있으면 굳이 로그인시키지 않는다.
  useEffect(() => {
    const t = getToken();
    if (t && !isExpired(t)) router.replace(next);
    else if (t) clearToken();
  }, [next, router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      const res = await api.login({ username: username.trim(), password });
      setToken(res.access_token);
      router.replace(next);
    } catch (err) {
      // 실패를 삼키지 않는다. 계약 §5 의 문구를 그대로 쓴다.
      if (err instanceof ApiError) {
        setError(
          err.status === 401
            ? "아이디 또는 비밀번호가 올바르지 않습니다"
            : err.status === 503
              ? "서비스 일시 중단"
              : err.message
        );
      } else {
        setError(err instanceof Error ? err.message : "서버에 연결할 수 없습니다");
      }
      setBusy(false);
    }
  }

  const canSubmit = username.trim().length > 0 && password.length > 0 && !busy;

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--color-bg, #EEF0F4)",
        padding: 24,
      }}
    >
      <div style={{ width: "100%", maxWidth: 380 }}>
        {/* 브랜드 — 사이드바와 같은 문구 */}
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: "var(--color-text, #161B26)" }}>
            고려솔더 AI
          </div>
          <div style={{ fontSize: 12.5, color: "var(--color-text-sub, #687182)", marginTop: 2 }}>
            제조 스마트공장
          </div>
        </div>

        <form className="card" onSubmit={handleSubmit} style={{ padding: 24 }}>
          <h1
            style={{
              fontSize: 16,
              fontWeight: 600,
              color: "var(--color-text, #161B26)",
              margin: "0 0 4px",
            }}
          >
            로그인
          </h1>
          <p
            style={{
              fontSize: 11.5,
              color: "var(--color-text-sub, #687182)",
              margin: "0 0 18px",
            }}
          >
            세션은 30분 후 만료된다
          </p>

          {expired && !error && (
            <div
              role="status"
              style={{
                fontSize: 12.5,
                color: "#92400E",
                background: "#FFFBEB",
                border: "1px solid #FDE68A",
                borderRadius: 8,
                padding: "8px 10px",
                marginBottom: 14,
              }}
            >
              세션이 만료되었습니다. 다시 로그인하세요.
            </div>
          )}

          <Labeled id="username" label="아이디">
            <input
              id="username"
              name="username"
              autoComplete="username"
              autoFocus
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={busy}
              style={inputStyle}
            />
          </Labeled>

          <Labeled id="password" label="비밀번호">
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy}
              style={inputStyle}
            />
          </Labeled>

          {error && (
            <div
              role="alert"
              style={{
                fontSize: 12.5,
                color: "#B91C1C",
                background: "#FEF2F2",
                border: "1px solid #FECACA",
                borderRadius: 8,
                padding: "8px 10px",
                marginBottom: 14,
              }}
            >
              {error}
            </div>
          )}

          <button type="submit" className="btn pri" disabled={!canSubmit} style={{ width: "100%" }}>
            {busy ? "로그인 중…" : "로그인"}
          </button>
        </form>
      </div>
    </main>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  height: 36,
  padding: "0 10px",
  fontSize: 13,
  color: "var(--color-text, #161B26)",
  background: "#fff",
  border: "1px solid var(--color-border, #E4E7EC)",
  borderRadius: 8,
  outline: "none",
};

function Labeled({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label
        htmlFor={id}
        style={{
          display: "block",
          fontSize: 11.5,
          fontWeight: 600,
          color: "var(--color-text-sub, #687182)",
          marginBottom: 5,
        }}
      >
        {label}
      </label>
      {children}
    </div>
  );
}

// `useSearchParams()` 는 Suspense 경계를 요구한다 (Next 14 App Router).
export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
