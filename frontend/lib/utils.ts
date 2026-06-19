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

export function getQualityColor(score: number): string {
  if (score >= QUALITY_THRESHOLDS.excellent) return "text-green-600";
  if (score >= QUALITY_THRESHOLDS.good) return "text-blue-600";
  if (score >= QUALITY_THRESHOLDS.fair) return "text-yellow-600";
  return "text-red-600";
}

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
