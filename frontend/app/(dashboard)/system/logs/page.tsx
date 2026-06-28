"use client";

import { useState } from "react";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { DataTable, Column } from "@/components/ui/DataTable";

interface LogRecord {
  id: string;
  time: string;
  user: string;
  action: string;
  target: string;
  ip: string;
  result: "성공" | "실패" | "경고";
  category: "인증" | "데이터" | "모델" | "시스템" | "출하";
}

const MOCK_LOGS: LogRecord[] = [
  { id: "LOG-0001", time: "2026-06-27 09:32:14", user: "김관리",   action: "로그인",            target: "인증 시스템",          ip: "192.168.1.10", result: "성공", category: "인증" },
  { id: "LOG-0002", time: "2026-06-27 09:35:02", user: "이배합",   action: "배합 최적화 실행",   target: "LOT-2026-0629",        ip: "192.168.1.21", result: "성공", category: "모델" },
  { id: "LOG-0003", time: "2026-06-27 09:40:18", user: "박품질",   action: "검사 결과 등록",     target: "INS-009",              ip: "192.168.1.31", result: "성공", category: "데이터" },
  { id: "LOG-0004", time: "2026-06-27 09:45:33", user: "최생산",   action: "공정 조건 변경",     target: "라인 A-3",             ip: "192.168.1.42", result: "성공", category: "시스템" },
  { id: "LOG-0005", time: "2026-06-27 10:01:55", user: "unknown",  action: "로그인 시도",        target: "인증 시스템",          ip: "203.45.12.8",  result: "실패", category: "인증" },
  { id: "LOG-0006", time: "2026-06-27 10:15:22", user: "이배합",   action: "모델 재학습 요청",   target: "GradientBoosting v3",  ip: "192.168.1.21", result: "성공", category: "모델" },
  { id: "LOG-0007", time: "2026-06-27 10:22:09", user: "김관리",   action: "사용자 권한 수정",   target: "USR-007",              ip: "192.168.1.10", result: "성공", category: "시스템" },
  { id: "LOG-0008", time: "2026-06-27 10:33:44", user: "정기술",   action: "원자재 데이터 수정", target: "RM-2026-0315",         ip: "192.168.1.22", result: "경고", category: "데이터" },
  { id: "LOG-0009", time: "2026-06-27 10:50:11", user: "박품질",   action: "출하 승인",          target: "SH-009",               ip: "192.168.1.31", result: "성공", category: "출하" },
  { id: "LOG-0010", time: "2026-06-27 11:02:30", user: "시스템",   action: "자동 백업 실행",     target: "DB 전체",              ip: "127.0.0.1",    result: "성공", category: "시스템" },
  { id: "LOG-0011", time: "2026-06-27 11:15:07", user: "한품질",   action: "클레임 등록",        target: "CLM-011",              ip: "192.168.1.32", result: "성공", category: "데이터" },
  { id: "LOG-0012", time: "2026-06-27 11:28:55", user: "이배합",   action: "성분 분석 조회",     target: "LOT-2026-0623",        ip: "192.168.1.21", result: "성공", category: "데이터" },
  { id: "LOG-0013", time: "2026-06-27 11:40:22", user: "최생산",   action: "생산 실적 입력",     target: "2026-06-27 오전",      ip: "192.168.1.42", result: "성공", category: "데이터" },
  { id: "LOG-0014", time: "2026-06-27 11:55:18", user: "시스템",   action: "ML 예측 배치 실행",  target: "배합 품질 예측 모델",  ip: "127.0.0.1",    result: "성공", category: "모델" },
  { id: "LOG-0015", time: "2026-06-27 12:03:41", user: "unknown",  action: "API 무단 접근 시도", target: "/api/model/predict",   ip: "58.72.14.100", result: "실패", category: "인증" },
];

const RES_MAP: Record<LogRecord["result"], "green" | "red" | "amber"> = {
  성공: "green",
  실패: "red",
  경고: "amber",
};

const CAT_MAP: Record<LogRecord["category"], "blue" | "violet" | "amber" | "gray" | "green"> = {
  인증:   "blue",
  데이터: "violet",
  모델:   "amber",
  시스템: "gray",
  출하:   "green",
};

const COLUMNS: Column<LogRecord>[] = [
  { key: "time",     header: "시간",     width: 155 },
  { key: "user",     header: "사용자",   width: 90 },
  { key: "category", header: "카테고리", width: 90, render: (_, row) => <StatusBadge variant={CAT_MAP[row.category]} label={row.category} /> },
  { key: "action",   header: "액션",     width: 180 },
  { key: "target",   header: "대상",     width: 190 },
  { key: "ip",       header: "IP",       width: 130, render: (v) => <span style={{ fontFamily: "monospace", fontSize: 12, color: "#687182" }}>{v as string}</span> },
  { key: "result",   header: "결과",     width: 75, align: "center", render: (_, row) => <StatusBadge variant={RES_MAP[row.result]} label={row.result} dot /> },
];

export default function LogsPage() {
  const [category, setCategory] = useState<"전체" | LogRecord["category"]>("전체");
  const [result, setResult]     = useState<"전체" | LogRecord["result"]>("전체");
  const [search, setSearch]     = useState("");

  const filtered = MOCK_LOGS.filter((l) => {
    if (category !== "전체" && l.category !== category) return false;
    if (result   !== "전체" && l.result   !== result)   return false;
    if (search && !l.action.includes(search) && !l.user.includes(search) && !l.target.includes(search)) return false;
    return true;
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: "#161B26", margin: 0 }}>시스템 로그</h1>
        <p style={{ fontSize: 12.5, color: "#687182", margin: "4px 0 0" }}>
          사용자 액션·시스템 이벤트 전체 로그
        </p>
      </div>

      {/* Summary */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 }}>
        {[
          { label: "전체 로그", value: MOCK_LOGS.length,                                    color: "#3A5BD9", bg: "#EEF1FD" },
          { label: "성공",      value: MOCK_LOGS.filter(l => l.result === "성공").length,   color: "#15803D", bg: "#ECFDF3" },
          { label: "실패",      value: MOCK_LOGS.filter(l => l.result === "실패").length,   color: "#B91C1C", bg: "#FEF1F2" },
          { label: "경고",      value: MOCK_LOGS.filter(l => l.result === "경고").length,   color: "#B45309", bg: "#FEF6E7" },
        ].map((s) => (
          <div key={s.label} className="card" style={{ padding: "14px 16px" }}>
            <div style={{ fontSize: 11.5, fontWeight: 600, color: "#687182", letterSpacing: "0.03em", textTransform: "uppercase", marginBottom: 6 }}>{s.label}</div>
            <div style={{ fontSize: 28, fontWeight: 800, color: s.color, fontVariantNumeric: "tabular-nums" }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="card" style={{ padding: "14px 16px" }}>
        <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ position: "relative" }}>
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)" }}>
              <circle cx="7" cy="7" r="5" stroke="#9AA4B2" strokeWidth="1.5" />
              <path d="M11 11l3 3" stroke="#9AA4B2" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <input
              value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="사용자, 액션, 대상 검색..."
              style={{ width: 220, height: 34, paddingLeft: 28, paddingRight: 10, border: "1px solid #E4E7EC", borderRadius: 7, fontSize: 12.5, fontFamily: "inherit", background: "#F8F9FB", outline: "none" }}
            />
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <span style={{ fontSize: 12, color: "#687182", fontWeight: 600 }}>카테고리:</span>
            {(["전체", "인증", "데이터", "모델", "시스템", "출하"] as const).map((c) => (
              <button key={c} onClick={() => setCategory(c)} style={{ padding: "4px 10px", fontSize: 11.5, fontWeight: 600, borderRadius: 20, border: "1px solid", cursor: "pointer", borderColor: category === c ? "#3A5BD9" : "#E4E7EC", background: category === c ? "#3A5BD9" : "#fff", color: category === c ? "#fff" : "#687182" }}>{c}</button>
            ))}
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <span style={{ fontSize: 12, color: "#687182", fontWeight: 600 }}>결과:</span>
            {(["전체", "성공", "실패", "경고"] as const).map((r) => (
              <button key={r} onClick={() => setResult(r)} style={{ padding: "4px 10px", fontSize: 11.5, fontWeight: 600, borderRadius: 20, border: "1px solid", cursor: "pointer", borderColor: result === r ? "#3A5BD9" : "#E4E7EC", background: result === r ? "#3A5BD9" : "#fff", color: result === r ? "#fff" : "#687182" }}>{r}</button>
            ))}
          </div>
        </div>
      </div>

      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "12px 16px", borderBottom: "1px solid #E4E7EC" }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: "#161B26" }}>로그 목록 ({filtered.length}건)</span>
        </div>
        <DataTable columns={COLUMNS} data={filtered} rowKey={(r) => r.id} stickyHeader />
      </div>
    </div>
  );
}
