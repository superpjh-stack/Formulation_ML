"use client";

import { useState, useEffect } from "react";

export function AppHeader({ title }: { title?: string }) {
  const [now, setNow] = useState<Date | null>(null);
  const [notifOpen, setNotifOpen] = useState(false);

  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

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
        borderBottom: "1px solid #E4E7EC",
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
      {/* Page title */}
      {title && (
        <span
          style={{
            fontSize: 14,
            fontWeight: 700,
            color: "#161B26",
            whiteSpace: "nowrap",
          }}
        >
          {title}
        </span>
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
              border: "1px solid #E4E7EC",
              borderRadius: 8,
              fontSize: 12.5,
              color: "#161B26",
              background: "#F8F9FB",
              outline: "none",
              fontFamily: "inherit",
            }}
            onFocus={(e) => {
              e.currentTarget.style.borderColor = "#3A5BD9";
              e.currentTarget.style.background = "#fff";
            }}
            onBlur={(e) => {
              e.currentTarget.style.borderColor = "#E4E7EC";
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
              color: "#161B26",
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
              border: "1px solid #E4E7EC",
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
                border: "1px solid #E4E7EC",
                borderRadius: 12,
                boxShadow: "0 8px 24px rgba(16,24,40,.10)",
                zIndex: 100,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  padding: "12px 16px",
                  borderBottom: "1px solid #E4E7EC",
                  fontSize: 12.5,
                  fontWeight: 700,
                  color: "#161B26",
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
                    <div style={{ fontSize: 12, color: "#161B26", lineHeight: 1.4 }}>
                      {n.text}
                    </div>
                    <div style={{ fontSize: 11, color: "#9AA4B2", marginTop: 2 }}>{n.sub}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* User avatar */}
        <button
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
        >
          관
        </button>
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
