"use client";

import { useState } from "react";
import { StatusBadge } from "@/components/ui/StatusBadge";

// ─── Mock Data ────────────────────────────────────────────────────────────────

interface DataSource {
  id: string;
  name: string;
  type: string;
  description: string;
  status: "연결됨" | "오류" | "동기화중" | "비활성";
  lastSync: string;
  recordCount: number;
  syncInterval: string;
  icon: string;
}

const MOCK_SOURCES: DataSource[] = [
  { id: "mes",      name: "MES 시스템",      type: "REST API",    description: "제조실행시스템 — 생산 실적, LOT 정보, 공정 데이터",  status: "연결됨",  lastSync: "2026-06-27 14:22", recordCount: 48320, syncInterval: "5분",  icon: "M" },
  { id: "erp",      name: "ERP 시스템",      type: "JDBC",        description: "전사자원관리 — 수발주, 재고, 원자재 입고 정보",        status: "연결됨",  lastSync: "2026-06-27 14:18", recordCount: 23150, syncInterval: "15분", icon: "E" },
  { id: "quality",  name: "품질관리 시스템", type: "REST API",    description: "품질 검사 결과, 성분 측정치, 클레임 이력",           status: "연결됨",  lastSync: "2026-06-27 14:20", recordCount: 12480, syncInterval: "10분", icon: "Q" },
  { id: "scada",    name: "SCADA 설비",      type: "OPC-UA",      description: "실시간 설비 센서 데이터 — 온도, RPM, 압력",         status: "동기화중",lastSync: "2026-06-27 14:23", recordCount: 198540, syncInterval: "2초", icon: "S" },
  { id: "lab",      name: "성분분석 장비",   type: "FTP/CSV",     description: "ICP-OES 성분 분석 결과 파일 자동 수집",             status: "연결됨",  lastSync: "2026-06-27 11:05", recordCount: 3820,  syncInterval: "1시간", icon: "L" },
  { id: "legacy",   name: "레거시 DB",       type: "ODBC",        description: "구형 품질 데이터베이스 — 히스토리 마이그레이션용",     status: "오류",    lastSync: "2026-06-26 22:00", recordCount: 87400, syncInterval: "1일",  icon: "D" },
];

const STATUS_MAP: Record<DataSource["status"], { variant: "green" | "red" | "blue" | "gray" }> = {
  연결됨:   { variant: "green" },
  오류:     { variant: "red"   },
  동기화중: { variant: "blue"  },
  비활성:   { variant: "gray"  },
};

const TYPE_COLORS: Record<string, string> = {
  "REST API": "#3A5BD9",
  "JDBC":     "#7C3AED",
  "OPC-UA":   "#16A34A",
  "FTP/CSV":  "#D97706",
  "ODBC":     "#687182",
};

interface SyncLog {
  time: string;
  source: string;
  message: string;
  level: "info" | "warn" | "error";
}

const MOCK_LOGS: SyncLog[] = [
  { time: "14:23:02", source: "SCADA",        message: "실시간 데이터 수신 중 — 198,540 레코드",             level: "info"  },
  { time: "14:22:15", source: "MES",           message: "동기화 완료 — 신규 레코드 34건 추가",               level: "info"  },
  { time: "14:20:08", source: "품질관리",      message: "동기화 완료 — 신규 레코드 12건 추가",               level: "info"  },
  { time: "14:18:33", source: "ERP",           message: "동기화 완료 — 신규 레코드 8건 추가",                level: "info"  },
  { time: "14:00:01", source: "레거시 DB",     message: "연결 타임아웃 — ODBC 드라이버 응답 없음",           level: "error" },
  { time: "13:55:12", source: "성분분석 장비", message: "파일 파싱 경고 — 인코딩 이슈 1건 무시됨",          level: "warn"  },
  { time: "13:00:01", source: "레거시 DB",     message: "재연결 시도 실패 (3/3)",                            level: "error" },
];

const LOG_COLORS = { info: "#1D4ED8", warn: "#B45309", error: "#B91C1C" };
const LOG_BG     = { info: "#EEF1FD", warn: "#FEF6E7", error: "#FEF1F2" };

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DataIntegratePage() {
  const [syncing, setSyncing] = useState<string | null>(null);

  function triggerSync(id: string) {
    setSyncing(id);
    setTimeout(() => setSyncing(null), 2000);
  }

  const connected   = MOCK_SOURCES.filter((s) => s.status === "연결됨" || s.status === "동기화중").length;
  const totalRecs   = MOCK_SOURCES.reduce((a, s) => a + s.recordCount, 0);
  const errorCount  = MOCK_SOURCES.filter((s) => s.status === "오류").length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: "#161B26", margin: 0 }}>데이터 통합관리</h1>
        <p style={{ fontSize: 12.5, color: "#687182", margin: "4px 0 0" }}>연결된 데이터 소스 현황 및 동기화 관리</p>
      </div>

      {/* Summary strip */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
        {[
          { label: "데이터 소스",   value: MOCK_SOURCES.length, unit: "개",  color: "#3A5BD9" },
          { label: "연결됨",        value: connected,            unit: "개",  color: "#16A34A" },
          { label: "오류",          value: errorCount,           unit: "개",  color: errorCount > 0 ? "#DC2626" : "#16A34A" },
          { label: "총 레코드",     value: `${(totalRecs / 10000).toFixed(1)}만`, unit: "건", color: "#7C3AED" },
        ].map((s) => (
          <div key={s.label} className="card" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: "#687182", letterSpacing: "0.03em", textTransform: "uppercase" as const }}>{s.label}</span>
            <span style={{ fontSize: 24, fontWeight: 800, color: s.color, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
              {s.value}<span style={{ fontSize: 12, fontWeight: 500, color: "#9AA4B2", marginLeft: 3 }}>{s.unit}</span>
            </span>
          </div>
        ))}
      </div>

      {/* Error banner */}
      {errorCount > 0 && (
        <div style={{ background: "#FEF1F2", border: "1px solid #FCA5A5", borderRadius: 10, padding: "12px 16px", display: "flex", alignItems: "center", gap: 10 }}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 1L15 14H1L8 1z" stroke="#DC2626" strokeWidth="1.4" strokeLinejoin="round" /><path d="M8 6v4M8 11v.5" stroke="#DC2626" strokeWidth="1.4" strokeLinecap="round" /></svg>
          <span style={{ fontSize: 12.5, color: "#B91C1C" }}>
            <strong>레거시 DB</strong> 연결에 오류가 발생했습니다. ODBC 드라이버 상태를 확인하세요.
          </span>
          <button style={{ marginLeft: "auto", padding: "4px 12px", fontSize: 12, fontWeight: 600, borderRadius: 6, border: "1px solid #FCA5A5", background: "#fff", color: "#B91C1C", cursor: "pointer" }}>
            재연결 시도
          </button>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 20 }}>
        {/* Source cards */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {MOCK_SOURCES.map((src) => {
            const isSyncing = syncing === src.id || src.status === "동기화중";
            return (
              <div key={src.id} className="card" style={{ display: "flex", gap: 14, alignItems: "flex-start", borderColor: src.status === "오류" ? "#FCA5A5" : "#E4E7EC" }}>
                {/* Icon */}
                <div style={{
                  width: 40, height: 40, borderRadius: 10, flexShrink: 0,
                  background: src.status === "오류" ? "#FEF1F2" : "#EEF1FD",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 15, fontWeight: 800,
                  color: src.status === "오류" ? "#DC2626" : "#3A5BD9",
                }}>
                  {src.icon}
                </div>
                {/* Info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "#161B26" }}>{src.name}</span>
                    <StatusBadge variant={STATUS_MAP[src.status].variant} label={src.status} dot />
                    <span style={{ fontSize: 11, fontWeight: 600, color: TYPE_COLORS[src.type] ?? "#687182", background: "#F8F9FB", border: "1px solid #E4E7EC", borderRadius: 4, padding: "1px 6px" }}>
                      {src.type}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: "#687182", marginBottom: 6 }}>{src.description}</div>
                  <div style={{ display: "flex", gap: 16, fontSize: 11.5, color: "#9AA4B2" }}>
                    <span>마지막 동기화: <strong style={{ color: "#687182" }}>{src.lastSync}</strong></span>
                    <span>레코드: <strong style={{ color: "#687182", fontVariantNumeric: "tabular-nums" }}>{src.recordCount.toLocaleString()}건</strong></span>
                    <span>주기: <strong style={{ color: "#687182" }}>{src.syncInterval}</strong></span>
                  </div>
                </div>
                {/* Action */}
                <button
                  onClick={() => triggerSync(src.id)}
                  disabled={src.status === "오류"}
                  style={{
                    padding: "5px 12px", fontSize: 12, fontWeight: 600, borderRadius: 7, flexShrink: 0,
                    border: "1px solid #E4E7EC",
                    background: isSyncing ? "#EEF1FD" : "#F8F9FB",
                    color: isSyncing ? "#3A5BD9" : "#687182",
                    cursor: src.status === "오류" ? "default" : "pointer",
                    opacity: src.status === "오류" ? 0.5 : 1,
                  }}
                >
                  {isSyncing ? "동기화중…" : "수동 동기화"}
                </button>
              </div>
            );
          })}
        </div>

        {/* Sync log */}
        <div className="card" style={{ padding: 0, overflow: "hidden", alignSelf: "flex-start" }}>
          <div style={{ padding: "12px 14px", borderBottom: "1px solid #E4E7EC", fontSize: 13, fontWeight: 700, color: "#161B26" }}>
            동기화 로그
          </div>
          <div style={{ padding: "8px 0", display: "flex", flexDirection: "column" as const }}>
            {MOCK_LOGS.map((log, i) => (
              <div key={i} style={{ padding: "8px 14px", display: "flex", flexDirection: "column" as const, gap: 2, borderBottom: i < MOCK_LOGS.length - 1 ? "1px solid #F2F4F7" : "none" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 5px", borderRadius: 3, background: LOG_BG[log.level], color: LOG_COLORS[log.level], textTransform: "uppercase" as const }}>
                    {log.level}
                  </span>
                  <span style={{ fontSize: 11, color: "#9AA4B2", fontVariantNumeric: "tabular-nums" }}>{log.time}</span>
                  <span style={{ fontSize: 11, color: "#687182", fontWeight: 600 }}>{log.source}</span>
                </div>
                <div style={{ fontSize: 11.5, color: "#161B26", lineHeight: 1.5 }}>{log.message}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
