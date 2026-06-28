"use client";

import { useState } from "react";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { DataTable, Column } from "@/components/ui/DataTable";

interface User {
  id: string;
  name: string;
  dept: string;
  role: "관리자" | "배합기술팀" | "품질팀" | "생산팀" | "뷰어";
  email: string;
  lastLogin: string;
  status: "활성" | "비활성";
}

const MOCK_USERS: User[] = [
  { id: "USR-001", name: "김관리",   dept: "IT팀",     role: "관리자",    email: "admin@koreysolder.com",   lastLogin: "2026-06-27 08:32", status: "활성" },
  { id: "USR-002", name: "이배합",   dept: "기술팀",   role: "배합기술팀", email: "mixing@koreysolder.com",   lastLogin: "2026-06-27 07:55", status: "활성" },
  { id: "USR-003", name: "박품질",   dept: "품질팀",   role: "품질팀",    email: "quality@koreysolder.com",  lastLogin: "2026-06-27 09:10", status: "활성" },
  { id: "USR-004", name: "최생산",   dept: "생산팀",   role: "생산팀",    email: "prod@koreysolder.com",     lastLogin: "2026-06-26 16:40", status: "활성" },
  { id: "USR-005", name: "정기술",   dept: "기술팀",   role: "배합기술팀", email: "tech@koreysolder.com",     lastLogin: "2026-06-26 14:20", status: "활성" },
  { id: "USR-006", name: "한품질",   dept: "품질팀",   role: "품질팀",    email: "qc2@koreysolder.com",      lastLogin: "2026-06-25 11:00", status: "활성" },
  { id: "USR-007", name: "오뷰어",   dept: "영업팀",   role: "뷰어",      email: "sales@koreysolder.com",    lastLogin: "2026-06-24 09:00", status: "활성" },
  { id: "USR-008", name: "임생산",   dept: "생산팀",   role: "생산팀",    email: "prod2@koreysolder.com",    lastLogin: "2026-06-20 17:30", status: "비활성" },
];

const ROLE_VARIANT: Record<User["role"], "blue" | "violet" | "green" | "amber" | "gray"> = {
  관리자:    "blue",
  배합기술팀: "violet",
  품질팀:    "green",
  생산팀:    "amber",
  뷰어:      "gray",
};

const COLUMNS: Column<User>[] = [
  { key: "name",      header: "이름",        width: 90 },
  { key: "dept",      header: "부서",        width: 100 },
  { key: "role",      header: "역할",        width: 110, render: (_, row) => <StatusBadge variant={ROLE_VARIANT[row.role]} label={row.role} /> },
  { key: "email",     header: "이메일",      width: 210 },
  { key: "lastLogin", header: "마지막 로그인", width: 155 },
  { key: "status",    header: "상태",        width: 80, align: "center", render: (_, row) => <StatusBadge variant={row.status === "활성" ? "green" : "gray"} label={row.status} dot /> },
  {
    key: "id",
    header: "액션",
    width: 120,
    align: "center",
    render: () => (
      <div style={{ display: "flex", gap: 6, justifyContent: "center" }}>
        <button style={{ padding: "3px 9px", fontSize: 11.5, fontWeight: 600, borderRadius: 5, border: "1px solid #E4E7EC", background: "#fff", color: "#3A5BD9", cursor: "pointer" }}>수정</button>
        <button style={{ padding: "3px 9px", fontSize: 11.5, fontWeight: 600, borderRadius: 5, border: "1px solid #FEF1F2", background: "#FEF1F2", color: "#B91C1C", cursor: "pointer" }}>삭제</button>
      </div>
    ),
  },
];

export default function UsersPage() {
  const [showModal, setShowModal] = useState(false);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: "#161B26", margin: 0 }}>사용자 관리</h1>
          <p style={{ fontSize: 12.5, color: "#687182", margin: "4px 0 0" }}>
            시스템 사용자 계정 및 역할 관리
          </p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          style={{
            padding: "8px 18px", fontSize: 13, fontWeight: 600, borderRadius: 8,
            border: "none", background: "#3A5BD9", color: "#fff", cursor: "pointer",
          }}
        >
          + 사용자 추가
        </button>
      </div>

      {/* Role summary */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12 }}>
        {(["관리자", "배합기술팀", "품질팀", "생산팀", "뷰어"] as const).map((role) => {
          const cnt = MOCK_USERS.filter((u) => u.role === role).length;
          const variant = ROLE_VARIANT[role];
          const colors: Record<string, { text: string; bg: string }> = {
            blue:   { text: "#1D4ED8", bg: "#EEF1FD" },
            violet: { text: "#6D28D9", bg: "#F5F1FE" },
            green:  { text: "#15803D", bg: "#ECFDF3" },
            amber:  { text: "#B45309", bg: "#FEF6E7" },
            gray:   { text: "#5B6573", bg: "#F2F4F7" },
          };
          const c = colors[variant];
          return (
            <div key={role} style={{ padding: "12px 14px", borderRadius: 10, background: c.bg, border: `1px solid ${c.text}20` }}>
              <div style={{ fontSize: 20, fontWeight: 800, color: c.text, fontVariantNumeric: "tabular-nums" }}>{cnt}</div>
              <div style={{ fontSize: 11.5, fontWeight: 600, color: c.text, marginTop: 2 }}>{role}</div>
            </div>
          );
        })}
      </div>

      {/* Table */}
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "14px 16px", borderBottom: "1px solid #E4E7EC" }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: "#161B26" }}>
            전체 사용자 ({MOCK_USERS.length}명)
          </span>
        </div>
        <DataTable columns={COLUMNS} data={MOCK_USERS} rowKey={(r) => r.id} stickyHeader />
      </div>

      {/* Add user modal */}
      {showModal && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 200,
          display: "flex", alignItems: "center", justifyContent: "center",
        }} onClick={() => setShowModal(false)}>
          <div style={{ background: "#fff", borderRadius: 14, padding: 28, width: 420, boxShadow: "0 20px 60px rgba(0,0,0,0.2)" }}
            onClick={(e) => e.stopPropagation()}>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#161B26", marginBottom: 20 }}>사용자 추가</div>
            {[
              { label: "이름",   placeholder: "홍길동" },
              { label: "이메일", placeholder: "user@koreysolder.com" },
              { label: "부서",   placeholder: "기술팀" },
            ].map((f) => (
              <div key={f.label} style={{ marginBottom: 14 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: "#687182", display: "block", marginBottom: 5 }}>{f.label}</label>
                <input placeholder={f.placeholder} style={{ width: "100%", height: 36, padding: "0 12px", border: "1px solid #E4E7EC", borderRadius: 7, fontSize: 13, fontFamily: "inherit", outline: "none", boxSizing: "border-box" }} />
              </div>
            ))}
            <div style={{ marginBottom: 20 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: "#687182", display: "block", marginBottom: 5 }}>역할</label>
              <select style={{ width: "100%", height: 36, padding: "0 12px", border: "1px solid #E4E7EC", borderRadius: 7, fontSize: 13, fontFamily: "inherit", background: "#fff" }}>
                {["관리자", "배합기술팀", "품질팀", "생산팀", "뷰어"].map((r) => <option key={r}>{r}</option>)}
              </select>
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button onClick={() => setShowModal(false)} style={{ padding: "8px 18px", fontSize: 13, fontWeight: 600, borderRadius: 7, border: "1px solid #E4E7EC", background: "#fff", color: "#687182", cursor: "pointer" }}>취소</button>
              <button onClick={() => setShowModal(false)} style={{ padding: "8px 18px", fontSize: 13, fontWeight: 600, borderRadius: 7, border: "none", background: "#3A5BD9", color: "#fff", cursor: "pointer" }}>추가</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
