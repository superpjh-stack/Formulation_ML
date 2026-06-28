"use client";

import { useState, useEffect } from "react";
import { DataTable, Column } from "@/components/ui/DataTable";
import { StatusBadge } from "@/components/ui/StatusBadge";

// ── Types & Mock Data ────────────────────────────────────────────────────────

interface Equipment {
  id: string;
  name: string;
  type: string;
  valueLabel: string;
  value: number;
  unit: string;
  normalMin: number;
  normalMax: number;
  status: "정상" | "주의" | "점검중" | "이상";
  lastCheck: string;
  runtime: string;
}

const EQUIPMENT: Equipment[] = [
  { id: "FUR-A", name: "용광로 A", type: "furnace", valueLabel: "온도", value: 1180, unit: "°C", normalMin: 1150, normalMax: 1200, status: "정상",   lastCheck: "2026-06-28 06:00", runtime: "18h 32m" },
  { id: "FUR-B", name: "용광로 B", type: "furnace", valueLabel: "온도", value: 1175, unit: "°C", normalMin: 1150, normalMax: 1200, status: "정상",   lastCheck: "2026-06-28 06:00", runtime: "16h 15m" },
  { id: "AGT-A", name: "교반기 A", type: "agitator", valueLabel: "RPM", value: 45,   unit: "rpm", normalMin: 30,   normalMax: 60,   status: "정상",   lastCheck: "2026-06-27 18:00", runtime: "22h 10m" },
  { id: "AGT-B", name: "교반기 B", type: "agitator", valueLabel: "RPM", value: 0,    unit: "rpm", normalMin: 30,   normalMax: 60,   status: "점검중", lastCheck: "2026-06-28 08:30", runtime: "—" },
  { id: "CL-A",  name: "냉각라인 A", type: "cooling", valueLabel: "온도", value: 25,  unit: "°C", normalMin: 15,   normalMax: 30,   status: "정상",   lastCheck: "2026-06-28 07:00", runtime: "14h 05m" },
  { id: "CL-B",  name: "냉각라인 B", type: "cooling", valueLabel: "온도", value: 31,  unit: "°C", normalMin: 15,   normalMax: 30,   status: "주의",   lastCheck: "2026-06-28 07:00", runtime: "14h 05m" },
];

interface AlarmRow {
  time: string;
  equipment: string;
  level: "경고" | "정보" | "긴급";
  message: string;
  resolved: boolean;
}

const ALARMS: AlarmRow[] = [
  { time: "08:47", equipment: "냉각라인 B", level: "경고", message: "냉각수 온도 정상 범위 초과 (31°C > 30°C)", resolved: false },
  { time: "08:30", equipment: "교반기 B",   level: "정보", message: "정기 점검 시작 — 예상 완료 10:30", resolved: false },
  { time: "07:12", equipment: "용광로 A",   level: "정보", message: "가열 사이클 정상 완료", resolved: true },
  { time: "06:55", equipment: "교반기 A",   level: "경고", message: "진동 수치 일시 상승 (1.8g) — 자동 복구", resolved: true },
  { time: "05:30", equipment: "냉각라인 A", level: "정보", message: "냉각수 보충 완료", resolved: true },
  { time: "04:10", equipment: "용광로 B",   level: "경고", message: "온도 변동 ±15°C 초과 — 안정화 완료", resolved: true },
  { time: "02:38", equipment: "용광로 A",   level: "정보", message: "야간 가동 모드 전환", resolved: true },
  { time: "01:15", equipment: "교반기 A",   level: "정보", message: "윤활유 자동 공급", resolved: true },
  { time: "00:02", equipment: "냉각라인 B", level: "경고", message: "냉각수 유량 저하 감지 — 복구됨", resolved: true },
  { time: "전일 23:45", equipment: "용광로 B", level: "정보", message: "배치 교체 완료", resolved: true },
];

// ── Gauge Bar ────────────────────────────────────────────────────────────────

function GaugeBar({ value, min, max, status }: { value: number; min: number; max: number; status: string }) {
  const pct = Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
  const color = status === "정상" ? "#3A5BD9" : status === "주의" ? "#D97706" : status === "점검중" ? "#9AA4B2" : "#DC2626";
  return (
    <div style={{ width: "100%", height: 5, background: "#F2F4F7", borderRadius: 4, overflow: "hidden", marginTop: 6 }}>
      <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 4, transition: "width 0.6s ease" }} />
    </div>
  );
}

// ── Equipment Card ───────────────────────────────────────────────────────────

const STATUS_VARIANT: Record<string, "green" | "amber" | "red" | "gray"> = {
  "정상": "green", "주의": "amber", "점검중": "amber", "이상": "red",
};

const EQUIP_ICON: Record<string, string> = {
  furnace: "🔥",
  agitator: "⚙️",
  cooling: "❄️",
};

function EquipCard({ eq }: { eq: Equipment }) {
  const [tick, setTick] = useState(0);

  // 정상 설비만 값 미세 변동 시뮬레이션
  useEffect(() => {
    if (eq.status !== "정상") return;
    const id = setInterval(() => setTick((t) => t + 1), 3000);
    return () => clearInterval(id);
  }, [eq.status]);

  const liveValue = eq.status === "정상"
    ? eq.value + (tick % 2 === 0 ? 0 : Math.round((Math.random() - 0.5) * 2))
    : eq.value;

  const isAlert = eq.status === "주의" || eq.status === "이상";
  const isMaint = eq.status === "점검중";

  return (
    <div
      className="card"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
        border: isAlert
          ? "1px solid #FDE68A"
          : isMaint
          ? "1px solid #E4E7EC"
          : "1px solid #E4E7EC",
        background: isAlert ? "#FFFBEB" : "#fff",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Alert stripe */}
      {isAlert && (
        <div style={{ position: "absolute", top: 0, left: 0, width: "100%", height: 3, background: "#F59E0B" }} />
      )}

      {/* Header row */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 20 }}>{EQUIP_ICON[eq.type]}</span>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#161B26" }}>{eq.name}</div>
            <div style={{ fontSize: 11, color: "#9AA4B2", marginTop: 1 }}>{eq.id}</div>
          </div>
        </div>
        <StatusBadge variant={STATUS_VARIANT[eq.status] ?? "gray"} label={eq.status} dot />
      </div>

      {/* Value */}
      <div>
        <div style={{ fontSize: 11, fontWeight: 600, color: "#687182", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 4 }}>
          현재 {eq.valueLabel}
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
          <span style={{ fontSize: 28, fontWeight: 800, color: isAlert ? "#B45309" : "#161B26", fontVariantNumeric: "tabular-nums", letterSpacing: "-0.02em" }}>
            {eq.status === "점검중" ? "—" : liveValue.toLocaleString()}
          </span>
          <span style={{ fontSize: 13, color: "#9AA4B2", fontWeight: 500 }}>{eq.unit}</span>
        </div>
        <GaugeBar value={liveValue} min={eq.normalMin} max={eq.normalMax} status={eq.status} />
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, color: "#9AA4B2", marginTop: 4 }}>
          <span>정상: {eq.normalMin}–{eq.normalMax} {eq.unit}</span>
          {eq.status === "정상" && (
            <span style={{ color: "#15803D", fontWeight: 600 }}>정상 범위</span>
          )}
          {eq.status === "주의" && (
            <span style={{ color: "#B45309", fontWeight: 600 }}>범위 초과</span>
          )}
        </div>
      </div>

      {/* Meta */}
      <div style={{ borderTop: "1px solid #F2F4F7", paddingTop: 10, display: "flex", justifyContent: "space-between", fontSize: 11.5, color: "#9AA4B2" }}>
        <span>가동시간 <strong style={{ color: "#687182" }}>{eq.runtime}</strong></span>
        <span>점검 {eq.lastCheck.split(" ")[1]}</span>
      </div>
    </div>
  );
}

// ── Alarm Table ──────────────────────────────────────────────────────────────

const LEVEL_VARIANT: Record<string, "red" | "amber" | "blue"> = {
  "긴급": "red", "경고": "amber", "정보": "blue",
};

const ALARM_COLUMNS: Column<AlarmRow>[] = [
  { key: "time",      header: "시각",   width: 100 },
  { key: "equipment", header: "설비",   width: 130 },
  {
    key: "level", header: "등급", width: 70, align: "center",
    render: (_, row) => <StatusBadge variant={LEVEL_VARIANT[row.level]} label={row.level} />,
  },
  { key: "message",   header: "내용",   render: (v, row) => (
    <span style={{ color: row.resolved ? "#9AA4B2" : "#161B26" }}>{v as string}</span>
  )},
  {
    key: "resolved", header: "처리", width: 70, align: "center",
    render: (v) => v
      ? <span style={{ fontSize: 11.5, color: "#15803D", fontWeight: 600 }}>완료</span>
      : <span style={{ fontSize: 11.5, color: "#B45309", fontWeight: 600 }}>미처리</span>,
  },
];

// ── Page ─────────────────────────────────────────────────────────────────────

export default function EquipmentPage() {
  const normalCount = EQUIPMENT.filter((e) => e.status === "정상").length;
  const warnCount   = EQUIPMENT.filter((e) => e.status === "주의" || e.status === "이상").length;
  const maintCount  = EQUIPMENT.filter((e) => e.status === "점검중").length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: "#161B26", margin: 0 }}>설비 상태 모니터링</h1>
          <p style={{ fontSize: 12.5, color: "#687182", margin: "4px 0 0" }}>실시간 설비 현황 및 경보 이력</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z"/><path d="M12 7v5l3 3"/></svg>
            새로고침
          </button>
        </div>
      </div>

      {/* Summary strip */}
      <div style={{ display: "flex", gap: 12 }}>
        {[
          { label: "정상 가동", count: normalCount, color: "#15803D", bg: "#ECFDF3" },
          { label: "주의 필요", count: warnCount,   color: "#B45309", bg: "#FEF6E7" },
          { label: "점검 중",   count: maintCount,  color: "#687182", bg: "#F2F4F7" },
        ].map((s) => (
          <div key={s.label} style={{
            display: "flex", alignItems: "center", gap: 8,
            padding: "8px 16px", borderRadius: 8, background: s.bg,
            fontSize: 13, fontWeight: 600, color: s.color,
          }}>
            <span style={{ fontSize: 20, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{s.count}</span>
            <span style={{ fontSize: 12.5 }}>{s.label}</span>
          </div>
        ))}
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#9AA4B2" }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#16A34A", display: "inline-block", animation: "pulse-dot 2s ease-in-out infinite" }} />
          실시간 모니터링 중
        </div>
      </div>

      {/* Equipment Grid — 3 columns */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
        {EQUIPMENT.map((eq) => <EquipCard key={eq.id} eq={eq} />)}
      </div>

      {/* Alarm Table */}
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "12px 20px", borderBottom: "1px solid #E4E7EC", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: "#161B26" }}>경보 이력</span>
          <span style={{ fontSize: 12, color: "#9AA4B2" }}>최근 10건</span>
        </div>
        <DataTable
          columns={ALARM_COLUMNS}
          data={ALARMS}
          rowKey={(_, i) => i}
          stickyHeader
        />
      </div>

      <style>{`
        @keyframes pulse-dot {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}
