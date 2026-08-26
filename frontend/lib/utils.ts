import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { QUALITY_THRESHOLDS } from "./constants";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatNumber(value: number, decimals = 2): string {
  return value.toFixed(decimals);
}

export function formatPercent(value: number, decimals = 1): string {
  return `${value.toFixed(decimals)}%`;
}

/**
 * 품질점수 → **등급** 색상 (우수/양호/보통/미흡).
 *
 * 🚨 **합격 판정에 쓰지 마라.** `QUALITY_THRESHOLDS` 에는 합격선 70 이 없어서
 * 69.9(불합격)와 70.0(합격)이 같은 색으로 그려진다 (`design-standards.md` §3.4).
 * 합격/불합격은 `lib/quality.ts` 의 `isQualityPassed()` · `qualityPassBadge()` 다.
 */
export function getQualityColor(score: number): string {
  if (score >= QUALITY_THRESHOLDS.excellent) return "text-green-600";
  if (score >= QUALITY_THRESHOLDS.good) return "text-blue-600";
  if (score >= QUALITY_THRESHOLDS.fair) return "text-yellow-600";
  return "text-red-600";
}

/**
 * 품질점수 → **등급** 배지 variant. 위 `getQualityColor()` 와 같은 축이다.
 *
 * 🚨 **합격 판정 전용 함수가 아니다.** `lib/quality.ts` 의 `qualityPassBadge()` 를 써라.
 * 두 축(등급 4값 / 합격 2값)을 한 배지에 섞지 마라 — `design-standards.md` §3.4.
 */
export function getQualityBadgeVariant(
  score: number
): "success" | "info" | "warning" | "danger" {
  if (score >= QUALITY_THRESHOLDS.excellent) return "success";
  if (score >= QUALITY_THRESHOLDS.good) return "info";
  if (score >= QUALITY_THRESHOLDS.fair) return "warning";
  return "danger";
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
