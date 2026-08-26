"use client";

import { useState, useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { getBreadcrumb } from "@/lib/routes";
import * as api from "@/lib/koryo-api";
import { clearToken, decodeJwt, getToken, LOGIN_PATH } from "@/lib/auth";
import { ROLE_LABELS } from "@/types/auth";
import type { AuthUser } from "@/types/auth";

export function AppHeader({ title }: { title?: string }) {
  const pathname = usePathname();
  const [now, setNow] = useState<Date | null>(null);
  const [notifOpen, setNotifOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [me, setMe] = useState<AuthUser | null>(null);
  const userRef = useRef<HTMLDivElement>(null);

  // 로그인 사용자 — JWT 로 먼저 채우고 `/auth/me` 로 보강한다.
  useEffect(() => {
    let cancelled = false;
    const token = getToken();
    const claims = token ? decodeJwt(token) : null;
    if (claims) {
      setMe({
        id: claims.uid, username: claims.sub, email: "",
        role: claims.role, active: true, last_login: null,
      });
    }
    api.getMe().then((u) => { if (!cancelled) setMe(u); }).catch(() => { /* JWT 폴백 유지 */ });
    return () => { cancelled = true; };
  }, [pathname]);

  // 바깥 클릭·ESC 로 메뉴 닫기
  useEffect(() => {
    if (!userOpen) return;
    const onDown = (e: MouseEvent) => {
      if (userRef.current && !userRef.current.contains(e.target as Node)) setUserOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setUserOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [userOpen]);

  async function handleLogout() {
    if (loggingOut) return;
    setLoggingOut(true);
    // 서버 호출이 실패해도 **로컬 토큰은 반드시 지운다** — 실패를 이유로
    // 로그인 상태가 남으면 사용자는 로그아웃했다고 믿는데 세션이 살아 있다.
    try {
      await api.logout();
    } catch {
      /* 서버가 죽어도 아래에서 토큰을 지우고 로그인 화면으로 보낸다 */
    } finally {
      clearToken();
      window.location.href = LOGIN_PATH;
    }
  }

  // 제목 슬롯: 명시 title 이 있으면 그것을, 없으면 라우트에서 유도한다.
  // 44화면 중 화면명이 겹치는 게 있어(AI Agent ×3, 출하 현황 ×2) `섹션 › 화면명` 으로 표시한다.
  const crumb = getBreadcrumb(pathname);
  const headerSection = title ? null : crumb[0] ?? null;
  const headerTitle = title ?? crumb[1] ?? null;

  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  // 브라우저 탭 제목도 화면명을 따라간다. RootLayout 의 metadata 는 정적이라
  // 44화면 전부가 같은 탭 제목으로 보였다.
  useEffect(() => {
    if (headerTitle) {
      document.title = `${headerTitle} — 고려솔더 AI 스마트공장`;
    }
  }, [headerTitle]);

  const timeStr = now
    ? now.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })
    : "--:--";
  const dateStr = now
    ? now.toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" })
    : "";

  return (
    <header
      style={{
        height: 60,
        background: "#fff",
        borderBottom: "1px solid var(--color-border, #E4E7EC)",
        padding: "0 24px",
        display: "flex",
        alignItems: "center",
        gap: 16,
        flexShrink: 0,
        position: "sticky",
        top: 0,
        zIndex: 40,
      }}
    >
      {/* Page title — 현재 위치 표시기. SF-TD3 §1.2 의 페이지 제목 22/700 은
          각 페이지 <h1> 의 몫이고, 헤더는 그보다 작은 위치 라벨로 둔다. */}
      {headerTitle && (
        <nav
          aria-label="현재 위치"
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 6,
            minWidth: 0,
            flexShrink: 0,
          }}
        >
          {headerSection && (
            <>
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 500,
                  color: "#687182",
                  whiteSpace: "nowrap",
                }}
              >
                {headerSection}
              </span>
              <span style={{ fontSize: 11, color: "#9AA4B2" }} aria-hidden="true">
                ›
              </span>
            </>
          )}
          <span
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: "var(--color-text, #161B26)",
              whiteSpace: "nowrap",
            }}
          >
            {headerTitle}
          </span>
        </nav>
      )}

      {/* Search bar */}
      <div style={{ flex: 1, maxWidth: 360 }}>
        <div style={{ position: "relative" }}>
          <svg
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            style={{
              position: "absolute",
              left: 10,
              top: "50%",
              transform: "translateY(-50%)",
              color: "#9AA4B2",
            }}
          >
            <circle cx="7" cy="7" r="5" stroke="#9AA4B2" strokeWidth="1.5" />
            <path d="M11 11l3 3" stroke="#9AA4B2" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <input
            type="text"
            placeholder="검색..."
            style={{
              width: "100%",
              height: 34,
              paddingLeft: 32,
              paddingRight: 12,
              border: "1px solid var(--color-border, #E4E7EC)",
              borderRadius: 8,
              fontSize: 12.5,
              color: "var(--color-text, #161B26)",
              background: "#F8F9FB",
              outline: "none",
              fontFamily: "inherit",
            }}
            onFocus={(e) => {
              e.currentTarget.style.borderColor = "#3A5BD9";
              e.currentTarget.style.background = "#fff";
            }}
            onBlur={(e) => {
              e.currentTarget.style.borderColor = "var(--color-border, #E4E7EC)";
              e.currentTarget.style.background = "#F8F9FB";
            }}
          />
        </div>
      </div>

      {/* Right side controls */}
      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 12 }}>
        {/* Live status */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "4px 10px",
            background: "#ECFDF3",
            borderRadius: 20,
          }}
        >
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: "#16A34A",
              animation: "pulse-dot 2s ease-in-out infinite",
              display: "inline-block",
            }}
          />
          <span style={{ fontSize: 11.5, fontWeight: 600, color: "#15803D" }}>LIVE</span>
        </div>

        {/* Date / time */}
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 11, color: "#9AA4B2", lineHeight: 1.2 }}>{dateStr}</div>
          <div
            style={{
              fontSize: 12.5,
              fontWeight: 700,
              color: "var(--color-text, #161B26)",
              lineHeight: 1.2,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {timeStr}
          </div>
        </div>

        {/* Notifications */}
        <div style={{ position: "relative" }}>
          <button
            onClick={() => setNotifOpen((p) => !p)}
            style={{
              width: 34,
              height: 34,
              borderRadius: 8,
              border: "1px solid var(--color-border, #E4E7EC)",
              background: "#fff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              position: "relative",
            }}
            aria-label="알림"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path
                d="M8 1.5a5 5 0 015 5v2.5l1 2H2l1-2V6.5a5 5 0 015-5z"
                stroke="#687182"
                strokeWidth="1.4"
                strokeLinejoin="round"
              />
              <path
                d="M6.5 13a1.5 1.5 0 003 0"
                stroke="#687182"
                strokeWidth="1.4"
                strokeLinecap="round"
              />
            </svg>
            {/* badge */}
            <span
              style={{
                position: "absolute",
                top: 5,
                right: 5,
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: "#3A5BD9",
                border: "1.5px solid #fff",
              }}
            />
          </button>

          {notifOpen && (
            <div
              style={{
                position: "absolute",
                top: 40,
                right: 0,
                width: 280,
                background: "#fff",
                border: "1px solid var(--color-border, #E4E7EC)",
                borderRadius: 12,
                boxShadow: "0 8px 24px rgba(16,24,40,.10)",
                zIndex: 100,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  padding: "12px 16px",
                  borderBottom: "1px solid var(--color-border, #E4E7EC)",
                  fontSize: 12.5,
                  fontWeight: 700,
                  color: "var(--color-text, #161B26)",
                }}
              >
                알림
              </div>
              {[
                {
                  text: "배합 최적화 완료 — LOT-2026-0312",
                  sub: "2분 전",
                  dot: "#3A5BD9",
                },
                {
                  text: "성분 편차 경고 — Sn 함량 ±2.1%",
                  sub: "18분 전",
                  dot: "#F59E0B",
                },
                {
                  text: "신규 입고 데이터 등록 — SUP_A",
                  sub: "1시간 전",
                  dot: "#16A34A",
                },
              ].map((n, i) => (
                <div
                  key={i}
                  style={{
                    padding: "10px 16px",
                    display: "flex",
                    gap: 10,
                    borderBottom: i < 2 ? "1px solid #F2F4F7" : "none",
                    cursor: "pointer",
                  }}
                >
                  <span
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: "50%",
                      background: n.dot,
                      flexShrink: 0,
                      marginTop: 4,
                    }}
                  />
                  <div>
                    <div style={{ fontSize: 12, color: "var(--color-text, #161B26)", lineHeight: 1.4 }}>
                      {n.text}
                    </div>
                    <div style={{ fontSize: 11, color: "#9AA4B2", marginTop: 2 }}>{n.sub}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* User avatar + 사용자 메뉴
            버튼은 있었으나 **아무 동작도 하지 않았고 로그아웃 경로가 44화면 어디에도
            없었다** (QA-A D-01). `POST /auth/logout` 과 `api.logout()` 은 이미 있었고
            UI 배선만 빠져 있었다. 아바타 글자도 `관` 고정이었다. */}
        <div ref={userRef} style={{ position: "relative" }}>
          <button
            onClick={() => setUserOpen((v) => !v)}
            style={{
              width: 32,
              height: 32,
              borderRadius: "50%",
              background: "linear-gradient(135deg, #3A5BD9, #6B8AFF)",
              border: "none",
              cursor: "pointer",
              fontSize: 12,
              fontWeight: 700,
              color: "#fff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: "inherit",
            }}
            aria-label="사용자 메뉴"
            aria-haspopup="menu"
            aria-expanded={userOpen}
          >
            {me ? me.username.slice(0, 2).toUpperCase() : "—"}
          </button>

          {userOpen && (
            <div
              role="menu"
              style={{
                position: "absolute",
                top: 40,
                right: 0,
                minWidth: 210,
                background: "#fff",
                border: "1px solid var(--color-border, #E4E7EC)",
                borderRadius: 10,
                boxShadow: "0 8px 24px rgba(16,24,40,.12)",
                zIndex: 200,
                overflow: "hidden",
              }}
            >
              <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--color-border, #E4E7EC)" }}>
                <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--color-text, #161B26)" }}>
                  {me ? `${me.username} · ${ROLE_LABELS[me.role]}` : "—"}
                </div>
                <div style={{ fontSize: 11, color: "#687182", marginTop: 2 }}>
                  {me?.email ?? "로그인 정보를 불러오지 못했습니다"}
                </div>
              </div>
              <button
                role="menuitem"
                onClick={handleLogout}
                disabled={loggingOut}
                style={{
                  width: "100%",
                  padding: "10px 14px",
                  border: "none",
                  background: "transparent",
                  textAlign: "left",
                  fontSize: 12.5,
                  fontFamily: "inherit",
                  color: loggingOut ? "#9AA4B2" : "#B91C1C",
                  cursor: loggingOut ? "default" : "pointer",
                }}
              >
                {loggingOut ? "로그아웃 중…" : "로그아웃"}
              </button>
            </div>
          )}
        </div>
      </div>

      <style>{`
        @keyframes pulse-dot {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
    </header>
  );
}
