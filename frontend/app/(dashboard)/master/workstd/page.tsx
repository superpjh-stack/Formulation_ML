"use client";

import { useState } from "react";
import { StatusBadge } from "@/components/ui/StatusBadge";

interface WorkStd {
  id: string;
  code: string;
  title: string;
  dept: string;
  category: "배합" | "검사" | "포장" | "설비" | "안전";
  version: string;
  updatedAt: string;
  updatedBy: string;
  status: "현행" | "개정중" | "폐기";
  pages: number;
}

const MOCK_DOCS: WorkStd[] = [
  { id: "WS-001", code: "MX-STD-001", title: "Sn63Pb37 배합 작업표준",         dept: "기술팀", category: "배합", version: "Rev.5", updatedAt: "2026-04-10", updatedBy: "이배합", status: "현행",   pages: 18 },
  { id: "WS-002", code: "MX-STD-002", title: "Sn96.5Ag3Cu0.5 배합 작업표준",   dept: "기술팀", category: "배합", version: "Rev.3", updatedAt: "2026-03-15", updatedBy: "정기술", status: "현행",   pages: 22 },
  { id: "WS-003", code: "MX-STD-003", title: "Sn60Pb40 배합 작업표준",          dept: "기술팀", category: "배합", version: "Rev.4", updatedAt: "2026-02-20", updatedBy: "이배합", status: "현행",   pages: 16 },
  { id: "WS-004", code: "QC-STD-001", title: "성분 분석 검사 표준",              dept: "품질팀", category: "검사", version: "Rev.7", updatedAt: "2026-05-01", updatedBy: "박품질", status: "현행",   pages: 30 },
  { id: "WS-005", code: "QC-STD-002", title: "외관 검사 표준",                   dept: "품질팀", category: "검사", version: "Rev.2", updatedAt: "2026-04-25", updatedBy: "한품질", status: "현행",   pages: 12 },
  { id: "WS-006", code: "PK-STD-001", title: "드럼 포장 작업표준",               dept: "생산팀", category: "포장", version: "Rev.3", updatedAt: "2026-01-10", updatedBy: "최생산", status: "현행",   pages: 14 },
  { id: "WS-007", code: "EQ-STD-001", title: "배합 설비 점검 표준",              dept: "기술팀", category: "설비", version: "Rev.6", updatedAt: "2026-06-01", updatedBy: "정기술", status: "개정중", pages: 25 },
  { id: "WS-008", code: "SF-STD-001", title: "납 취급 안전 작업표준",            dept: "생산팀", category: "안전", version: "Rev.4", updatedAt: "2025-12-01", updatedBy: "임생산", status: "현행",   pages: 20 },
  { id: "WS-009", code: "MX-STD-004", title: "Sn50Pb50 배합 작업표준 (구버전)", dept: "기술팀", category: "배합", version: "Rev.2", updatedAt: "2024-06-01", updatedBy: "이배합", status: "폐기",   pages: 15 },
];

const CAT_COLORS: Record<WorkStd["category"], { bg: string; color: string }> = {
  배합: { bg: "#EEF1FD", color: "#1D4ED8" },
  검사: { bg: "#ECFDF3", color: "#15803D" },
  포장: { bg: "#FEF6E7", color: "#B45309" },
  설비: { bg: "#F5F1FE", color: "#6D28D9" },
  안전: { bg: "#FEF1F2", color: "#B91C1C" },
};

const STATUS_V: Record<WorkStd["status"], "green" | "amber" | "gray"> = {
  현행: "green", 개정중: "amber", 폐기: "gray",
};

export default function WorkStdPage() {
  const [category, setCategory] = useState<"전체" | WorkStd["category"]>("전체");
  const [search, setSearch] = useState("");

  const filtered = MOCK_DOCS.filter((d) => {
    if (category !== "전체" && d.category !== category) return false;
    if (search && !d.title.includes(search) && !d.code.includes(search)) return false;
    return true;
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: "#161B26", margin: 0 }}>작업표준 관리</h1>
          <p style={{ fontSize: 12.5, color: "#687182", margin: "4px 0 0" }}>공정별 작업표준 문서 목록 및 개정 이력</p>
        </div>
        <button style={{ padding: "8px 18px", fontSize: 13, fontWeight: 600, borderRadius: 8, border: "none", background: "#3A5BD9", color: "#fff", cursor: "pointer" }}>
          + 문서 등록
        </button>
      </div>

      {/* Category summary */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {(["전체", "배합", "검사", "포장", "설비", "안전"] as const).map((cat) => {
          const cnt = cat === "전체" ? MOCK_DOCS.length : MOCK_DOCS.filter(d => d.category === cat).length;
          const isActive = category === cat;
          return (
            <button
              key={cat}
              onClick={() => setCategory(cat)}
              style={{
                padding: "8px 16px", borderRadius: 8, cursor: "pointer", transition: "all 0.12s",
                border: `1px solid ${isActive ? "#3A5BD9" : "#E4E7EC"}`,
                background: isActive ? "#3A5BD9" : "#fff",
                color: isActive ? "#fff" : "#687182",
                fontSize: 12.5, fontWeight: 600,
              }}
            >
              {cat} <span style={{ marginLeft: 4, fontVariantNumeric: "tabular-nums", opacity: 0.8 }}>({cnt})</span>
            </button>
          );
        })}
      </div>

      {/* Search */}
      <div style={{ position: "relative", width: 300 }}>
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)" }}>
          <circle cx="7" cy="7" r="5" stroke="#9AA4B2" strokeWidth="1.5" />
          <path d="M11 11l3 3" stroke="#9AA4B2" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="문서명, 코드 검색..."
          style={{ width: "100%", height: 36, paddingLeft: 28, paddingRight: 12, border: "1px solid #E4E7EC", borderRadius: 8, fontSize: 12.5, fontFamily: "inherit", background: "#F8F9FB", outline: "none" }} />
      </div>

      {/* Document cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 14 }}>
        {filtered.map((doc) => {
          const cc = CAT_COLORS[doc.category];
          return (
            <div key={doc.id} className="card" style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
              {/* Icon */}
              <div style={{ width: 44, height: 44, borderRadius: 10, background: cc.bg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                  <rect x="3" y="2" width="14" height="16" rx="2" stroke={cc.color} strokeWidth="1.5" />
                  <path d="M7 7h6M7 10h6M7 13h4" stroke={cc.color} strokeWidth="1.3" strokeLinecap="round" />
                </svg>
              </div>
              {/* Content */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, marginBottom: 4 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#161B26", lineHeight: 1.4 }}>{doc.title}</span>
                  <StatusBadge variant={STATUS_V[doc.status]} label={doc.status} />
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
                  <code style={{ fontSize: 11, fontFamily: "monospace", background: "#F2F4F7", padding: "1px 6px", borderRadius: 4, color: "#687182" }}>{doc.code}</code>
                  <span style={{ padding: "1px 7px", borderRadius: 20, fontSize: 11, fontWeight: 600, ...cc }}>{doc.category}</span>
                  <span style={{ fontSize: 11, color: "#9AA4B2" }}>{doc.version}</span>
                  <span style={{ fontSize: 11, color: "#9AA4B2" }}>{doc.pages}p</span>
                </div>
                <div style={{ fontSize: 11.5, color: "#9AA4B2" }}>
                  {doc.dept} · 개정일 {doc.updatedAt} · {doc.updatedBy}
                </div>
              </div>
              {/* Actions */}
              <div style={{ display: "flex", flexDirection: "column", gap: 5, flexShrink: 0 }}>
                <button style={{ padding: "4px 10px", fontSize: 11.5, fontWeight: 600, borderRadius: 6, border: "1px solid #E4E7EC", background: "#fff", color: "#3A5BD9", cursor: "pointer" }}>보기</button>
                <button style={{ padding: "4px 10px", fontSize: 11.5, fontWeight: 600, borderRadius: 6, border: "1px solid #E4E7EC", background: "#fff", color: "#687182", cursor: "pointer" }}>개정</button>
              </div>
            </div>
          );
        })}
      </div>

      {filtered.length === 0 && (
        <div style={{ textAlign: "center", padding: "48px 0", color: "#9AA4B2", fontSize: 13 }}>검색 결과가 없습니다.</div>
      )}
    </div>
  );
}
