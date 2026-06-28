"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

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

export function Sidebar() {
  const pathname = usePathname();

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
              const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
              return (
                <Link
                  key={item.href}
                  href={item.href}
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
          관
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "#E7EAF0", lineHeight: 1.2 }}>
            관리자
          </div>
          <div style={{ fontSize: 10.5, color: "#687182", lineHeight: 1.2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            admin@koreysolder.com
          </div>
        </div>
      </div>
    </aside>
  );
}
