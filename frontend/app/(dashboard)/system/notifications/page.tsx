"use client";

import { useState } from "react";
import { StatusBadge } from "@/components/ui/StatusBadge";

interface NotifRule {
  id: string;
  name: string;
  condition: string;
  recipients: string[];
  channels: ("이메일" | "SMS" | "슬랙")[];
  active: boolean;
  severity: "높음" | "중간" | "낮음";
}

interface NotifHistory {
  id: string;
  rule: string;
  sent: string;
  channel: string;
  recipient: string;
  message: string;
  status: "전송완료" | "전송실패";
}

const MOCK_RULES: NotifRule[] = [
  { id: "NR-001", name: "성분 이상 경보",   condition: "성분 편차 > ±1.5%",         recipients: ["품질팀 전체", "이배합"],  channels: ["이메일", "슬랙"], active: true,  severity: "높음" },
  { id: "NR-002", name: "불합격 LOT 발생",  condition: "검사 결과 = 불합격",         recipients: ["품질팀 전체", "김관리"],  channels: ["이메일", "SMS"],  active: true,  severity: "높음" },
  { id: "NR-003", name: "출하 지연 경고",   condition: "출하 예정 초과 > 2시간",     recipients: ["생산팀 전체"],            channels: ["슬랙"],           active: true,  severity: "중간" },
  { id: "NR-004", name: "클레임 신규 접수", condition: "클레임 status = 접수",       recipients: ["김관리", "박품질"],       channels: ["이메일"],         active: true,  severity: "중간" },
  { id: "NR-005", name: "모델 정확도 저하", condition: "R² < 0.75",                  recipients: ["이배합", "정기술"],       channels: ["이메일", "슬랙"], active: true,  severity: "높음" },
  { id: "NR-006", name: "로그인 실패 반복", condition: "로그인 실패 >= 5회/10분",    recipients: ["김관리"],                 channels: ["이메일", "SMS"],  active: true,  severity: "높음" },
  { id: "NR-007", name: "배치 처리 완료",   condition: "ML 배치 예측 완료",          recipients: ["이배합"],                 channels: ["슬랙"],           active: false, severity: "낮음" },
  { id: "NR-008", name: "DB 용량 경고",     condition: "DB 사용률 > 80%",            recipients: ["김관리"],                 channels: ["이메일"],         active: false, severity: "중간" },
];

const MOCK_HISTORY: NotifHistory[] = [
  { id: "NH-001", rule: "성분 이상 경보",   sent: "2026-06-27 10:33", channel: "슬랙",   recipient: "품질팀 전체", message: "LOT-2026-0623 Pb 함량 편차 +0.9% 감지",  status: "전송완료" },
  { id: "NH-002", rule: "불합격 LOT 발생",  sent: "2026-06-27 10:35", channel: "이메일", recipient: "김관리",      message: "LOT-2026-0623 성분 검사 불합격 판정",      status: "전송완료" },
  { id: "NH-003", rule: "클레임 신규 접수", sent: "2026-06-27 09:10", channel: "이메일", recipient: "박품질",      message: "CLM-011 LG이노텍 외관불량 클레임 접수",    status: "전송완료" },
  { id: "NH-004", rule: "로그인 실패 반복", sent: "2026-06-27 10:05", channel: "SMS",    recipient: "김관리",      message: "외부 IP 203.45.12.8 로그인 2회 실패",      status: "전송완료" },
  { id: "NH-005", rule: "모델 정확도 저하", sent: "2026-06-26 16:20", channel: "이메일", recipient: "이배합",      message: "RandomForest R²=0.71 — 재학습 권장",      status: "전송완료" },
  { id: "NH-006", rule: "출하 지연 경고",   sent: "2026-06-26 14:15", channel: "슬랙",   recipient: "생산팀 전체", message: "SH-010 출하 예정 2.5시간 초과 대기 중",    status: "전송실패" },
];

const SEV_VARIANT: Record<NotifRule["severity"], "red" | "amber" | "gray"> = {
  높음: "red", 중간: "amber", 낮음: "gray",
};

const CHANNEL_COLORS: Record<string, { bg: string; color: string }> = {
  이메일: { bg: "#EEF1FD", color: "#1D4ED8" },
  SMS:    { bg: "#FEF6E7", color: "#B45309" },
  슬랙:   { bg: "#ECFDF3", color: "#15803D" },
};

export default function NotificationsPage() {
  const [rules, setRules] = useState(MOCK_RULES);

  function toggleRule(id: string) {
    setRules((prev) => prev.map((r) => r.id === id ? { ...r, active: !r.active } : r));
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: "#161B26", margin: 0 }}>알림 설정</h1>
          <p style={{ fontSize: 12.5, color: "#687182", margin: "4px 0 0" }}>알림 규칙 관리 및 발송 이력</p>
        </div>
        <button style={{ padding: "8px 18px", fontSize: 13, fontWeight: 600, borderRadius: 8, border: "none", background: "#3A5BD9", color: "#fff", cursor: "pointer" }}>
          + 규칙 추가
        </button>
      </div>

      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 }}>
        {[
          { label: "전체 규칙",    value: rules.length,                       color: "#3A5BD9" },
          { label: "활성 규칙",    value: rules.filter(r => r.active).length, color: "#15803D" },
          { label: "오늘 발송",    value: MOCK_HISTORY.length,                color: "#7C3AED" },
          { label: "전송 실패",    value: MOCK_HISTORY.filter(h => h.status === "전송실패").length, color: "#B91C1C" },
        ].map((s) => (
          <div key={s.label} className="card" style={{ padding: "14px 16px" }}>
            <div style={{ fontSize: 11.5, fontWeight: 600, color: "#687182", letterSpacing: "0.03em", textTransform: "uppercase", marginBottom: 6 }}>{s.label}</div>
            <div style={{ fontSize: 28, fontWeight: 800, color: s.color, fontVariantNumeric: "tabular-nums" }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Rules */}
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "14px 16px", borderBottom: "1px solid #E4E7EC" }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: "#161B26" }}>알림 규칙</span>
        </div>
        {rules.map((rule, i) => (
          <div key={rule.id} style={{
            padding: "14px 16px",
            borderBottom: i < rules.length - 1 ? "1px solid #F2F4F7" : "none",
            display: "flex", alignItems: "center", gap: 14,
            background: rule.active ? "#fff" : "#FAFBFC",
            opacity: rule.active ? 1 : 0.7,
          }}>
            {/* Toggle */}
            <button
              onClick={() => toggleRule(rule.id)}
              style={{
                width: 38, height: 22, borderRadius: 11, border: "none", cursor: "pointer",
                background: rule.active ? "#3A5BD9" : "#D0D5DD", flexShrink: 0,
                position: "relative", transition: "background 0.2s",
              }}
              aria-label={`${rule.name} ${rule.active ? "비활성화" : "활성화"}`}
            >
              <span style={{
                position: "absolute", top: 3, width: 16, height: 16, borderRadius: "50%",
                background: "#fff", transition: "left 0.2s",
                left: rule.active ? 19 : 3,
                boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
              }} />
            </button>

            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: "#161B26" }}>{rule.name}</span>
                <StatusBadge variant={SEV_VARIANT[rule.severity]} label={rule.severity} />
              </div>
              <div style={{ fontSize: 12, color: "#687182" }}>
                조건: <code style={{ fontFamily: "monospace", background: "#F2F4F7", padding: "1px 5px", borderRadius: 4, fontSize: 11.5 }}>{rule.condition}</code>
              </div>
            </div>

            <div style={{ display: "flex", gap: 5, flexShrink: 0 }}>
              {rule.channels.map((ch) => (
                <span key={ch} style={{ padding: "2px 8px", borderRadius: 20, fontSize: 11.5, fontWeight: 600, ...CHANNEL_COLORS[ch] }}>{ch}</span>
              ))}
            </div>

            <div style={{ fontSize: 11.5, color: "#687182", minWidth: 120, textAlign: "right" }}>
              {rule.recipients.join(", ")}
            </div>

            <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
              <button style={{ padding: "4px 10px", fontSize: 11.5, fontWeight: 600, borderRadius: 6, border: "1px solid #E4E7EC", background: "#fff", color: "#3A5BD9", cursor: "pointer" }}>수정</button>
              <button style={{ padding: "4px 10px", fontSize: 11.5, fontWeight: 600, borderRadius: 6, border: "1px solid #FEF1F2", background: "#FEF1F2", color: "#B91C1C", cursor: "pointer" }}>삭제</button>
            </div>
          </div>
        ))}
      </div>

      {/* History */}
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "14px 16px", borderBottom: "1px solid #E4E7EC" }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: "#161B26" }}>발송 이력</span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
            <thead>
              <tr style={{ background: "#F8F9FB" }}>
                {["발송시간", "규칙명", "채널", "수신자", "메시지", "상태"].map((h) => (
                  <th key={h} style={{ padding: "9px 14px", textAlign: "left", fontSize: 11.5, fontWeight: 600, color: "#687182", borderBottom: "1px solid #E4E7EC", whiteSpace: "nowrap", letterSpacing: "0.03em", textTransform: "uppercase" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {MOCK_HISTORY.map((h, i) => (
                <tr key={h.id} style={{ borderBottom: i < MOCK_HISTORY.length - 1 ? "1px solid #F2F4F7" : "none" }}>
                  <td style={{ padding: "9px 14px", color: "#687182", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{h.sent}</td>
                  <td style={{ padding: "9px 14px", fontWeight: 600, color: "#161B26" }}>{h.rule}</td>
                  <td style={{ padding: "9px 14px" }}>
                    <span style={{ padding: "2px 8px", borderRadius: 20, fontSize: 11.5, fontWeight: 600, ...CHANNEL_COLORS[h.channel] }}>{h.channel}</span>
                  </td>
                  <td style={{ padding: "9px 14px", color: "#687182" }}>{h.recipient}</td>
                  <td style={{ padding: "9px 14px", color: "#161B26", maxWidth: 280 }}>{h.message}</td>
                  <td style={{ padding: "9px 14px" }}>
                    <StatusBadge variant={h.status === "전송완료" ? "green" : "red"} label={h.status} dot />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
