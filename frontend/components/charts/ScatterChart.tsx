"use client";

// ── ScatterChart — 두 연속 변수 상관 산점도 ───────────────────────────────────
// TrendChart 는 X축이 카테고리(균등 간격)라 연속 X축을 표현하지 못한다.
// /process/analysis 의 "공정 조건 vs 품질점수" 상관 분석처럼 X가 연속값이고
// 추세선(선형회귀)이 필요한 화면만 이 컴포넌트를 쓴다.
// 색상은 SF-TD3 §1.1 토큰만 사용한다(tokens.ts).

import { useEffect, useMemo, useRef, useState } from "react";
import {
  mixColors,
  readChartTokens,
  resolveColor,
  toRgba,
  type ChartColor,
  type ChartTokens,
} from "./tokens";

export interface ScatterPoint {
  x: number;
  y: number;
}

export interface ScatterChartProps {
  /** 산점도 데이터 */
  points: ScatterPoint[];
  /** X축 제목 */
  xLabel?: string;
  /** Y축 제목 */
  yLabel?: string;
  /** [min, max] 고정. 미지정 시 데이터에서 자동 */
  xDomain?: [number, number];
  /** [min, max] 고정. 미지정 시 데이터에서 자동 */
  yDomain?: [number, number];
  /** 선형회귀 추세선. 기본 true */
  trendLine?: boolean;
  /** "value" = y값 크기에 따라 Primary→Success 그라데이션, "fixed" = 단색. 기본 "value" */
  colorBy?: "value" | "fixed";
  /** colorBy="fixed" 일 때 점 색상. 토큰 이름 권장. 기본 Primary 토큰 */
  color?: ChartColor;
  /** 캔버스 높이 px. 기본 300 */
  height?: number;
  /** 가로 그리드 개수. 기본 4 */
  yTicks?: number;
  /** Y 눈금 문자열 변환 */
  formatY?: (v: number) => string;
  /** X 눈금 문자열 변환 */
  formatX?: (v: number) => string;
  /** 점 반지름. 기본 4.5 */
  pointRadius?: number;
  /** 데이터가 없을 때 표시할 문구 */
  emptyMessage?: string;
  /** 접근성 라벨 */
  ariaLabel?: string;
}

function autoDomain(values: number[]): [number, number] {
  if (values.length === 0) return [0, 1];
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (min === max) {
    const pad = Math.abs(min) * 0.1 || 1;
    min -= pad;
    max += pad;
  } else {
    const pad = (max - min) * 0.06;
    min -= pad;
    max += pad;
  }
  return [min, max];
}

function defaultFormat(range: number): (v: number) => string {
  if (range >= 1000) return (v) => Math.round(v).toLocaleString();
  if (range >= 10) return (v) => v.toFixed(0);
  if (range >= 1) return (v) => v.toFixed(1);
  return (v) => v.toFixed(2);
}

export function ScatterChart({
  points,
  xLabel,
  yLabel,
  xDomain,
  yDomain,
  trendLine = true,
  colorBy = "value",
  color,
  height = 300,
  yTicks = 4,
  formatY,
  formatX,
  pointRadius = 4.5,
  emptyMessage = "데이터 없음",
  ariaLabel,
}: ScatterChartProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);
  const [tokens, setTokens] = useState<ChartTokens>(readChartTokens);

  useEffect(() => {
    setTokens(readChartTokens());
  }, []);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => setWidth(el.clientWidth);
    update();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", update);
      return () => window.removeEventListener("resize", update);
    }
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const valid = useMemo(
    () => points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y)),
    [points],
  );
  const isEmpty = valid.length === 0;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || isEmpty || width <= 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const W = width;
    const H = height;
    canvas.width = Math.max(1, Math.round(W * dpr));
    canvas.height = Math.max(1, Math.round(H * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    const padL = yLabel ? 52 : 44;
    const padR = 16;
    const padT = 16;
    const padB = xLabel ? 38 : 24;
    const cW = Math.max(1, W - padL - padR);
    const cH = Math.max(1, H - padT - padB);

    const [minX, maxX] = xDomain ?? autoDomain(valid.map((p) => p.x));
    const [minY, maxY] = yDomain ?? autoDomain(valid.map((p) => p.y));
    const spanX = maxX - minX || 1;
    const spanY = maxY - minY || 1;

    const px = (x: number) => padL + ((x - minX) / spanX) * cW;
    const py = (y: number) => padT + cH - ((y - minY) / spanY) * cH;

    const fmtY = formatY ?? defaultFormat(spanY);
    const fmtX = formatX ?? defaultFormat(spanX);

    // 그리드 + Y 눈금
    const ticks = Math.max(1, yTicks);
    ctx.font = "500 10px Pretendard, system-ui, sans-serif";
    for (let t = 0; t <= ticks; t++) {
      const y = padT + (t / ticks) * cH;
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(padL + cW, y);
      ctx.strokeStyle = tokens.grid;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = tokens.textMuted;
      ctx.textAlign = "right";
      ctx.fillText(fmtY(maxY - (t / ticks) * spanY), padL - 6, y + 3.5);
    }

    // X 눈금 (양 끝 + 중앙)
    ctx.textAlign = "center";
    [0, 0.5, 1].forEach((r) => {
      const value = minX + r * spanX;
      ctx.fillStyle = tokens.textMuted;
      ctx.fillText(fmtX(value), px(value), padT + cH + 14);
    });

    // 선형회귀 추세선
    if (trendLine && valid.length > 1) {
      const n = valid.length;
      const mx = valid.reduce((s, p) => s + p.x, 0) / n;
      const my = valid.reduce((s, p) => s + p.y, 0) / n;
      const denom = valid.reduce((s, p) => s + (p.x - mx) ** 2, 0);
      if (denom > 0) {
        const slope = valid.reduce((s, p) => s + (p.x - mx) * (p.y - my), 0) / denom;
        const intercept = my - slope * mx;
        ctx.save();
        ctx.strokeStyle = toRgba(tokens.primary, 0.35);
        ctx.lineWidth = 1.5;
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        ctx.moveTo(px(minX), py(slope * minX + intercept));
        ctx.lineTo(px(maxX), py(slope * maxX + intercept));
        ctx.stroke();
        ctx.restore();
      }
    }

    // 점
    valid.forEach((p) => {
      const x = px(p.x);
      const y = py(p.y);
      const fill =
        colorBy === "value"
          ? mixColors(tokens.primary, tokens.success, (p.y - minY) / spanY, 0.85)
          : toRgba(resolveColor(tokens, color) ?? tokens.primary, 0.85);
      ctx.beginPath();
      ctx.arc(x, y, pointRadius, 0, Math.PI * 2);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.strokeStyle = tokens.surface;
      ctx.lineWidth = 1.2;
      ctx.stroke();
    });

    // 축 제목
    ctx.fillStyle = tokens.textSub;
    ctx.font = "500 10.5px Pretendard, system-ui, sans-serif";
    if (xLabel) {
      ctx.textAlign = "center";
      ctx.fillText(xLabel, padL + cW / 2, H - 4);
    }
    if (yLabel) {
      ctx.save();
      ctx.translate(12, padT + cH / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.textAlign = "center";
      ctx.fillText(yLabel, 0, 0);
      ctx.restore();
    }
  }, [
    valid,
    width,
    height,
    xLabel,
    yLabel,
    xDomain,
    yDomain,
    trendLine,
    colorBy,
    color,
    yTicks,
    formatY,
    formatX,
    pointRadius,
    tokens,
    isEmpty,
  ]);

  if (isEmpty) {
    return (
      <div
        ref={wrapRef}
        role="img"
        aria-label={ariaLabel ?? emptyMessage}
        style={{
          height,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 12.5,
          color: tokens.textMuted,
        }}
      >
        {emptyMessage}
      </div>
    );
  }

  return (
    <div ref={wrapRef} style={{ width: "100%" }}>
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={ariaLabel}
        style={{ width: "100%", height, display: "block" }}
      />
    </div>
  );
}

export default ScatterChart;
