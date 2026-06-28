"use client";

import { useState } from "react";
import { StatusBadge } from "@/components/ui/StatusBadge";

interface KpiTarget {
  id: string;
  category: "생산" | "품질" | "설비" | "출하";
  name: string;
  unit: string;
  target: number;
  current: number;
  direction: "higher" | "lower";
  frequency: "일" | "월" | "분기";
  owner: string;
  active: boolean;
}

const INITIAL_TARGETS: KpiTarget[] = [
  { id: "KPI-001", category: "생산", name: "월간 생산량",      unit: "kg",  target: 20000, current: 16800, direction: "higher", frequency: "월",   owner: "최생산", active: true  },
  { id: "KPI-002", category: "생산", name: "설비 가동률",      unit: "%",   target: 90,    current: 84,    direction: "higher", frequency: "월",   owner: "최생산", active: true  },
  { id: "KPI-003", category: "생산", name: "생산 효율",        unit: "%",   target: 95,    current: 90,    direction: "higher", frequency: "월",   owner: "최생산", active: true  },
  { id: "KPI-004", category: "품질", name: "불량률",           unit: "%",   target: 3.0,   current: 2.8,   direction: "lower",  frequency: "월",   owner: "박품질", active: true  },
  { id: "KPI-005", category: "품질", name: "클레임률",         unit: "%",   target: 0.5,   current: 0.7,   direction: "lower",  frequency: "월",   owner: "박품질", active: true  },
  { id: "KPI-006", category: "품질", name: "출하 합격률",      unit: "%",   target: 98.0,  current: 97.2,  direction: "higher", frequency: "월",   owner: "박품질", active: true  },
  { id: "KPI-007", category: "품질", name: "평균 품질점수",    unit: "점",  target: 88.0,  current: 85.8,  direction: "higher", frequency: "월",   owner: "이배합", active: true  },
  { id: "KPI-008", category: "설비", name: "예방정비 준수율",  unit: "%",   target: 95,    current: 91,    direction: "higher", frequency: "월",   owner: "정기술", active: true  },
  { id: "KPI-009", category: "설비", name: "계획외 정지 횟수", unit: "회",  target: 2,     current: 1,     direction: "lower",  frequency: "월",   owner: "정기술", active: true  },
  { id: "KPI-010", category: "출하", name: "납기 준수율",      unit: "%",   target: 99.0,  current: 97.8,  direction: "higher", frequency: "월",   owner: "김관리", active: true  },
  { id: "KPI-011", category: "출하", name: "출하 리드타임",    unit: "일",  target: 3,     current: 3.2,   direction: "lower",  frequency: "월",   owner: "김관리", active: true  },
  { id: "KPI-012", category: "생산", name: "1일 생산량",       unit: "kg",  target: 800,   current: 720,   direction: "higher", frequency: "일",   owner: "최생산", active: false },
];

const CAT_V: Record<KpiTarget["category"], "blue" | "green" | "violet" | "amber"> = {
  생산: "blue", 품질: "green", 설비: "violet", 출하: "amber",
};

function achievementColor(pct: number, direction: KpiTarget["direction"]) {
  const good = direction === "higher" ? pct >= 100 : pct <= 100;
  const warn = direction === "higher" ? pct >= 90  : pct <= 110;
  if (good) return "#15803D";
  if (warn) return "#B45309";
  return "#B91C1C";
}

function achievementPct(t: KpiTarget): number {
  return t.direction === "higher"
    ? Math.round((t.current / t.target) * 100)
    : Math.round((t.target / t.current) * 100);
}

export default function KpiManagePage() {
  const [targets, setTargets] = useState(INITIAL_TARGETS);
  const [editId, setEditId] = useState<string | null>(null);
  const [editVal, setEditVal] = useState<number>(0);
  const [catFilter, setCatFilter] = useState<"전체" | KpiTarget["category"]>("전체");

  function startEdit(t: KpiTarget) {
    setEditId(t.id);
    setEditVal(t.target);
  }

  function saveEdit() {
    setTargets((p) => p.map((t) => t.id === editId ? { ...t, target: editVal } : t));
    setEditId(null);
  }

  function toggleActive(id: string) {
    setTargets((p) => p.map((t) => t.id === id ? { ...t, active: !t.active } : t));
  }

  const filtered = catFilter === "전체" ? targets : targets.filter((t) => t.category === catFilter);

  const categories = ["전체", "생산", "품질", "설비", "출하"] as const;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: "#161B26", margin: 0 }}>KPI 관리</h1>
          <p style={{ fontSize: 12.5, color: "#687182", margin: "4px 0 0" }}>KPI 목표치 설정 및 달성 현황 관리</p>
        </div>
        <button style={{ padding: "8px 18px", fontSize: 13, fontWeight: 600, borderRadius: 8, border: "none", background: "#3A5BD9", color: "#fff", cursor: "pointer" }}>
          + KPI 추가
        </button>
      </div>

      {/* Achievement summary */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 }}>
        {(["생산", "품질", "설비", "출하"] as const).map((cat) => {
          const catTargets = targets.filter((t) => t.category === cat && t.active);
          const achieved = catTargets.filter((t) => {
            const pct = t.direction === "higher" ? (t.current / t.target) * 100 : (t.target / t.current) * 100;
            return pct >= 100;
          }).length;
          const rate = catTargets.length > 0 ? Math.round((achieved / catTargets.length) * 100) : 0;
          const colors: Record<string, { text: string; bg: string }> = {
            blue:   { text: "#1D4ED8", bg: "#EEF1FD" },
            green:  { text: "#15803D", bg: "#ECFDF3" },
            violet: { text: "#6D28D9", bg: "#F5F1FE" },
            amber:  { text: "#B45309", bg: "#FEF6E7" },
          };
          const c = colors[CAT_V[cat]];
          return (
            <div key={cat} className="card" style={{ padding: "14px 16px", background: c.bg, border: `1px solid ${c.text}20` }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <span style={{ fontSize: 12.5, fontWeight: 700, color: c.text }}>{cat} KPI</span>
                <span style={{ fontSize: 11, color: c.text }}>{achieved}/{catTargets.length} 달성</span>
              </div>
              <div style={{ fontSize: 26, fontWeight: 900, color: c.text, fontVariantNumeric: "tabular-nums", lineHeight: 1, marginBottom: 8 }}>{rate}%</div>
              <div style={{ height: 4, borderRadius: 2, background: "#fff" }}>
                <div style={{ height: "100%", width: `${rate}%`, borderRadius: 2, background: c.text, transition: "width 0.4s" }} />
              </div>
            </div>
          );
        })}
      </div>

      {/* Category filter */}
      <div style={{ display: "flex", gap: 8 }}>
        {categories.map((c) => (
          <button key={c} onClick={() => setCatFilter(c)} style={{ padding: "5px 14px", fontSize: 12.5, fontWeight: 600, borderRadius: 20, border: "1px solid", cursor: "pointer", borderColor: catFilter === c ? "#3A5BD9" : "#E4E7EC", background: catFilter === c ? "#3A5BD9" : "#fff", color: catFilter === c ? "#fff" : "#687182" }}>{c}</button>
        ))}
      </div>

      {/* KPI table */}
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "12px 16px", borderBottom: "1px solid #E4E7EC" }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: "#161B26" }}>KPI 목표 설정 ({filtered.length}개)</span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, fontVariantNumeric: "tabular-nums" }}>
            <thead>
              <tr style={{ background: "#F8F9FB" }}>
                {["구분", "KPI명", "주기", "목표치", "현재값", "달성률", "담당자", "활성", "액션"].map((h) => (
                  <th key={h} style={{ padding: "9px 14px", textAlign: "left", fontSize: 11.5, fontWeight: 600, color: "#687182", borderBottom: "1px solid #E4E7EC", whiteSpace: "nowrap", letterSpacing: "0.03em", textTransform: "uppercase" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((t, i) => {
                const pct = t.direction === "higher"
                  ? Math.round((t.current / t.target) * 100)
                  : Math.round((t.target / t.current) * 100);
                const ac = achievementColor(pct, t.direction);
                const isEditing = editId === t.id;
                return (
                  <tr key={t.id} style={{ borderBottom: i < filtered.length - 1 ? "1px solid #F2F4F7" : "none", opacity: t.active ? 1 : 0.5 }}>
                    <td style={{ padding: "9px 14px" }}><StatusBadge variant={CAT_V[t.category]} label={t.category} /></td>
                    <td style={{ padding: "9px 14px", fontWeight: 600, color: "#161B26", whiteSpace: "nowrap" }}>{t.name}</td>
                    <td style={{ padding: "9px 14px", color: "#687182" }}>{t.frequency}</td>
                    <td style={{ padding: "9px 14px" }}>
                      {isEditing ? (
                        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                          <input
                            type="number"
                            value={editVal}
                            onChange={(e) => setEditVal(parseFloat(e.target.value))}
                            style={{ width: 70, height: 28, padding: "0 6px", border: "1px solid #3A5BD9", borderRadius: 5, fontSize: 12, fontFamily: "inherit", outline: "none" }}
                          />
                          <button onClick={saveEdit} style={{ padding: "3px 8px", fontSize: 11.5, fontWeight: 700, borderRadius: 5, border: "none", background: "#3A5BD9", color: "#fff", cursor: "pointer" }}>저장</button>
                          <button onClick={() => setEditId(null)} style={{ padding: "3px 8px", fontSize: 11.5, borderRadius: 5, border: "1px solid #E4E7EC", background: "#fff", color: "#687182", cursor: "pointer" }}>취소</button>
                        </div>
                      ) : (
                        <span style={{ fontWeight: 600, color: "#161B26" }}>{t.target}{t.unit}</span>
                      )}
                    </td>
                    <td style={{ padding: "9px 14px", color: "#687182" }}>{t.current}{t.unit}</td>
                    <td style={{ padding: "9px 14px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontWeight: 800, color: ac, fontVariantNumeric: "tabular-nums" }}>{pct}%</span>
                        <div style={{ width: 60, height: 5, borderRadius: 3, background: "#F2F4F7", overflow: "hidden" }}>
                          <div style={{ height: "100%", width: `${Math.min(pct, 100)}%`, borderRadius: 3, background: ac }} />
                        </div>
                      </div>
                    </td>
                    <td style={{ padding: "9px 14px", color: "#687182" }}>{t.owner}</td>
                    <td style={{ padding: "9px 14px" }}>
                      <button onClick={() => toggleActive(t.id)} style={{
                        width: 34, height: 20, borderRadius: 10, border: "none", cursor: "pointer",
                        background: t.active ? "#3A5BD9" : "#D0D5DD", position: "relative",
                      }}>
                        <span style={{ position: "absolute", top: 2, width: 14, height: 14, borderRadius: "50%", background: "#fff", left: t.active ? 18 : 2, transition: "left 0.15s", boxShadow: "0 1px 2px rgba(0,0,0,0.2)" }} />
                      </button>
                    </td>
                    <td style={{ padding: "9px 14px" }}>
                      {!isEditing && (
                        <button onClick={() => startEdit(t)} style={{ padding: "3px 10px", fontSize: 11.5, fontWeight: 600, borderRadius: 5, border: "1px solid #E4E7EC", background: "#fff", color: "#3A5BD9", cursor: "pointer" }}>수정</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
