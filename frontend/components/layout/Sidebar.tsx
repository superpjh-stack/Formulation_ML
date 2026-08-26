"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as api from "@/lib/koryo-api";
import { decodeJwt, getToken } from "@/lib/auth";
import { ROLE_LABELS } from "@/types/auth";
import type { AuthUser } from "@/types/auth";

interface NavItem {
  href: string;
  label: string;
}

interface NavSection {
  title: string;
  items: NavItem[];
}

const NAV_SECTIONS: NavSection[] = [
  {
    title: "AI 대시보드",
    items: [
      { href: "/dashboard/production", label: "생산 현황" },
      { href: "/dashboard/quality",    label: "품질 현황" },
      { href: "/dashboard/equipment",  label: "설비 현황" },
      { href: "/dashboard/shipping",   label: "출하 현황" },
    ],
  },
  {
    title: "입고관리",
    items: [
      { href: "/receiving",          label: "입고 현황" },
      { href: "/receiving/history",  label: "입고 이력" },
      { href: "/receiving/data",     label: "성분 데이터" },
      { href: "/receiving/supplier", label: "공급사 관리" },
      { href: "/receiving/agent",    label: "AI Agent" },
    ],
  },
  {
    title: "배합비율 최적화AI",
    items: [
      { href: "/mixing/collect",   label: "데이터 수집" },
      { href: "/mixing/deviation", label: "성분 편차 분석" },
      { href: "/mixing/predict",   label: "품질 예측" },
      { href: "/mixing/optimize",  label: "배합 최적화" },
      { href: "/mixing/agent",     label: "AI Agent" },
    ],
  },
  {
    title: "포장출하관리",
    items: [
      { href: "/shipping/main",    label: "출하 현황" },
      { href: "/shipping/lot",     label: "LOT 관리" },
      { href: "/shipping/inspect", label: "검사 결과" },
      { href: "/shipping/claim",   label: "클레임 관리" },
      { href: "/shipping/agent",   label: "AI Agent" },
    ],
  },
  {
    title: "공정관리",
    items: [
      { href: "/process/performance", label: "공정 실적" },
      { href: "/process/monitor",     label: "실시간 모니터" },
      { href: "/process/condition",   label: "공정 조건" },
      { href: "/process/history",     label: "이력 조회" },
      { href: "/process/analysis",    label: "공정 분석" },
    ],
  },
  {
    title: "사용자/시스템관리",
    items: [
      { href: "/system/users",         label: "사용자 관리" },
      { href: "/system/logs",          label: "시스템 로그" },
      { href: "/system/notifications", label: "알림 설정" },
      { href: "/system/config",        label: "시스템 설정" },
    ],
  },
  {
    title: "기준정보관리",
    items: [
      { href: "/master/quality", label: "품질 기준" },
      { href: "/master/workstd", label: "작업 표준" },
      { href: "/master/code",    label: "코드 관리" },
    ],
  },
  {
    title: "데이터관리시스템",
    items: [
      { href: "/data/integrate",     label: "데이터 연동" },
      { href: "/data/query",         label: "데이터 조회" },
      { href: "/data/visualization", label: "시각화" },
      { href: "/data/download",      label: "다운로드" },
      { href: "/data/training",      label: "학습 데이터" },
    ],
  },
  {
    title: "AI Agent 관리",
    items: [
      { href: "/agent/query",           label: "질의 응답" },
      { href: "/agent/analysis",        label: "분석 요청" },
      { href: "/agent/decision",        label: "의사결정 지원" },
      { href: "/agent/recommendations", label: "추천 이력" },
      { href: "/agent/history",         label: "Agent 로그" },
    ],
  },
  {
    title: "KPI 관리",
    items: [
      { href: "/kpi/production", label: "생산 KPI" },
      { href: "/kpi/quality",    label: "품질 KPI" },
      { href: "/kpi/manage",     label: "KPI 설정" },
    ],
  },
];

/** NAV_SECTIONS 에 걸린 전체 href. 긴 것부터 = 구체적인 것부터. */
const NAV_HREFS: string[] = NAV_SECTIONS.flatMap((s) => s.items.map((i) => i.href)).sort(
  (a, b) => b.length - a.length
);

/**
 * 현재 경로에서 강조할 메뉴 href 를 **하나만** 고른다 — 최장 접두사 일치(longest-prefix).
 *
 * 이전 구현은 항목마다 `pathname === href || pathname.startsWith(href + "/")` 를 독립 판정했다.
 * `/receiving`(입고 현황)이 `/receiving/history`·`/data`·`/supplier`·`/agent` 의 접두사라서
 * 자식 화면 4곳에서 부모까지 같이 강조됐다(충돌 4건). 44개 라우트 중 부모/자식 href 가
 * 겹치는 건 `/receiving` 하나뿐이지만, 판정을 전역 최장 일치로 바꾸면 앞으로 어떤
 * 부모/자식 조합이 추가돼도 강조는 항상 정확히 하나다.
 */
export function resolveActiveHref(pathname: string | null | undefined): string | null {
  if (!pathname) return null;
  const p = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  for (const href of NAV_HREFS) {
    if (p === href || p.startsWith(href + "/")) return href;
  }
  return null;
}

export function Sidebar() {
  const pathname = usePathname();

  // 로그인 사용자를 실제로 읽는다.
  // 이전 구현은 `관리자 / admin@koreysolder.com` 을 고정 표시했는데,
  // 그 이메일은 **어느 계정에도 없다** (실제 admin 은 `admin@koryosolder.local`,
  // 철자도 `koryo` 가 아니라 `korey` 로 틀려 있었다) — QA1 DEF-QA1-002.
  const [me, setMe] = useState<AuthUser | null>(null);

  useEffect(() => {
    let cancelled = false;
    // JWT 로 먼저 채워 첫 페인트에서 남의 정보가 보이지 않게 한다.
    const token = getToken();
    const claims = token ? decodeJwt(token) : null;
    if (claims) {
      setMe({
        id: claims.uid,
        username: claims.sub,
        email: "",
        role: claims.role,
        active: true,
        last_login: null,
      });
    }
    // 이메일 등 나머지는 서버에서 받는다. 실패해도 화면을 막지 않는다.
    api
      .getMe()
      .then((u) => {
        if (!cancelled) setMe(u);
      })
      .catch(() => {
        /* 폴백: JWT 클레임 유지. 이메일 자리는 "불러오지 못했습니다" 로 표시된다 */
      });
    return () => {
      cancelled = true;
    };
  }, [pathname]);
  const activeHref = resolveActiveHref(pathname);

  return (
    <aside
      style={{
        width: 266,
        minWidth: 266,
        background: "#0E1320",
        color: "#E7EAF0",
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        position: "sticky",
        top: 0,
        overflowY: "auto",
        scrollbarWidth: "none",
      }}
    >
      {/* Logo */}
      <div
        style={{
          height: 60,
          display: "flex",
          alignItems: "center",
          padding: "0 18px",
          borderBottom: "1px solid rgba(255,255,255,.07)",
          flexShrink: 0,
          gap: 10,
        }}
      >
        <span
          style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            background: "linear-gradient(135deg, #3A5BD9, #6B8AFF)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path
              d="M6 2v5L3 11.5A1.5 1.5 0 004.5 14h7A1.5 1.5 0 0013 11.5L10 7V2"
              stroke="#fff"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path d="M5.5 2h5" stroke="#fff" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </span>
        <div>
          <div style={{ fontWeight: 700, fontSize: 13, color: "#fff", lineHeight: 1.2 }}>
            고려솔더 AI
          </div>
          <div style={{ fontSize: 10.5, color: "#8B95A8", lineHeight: 1.2 }}>
            제조 스마트공장
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav style={{ flex: 1, padding: "8px 0 16px" }}>
        {NAV_SECTIONS.map((section) => (
          <div key={section.title}>
            {/* Section header */}
            <div
              style={{
                padding: "9px 10px 4px 16px",
                color: "#C2C9D6",
                fontSize: 12.8,
                fontWeight: 600,
                letterSpacing: "0.03em",
                textTransform: "uppercase",
              }}
            >
              {section.title}
            </div>

            {/* Items */}
            {section.items.map((item) => {
              const isActive = activeHref === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={isActive ? "page" : undefined}
                  style={{
                    display: "block",
                    padding: "7px 10px 7px 38px",
                    fontSize: 12.3,
                    fontWeight: isActive ? 700 : 500,
                    color: isActive ? "#fff" : "#9AA4B2",
                    background: isActive ? "rgba(58,91,217,.20)" : "transparent",
                    borderLeft: isActive ? "2px solid #6B8AFF" : "2px solid transparent",
                    transition: "background 0.12s, color 0.12s",
                    textDecoration: "none",
                    lineHeight: "1.4",
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive) {
                      (e.currentTarget as HTMLAnchorElement).style.color = "#C2C9D6";
                      (e.currentTarget as HTMLAnchorElement).style.background =
                        "rgba(255,255,255,.04)";
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) {
                      (e.currentTarget as HTMLAnchorElement).style.color = "#9AA4B2";
                      (e.currentTarget as HTMLAnchorElement).style.background = "transparent";
                    }
                  }}
                >
                  {item.label}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Bottom user info */}
      <div
        style={{
          borderTop: "1px solid rgba(255,255,255,.07)",
          padding: "12px 16px",
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexShrink: 0,
        }}
      >
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: "50%",
            background: "linear-gradient(135deg, #3A5BD9, #6B8AFF)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 11,
            fontWeight: 700,
            color: "#fff",
            flexShrink: 0,
          }}
        >
          {me ? me.username.slice(0, 2).toUpperCase() : "—"}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "#E7EAF0", lineHeight: 1.2 }}>
            {me ? `${me.username} · ${ROLE_LABELS[me.role]}` : "—"}
          </div>
          <div style={{ fontSize: 10.5, color: "#687182", lineHeight: 1.2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {me?.email ?? "로그인 정보를 불러오지 못했습니다"}
          </div>
        </div>
      </div>
    </aside>
  );
}
