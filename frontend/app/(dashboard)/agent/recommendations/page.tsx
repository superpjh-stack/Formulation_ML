"use client";

import { useState } from "react";
import { StatusBadge } from "@/components/ui/StatusBadge";

interface Recommendation {
  id: string;
  type: "경보" | "추천" | "예측" | "정보";
  title: string;
  body: string;
  source: string;
  time: string;
  read: boolean;
  priority: "high" | "medium" | "low";
}

const MOCK_RECS: Recommendation[] = [
  { id: "REC-001", type: "경보",  priority: "high",   title: "LOT-2026-0623 성분 불합격",          body: "Pb 함량 40.9% — 규격(40±0.5%) 초과. 즉시 조치 필요.",                          source: "품질 AI",  time: "10분 전",  read: false },
  { id: "REC-002", type: "경보",  priority: "high",   title: "계량 센서 이상 감지",                 body: "최근 3 LOT 연속 성분 편차 양방향 패턴. 센서 교정 권장.",                        source: "설비 AI",  time: "23분 전",  read: false },
  { id: "REC-003", type: "추천",  priority: "medium", title: "배합비 최적화 추천 — LOT-2026-0630", body: "Sn 62.95% / Pb 37.05% 배합 시 품질점수 +2.1점 예측.",                          source: "배합 AI",  time: "45분 전",  read: false },
  { id: "REC-004", type: "예측",  priority: "medium", title: "오후 불량률 2.4% 예측",              body: "오후 2시 이후 생산분 불량률 2.4% 예측. 원자재 편차 영향.",                       source: "품질 AI",  time: "1시간 전", read: true  },
  { id: "REC-005", type: "추천",  priority: "medium", title: "SH-013 출하 승인 촉구",              body: "LS산전 출하(700 kg) 승인 대기 중. 납기 기준 2시간 이내 처리 필요.",               source: "출하 AI",  time: "1시간 전", read: true  },
  { id: "REC-006", type: "정보",  priority: "low",    title: "GradientBoosting 재학습 완료",       body: "모델 재학습 완료. R²: 0.627 → 0.661, MAPE: 4.1% → 3.2% 개선.",               source: "ML AI",   time: "2시간 전", read: true  },
  { id: "REC-007", type: "예측",  priority: "low",    title: "SUP_A 입고 예정 — 내일 오전",        body: "Sn 원자재 1,200 kg 입고 예정. 순도 99.91% (정상 범위).",                        source: "공급망 AI", time: "3시간 전", read: true  },
  { id: "REC-008", type: "정보",  priority: "low",    title: "월간 생산 목표 84% 달성",            body: "6월 27일 기준 월 목표 생산량 84% 달성. 목표치 초과 전망.",                       source: "생산 AI",  time: "4시간 전", read: true  },
  { id: "REC-009", type: "추천",  priority: "medium", title: "CLM-009 원인 분석 완료",             body: "삼성전자 클레임(Cu 혼입) 원인: 배합 설비 세척 불량. 세척 주기 단축 권장.",         source: "품질 AI",  time: "5시간 전", read: true  },
  { id: "REC-010", type: "경보",  priority: "high",   title: "외부 IP 로그인 시도 차단",           body: "203.45.12.8 로그인 2회 실패. 보안 팀 확인 권장.",                               source: "보안 AI",  time: "어제",     read: true  },
];

const TYPE_STYLES: Record<Recommendation["type"], { bg: string; color: string; border: string }> = {
  경보: { bg: "#FEF1F2", color: "#B91C1C", border: "#FECDD3" },
  추천: { bg: "#EEF1FD", color: "#1D4ED8", border: "#C7D2FE" },
  예측: { bg: "#FEF6E7", color: "#B45309", border: "#FDE68A" },
  정보: { bg: "#F8F9FB", color: "#5B6573", border: "#E4E7EC" },
};

const PRIORITY_DOT: Record<Recommendation["priority"], string> = {
  high: "#DC2626", medium: "#F59E0B", low: "#9AA4B2",
};

export default function RecommendationsPage() {
  const [recs, setRecs] = useState(MOCK_RECS);
  const [typeFilter, setTypeFilter] = useState<"전체" | Recommendation["type"]>("전체");

  function markRead(id: string) {
    setRecs((p) => p.map((r) => r.id === id ? { ...r, read: true } : r));
  }

  function markAllRead() {
    setRecs((p) => p.map((r) => ({ ...r, read: true })));
  }

  const filtered = typeFilter === "전체" ? recs : recs.filter((r) => r.type === typeFilter);
  const unreadCount = recs.filter((r) => !r.read).length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <h1 style={{ fontSize: 20, fontWeight: 700, color: "#161B26", margin: 0 }}>알림 및 추천</h1>
            {unreadCount > 0 && (
              <span style={{ padding: "2px 9px", borderRadius: 20, fontSize: 12, fontWeight: 700, background: "#3A5BD9", color: "#fff" }}>{unreadCount}</span>
            )}
          </div>
          <p style={{ fontSize: 12.5, color: "#687182", margin: "4px 0 0" }}>실시간 AI 추천 알림 피드</p>
        </div>
        <button onClick={markAllRead} style={{ padding: "7px 16px", fontSize: 12.5, fontWeight: 600, borderRadius: 7, border: "1px solid #E4E7EC", background: "#fff", color: "#687182", cursor: "pointer" }}>
          모두 읽음
        </button>
      </div>

      {/* Summary */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 }}>
        {(["경보", "추천", "예측", "정보"] as const).map((type) => {
          const cnt = recs.filter((r) => r.type === type).length;
          const unread = recs.filter((r) => r.type === type && !r.read).length;
          const s = TYPE_STYLES[type];
          return (
            <div key={type} className="card" style={{ padding: "14px 16px", border: `1px solid ${s.border}`, background: s.bg }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: s.color }}>{type}</span>
                {unread > 0 && <span style={{ fontSize: 11, fontWeight: 700, color: s.color, background: "#fff", padding: "1px 6px", borderRadius: 20 }}>미확인 {unread}</span>}
              </div>
              <div style={{ fontSize: 24, fontWeight: 800, color: s.color, fontVariantNumeric: "tabular-nums" }}>{cnt}</div>
            </div>
          );
        })}
      </div>

      {/* Type filter */}
      <div style={{ display: "flex", gap: 8 }}>
        {(["전체", "경보", "추천", "예측", "정보"] as const).map((f) => (
          <button key={f} onClick={() => setTypeFilter(f)} style={{ padding: "5px 14px", fontSize: 12.5, fontWeight: 600, borderRadius: 20, border: "1px solid", cursor: "pointer", borderColor: typeFilter === f ? "#3A5BD9" : "#E4E7EC", background: typeFilter === f ? "#3A5BD9" : "#fff", color: typeFilter === f ? "#fff" : "#687182" }}>{f}</button>
        ))}
      </div>

      {/* Feed */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {filtered.map((rec) => {
          const s = TYPE_STYLES[rec.type];
          return (
            <div
              key={rec.id}
              onClick={() => markRead(rec.id)}
              style={{
                padding: "14px 16px",
                borderRadius: 10,
                border: `1px solid ${rec.read ? "#E4E7EC" : s.border}`,
                background: rec.read ? "#fff" : s.bg,
                cursor: "pointer",
                display: "flex",
                gap: 12,
                alignItems: "flex-start",
                transition: "all 0.15s",
              }}
            >
              {/* Unread dot */}
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: rec.read ? "#E4E7EC" : PRIORITY_DOT[rec.priority], flexShrink: 0, marginTop: 6 }} />

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 4 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ padding: "1px 7px", borderRadius: 20, fontSize: 11, fontWeight: 700, color: s.color, background: rec.read ? "#F2F4F7" : "#fff" }}>{rec.type}</span>
                    <span style={{ fontSize: 13, fontWeight: rec.read ? 500 : 700, color: "#161B26" }}>{rec.title}</span>
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
                    <span style={{ fontSize: 11.5, color: "#9AA4B2", whiteSpace: "nowrap" }}>{rec.time}</span>
                    <span style={{ fontSize: 11, color: "#9AA4B2", background: "#F2F4F7", padding: "1px 7px", borderRadius: 20 }}>{rec.source}</span>
                  </div>
                </div>
                <p style={{ margin: 0, fontSize: 12.5, color: "#687182", lineHeight: 1.5 }}>{rec.body}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
