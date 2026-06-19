"use client";

import { getQualityColor, getQualityBadgeVariant } from "@/lib/utils";
import { Badge } from "@/components/ui/Badge";
import { QUALITY_THRESHOLDS } from "@/lib/constants";

interface QualityScoreGaugeProps {
  score: number;
  maxScore?: number;
}

const LABELS: Record<string, string> = {
  success: "우수",
  info: "양호",
  warning: "보통",
  danger: "주의",
};

export function QualityScoreGauge({
  score,
  maxScore = 100,
}: QualityScoreGaugeProps) {
  const pct = Math.min((score / maxScore) * 100, 100);
  const variant = getQualityBadgeVariant(score);
  const colorClass = getQualityColor(score);

  const trackColor =
    variant === "success"
      ? "#16a34a"
      : variant === "info"
      ? "#2563eb"
      : variant === "warning"
      ? "#ca8a04"
      : "#dc2626";

  return (
    <div className="flex flex-col items-center gap-3">
      {/* 원형 진행 표시 */}
      <div className="relative h-32 w-32">
        <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
          {/* 배경 트랙 */}
          <circle
            cx="60"
            cy="60"
            r="50"
            fill="none"
            stroke="#e5e7eb"
            strokeWidth="12"
          />
          {/* 진행 트랙 */}
          <circle
            cx="60"
            cy="60"
            r="50"
            fill="none"
            stroke={trackColor}
            strokeWidth="12"
            strokeDasharray={`${(pct / 100) * 314.16} 314.16`}
            strokeLinecap="round"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={`text-2xl font-bold ${colorClass}`}>
            {score.toFixed(1)}
          </span>
          <span className="text-xs text-gray-500">/ {maxScore}</span>
        </div>
      </div>

      <Badge variant={variant}>{LABELS[variant]}</Badge>

      {/* 임계값 범례 */}
      <div className="grid grid-cols-3 gap-2 text-center text-xs text-gray-500">
        <div>
          <span className="font-medium text-green-600">우수</span>
          <br />
          {QUALITY_THRESHOLDS.excellent}+
        </div>
        <div>
          <span className="font-medium text-blue-600">양호</span>
          <br />
          {QUALITY_THRESHOLDS.good}+
        </div>
        <div>
          <span className="font-medium text-yellow-600">보통</span>
          <br />
          {QUALITY_THRESHOLDS.fair}+
        </div>
      </div>
    </div>
  );
}
