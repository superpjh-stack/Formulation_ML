"use client";

import { useState } from "react";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { DataTable, Column } from "@/components/ui/DataTable";

interface CodeItem {
  id: string;
  typeCode: string;
  typeName: string;
  codeValue: string;
  codeName: string;
  description: string;
  sortOrder: number;
  active: boolean;
}

const MOCK_CODES: CodeItem[] = [
  { id: "CD-001", typeCode: "LOT_STATUS", typeName: "LOT 상태",    codeValue: "ING",   codeName: "진행중",    description: "배합 공정 진행 중",       sortOrder: 1, active: true },
  { id: "CD-002", typeCode: "LOT_STATUS", typeName: "LOT 상태",    codeValue: "DONE",  codeName: "완료",      description: "배합 완료",               sortOrder: 2, active: true },
  { id: "CD-003", typeCode: "LOT_STATUS", typeName: "LOT 상태",    codeValue: "HOLD",  codeName: "보류",      description: "품질 이슈로 보류",         sortOrder: 3, active: true },
  { id: "CD-004", typeCode: "LOT_STATUS", typeName: "LOT 상태",    codeValue: "DISC",  codeName: "폐기",      description: "LOT 폐기 처리",            sortOrder: 4, active: true },
  { id: "CD-005", typeCode: "INSP_RESULT",typeName: "검사 결과",   codeValue: "PASS",  codeName: "합격",      description: "검사 합격",               sortOrder: 1, active: true },
  { id: "CD-006", typeCode: "INSP_RESULT",typeName: "검사 결과",   codeValue: "FAIL",  codeName: "불합격",    description: "검사 불합격",             sortOrder: 2, active: true },
  { id: "CD-007", typeCode: "INSP_RESULT",typeName: "검사 결과",   codeValue: "PEND",  codeName: "보류",      description: "재검사 필요",             sortOrder: 3, active: true },
  { id: "CD-008", typeCode: "SUPPLIER",   typeName: "공급사 코드",  codeValue: "SUP_A", codeName: "한국금속",  description: "주요 Sn 공급사",          sortOrder: 1, active: true },
  { id: "CD-009", typeCode: "SUPPLIER",   typeName: "공급사 코드",  codeValue: "SUP_B", codeName: "대진금속",  description: "Pb/Ag 공급사",            sortOrder: 2, active: true },
  { id: "CD-010", typeCode: "SUPPLIER",   typeName: "공급사 코드",  codeValue: "SUP_C", codeName: "성우금속",  description: "Cu 전문 공급사",          sortOrder: 3, active: true },
  { id: "CD-011", typeCode: "PROD_TYPE",  typeName: "제품 유형",   codeValue: "SNPB",  codeName: "Sn-Pb계",  description: "주석-납 합금",            sortOrder: 1, active: true },
  { id: "CD-012", typeCode: "PROD_TYPE",  typeName: "제품 유형",   codeValue: "SNAG",  codeName: "Sn-Ag계",  description: "무연 솔더 (은 함유)",     sortOrder: 2, active: true },
  { id: "CD-013", typeCode: "PROD_TYPE",  typeName: "제품 유형",   codeValue: "SNCU",  codeName: "Sn-Cu계",  description: "무연 솔더 (동 함유)",     sortOrder: 3, active: false },
  { id: "CD-014", typeCode: "CLAIM_TYPE", typeName: "클레임 유형",  codeValue: "COMP",  codeName: "성분불량",  description: "성분 규격 초과/미달",     sortOrder: 1, active: true },
  { id: "CD-015", typeCode: "CLAIM_TYPE", typeName: "클레임 유형",  codeValue: "APPR",  codeName: "외관불량",  description: "표면 산화·변색 등",       sortOrder: 2, active: true },
  { id: "CD-016", typeCode: "CLAIM_TYPE", typeName: "클레임 유형",  codeValue: "WGHT",  codeName: "중량불량",  description: "표시 중량 오차",          sortOrder: 3, active: true },
  { id: "CD-017", typeCode: "CLAIM_TYPE", typeName: "클레임 유형",  codeValue: "PACK",  codeName: "포장불량",  description: "포장 라벨·드럼 불량",     sortOrder: 4, active: true },
  { id: "CD-018", typeCode: "CLAIM_TYPE", typeName: "클레임 유형",  codeValue: "DLVY",  codeName: "납기불량",  description: "출하 지연",               sortOrder: 5, active: true },
];

const TYPE_CODES = [...new Set(MOCK_CODES.map((c) => c.typeCode))];

const COLUMNS: Column<CodeItem>[] = [
  { key: "typeCode",    header: "코드유형",    width: 120, render: (v) => <code style={{ fontFamily: "monospace", fontSize: 11.5, background: "#F2F4F7", padding: "1px 6px", borderRadius: 4 }}>{v as string}</code> },
  { key: "typeName",    header: "유형명",      width: 110 },
  { key: "codeValue",   header: "코드값",      width: 100, render: (v) => <code style={{ fontFamily: "monospace", fontSize: 12, fontWeight: 700, color: "#3A5BD9" }}>{v as string}</code> },
  { key: "codeName",    header: "코드명",      width: 100 },
  { key: "description", header: "설명",        width: 220 },
  { key: "sortOrder",   header: "정렬순서",    width: 80, align: "center" },
  {
    key: "active",
    header: "활성",
    width: 75,
    align: "center",
    render: (v) => <StatusBadge variant={v ? "green" : "gray"} label={v ? "활성" : "비활성"} dot />,
  },
  {
    key: "id",
    header: "액션",
    width: 100,
    align: "center",
    render: () => (
      <div style={{ display: "flex", gap: 4, justifyContent: "center" }}>
        <button style={{ padding: "3px 8px", fontSize: 11.5, fontWeight: 600, borderRadius: 5, border: "1px solid #E4E7EC", background: "#fff", color: "#3A5BD9", cursor: "pointer" }}>수정</button>
        <button style={{ padding: "3px 8px", fontSize: 11.5, fontWeight: 600, borderRadius: 5, border: "1px solid #FEF1F2", background: "#FEF1F2", color: "#B91C1C", cursor: "pointer" }}>삭제</button>
      </div>
    ),
  },
];

export default function CodePage() {
  const [selectedType, setSelectedType] = useState<string>("전체");
  const [search, setSearch] = useState("");

  const filtered = MOCK_CODES.filter((c) => {
    if (selectedType !== "전체" && c.typeCode !== selectedType) return false;
    if (search && !c.codeName.includes(search) && !c.codeValue.includes(search) && !c.description.includes(search)) return false;
    return true;
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: "#161B26", margin: 0 }}>코드 관리</h1>
          <p style={{ fontSize: 12.5, color: "#687182", margin: "4px 0 0" }}>시스템 공통 코드 테이블 관리</p>
        </div>
        <button style={{ padding: "8px 18px", fontSize: 13, fontWeight: 600, borderRadius: 8, border: "none", background: "#3A5BD9", color: "#fff", cursor: "pointer" }}>
          + 코드 추가
        </button>
      </div>

      {/* Type filter tabs */}
      <div className="card" style={{ padding: "12px 14px" }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: "#687182", marginRight: 4 }}>코드유형:</span>
          {(["전체", ...TYPE_CODES] as const).map((t) => {
            const cnt = t === "전체" ? MOCK_CODES.length : MOCK_CODES.filter(c => c.typeCode === t).length;
            return (
              <button
                key={t}
                onClick={() => setSelectedType(t)}
                style={{
                  padding: "4px 12px", fontSize: 12, fontWeight: 600, borderRadius: 20,
                  border: "1px solid", cursor: "pointer",
                  borderColor: selectedType === t ? "#3A5BD9" : "#E4E7EC",
                  background: selectedType === t ? "#3A5BD9" : "#fff",
                  color: selectedType === t ? "#fff" : "#687182",
                  fontFamily: t !== "전체" ? "monospace" : "inherit",
                }}
              >
                {t} ({cnt})
              </button>
            );
          })}
          <div style={{ position: "relative", marginLeft: "auto" }}>
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)" }}>
              <circle cx="7" cy="7" r="5" stroke="#9AA4B2" strokeWidth="1.5" />
              <path d="M11 11l3 3" stroke="#9AA4B2" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="코드명, 값, 설명 검색..."
              style={{ width: 200, height: 32, paddingLeft: 28, paddingRight: 10, border: "1px solid #E4E7EC", borderRadius: 7, fontSize: 12, fontFamily: "inherit", background: "#F8F9FB", outline: "none" }} />
          </div>
        </div>
      </div>

      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "12px 16px", borderBottom: "1px solid #E4E7EC" }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: "#161B26" }}>코드 목록 ({filtered.length}건)</span>
        </div>
        <DataTable columns={COLUMNS} data={filtered} rowKey={(r) => r.id} stickyHeader />
      </div>
    </div>
  );
}
