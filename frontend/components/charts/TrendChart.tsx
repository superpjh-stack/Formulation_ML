"use client";

// ── TrendChart — 대시보드 공용 캔버스 차트 ────────────────────────────────────
// 10개 페이지가 각자 복제하던 canvas 라인/막대 차트를 하나로 수렴시킨 컴포넌트.
// 공통분모: DPR 스케일링 · 그리드 + Y 눈금 · 점선 기준선 · 그라디언트 영역 채움 ·
//           quadratic-curve 라인 · 포인트 도트 · X 카테고리 라벨.
// 색상은 SF-TD3 §1.1 토큰(가능하면 globals.css 변수)만 쓴다. tokens.ts 참고.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  readChartTokens,
  resolveColor,
  seriesPalette,
  toRgba,
  type ChartColor,
  type ChartTokens,
} from "./tokens";

export type TrendChartKind = "line" | "bar";

/** 데이터 포인트 도트 표시 규칙. auto = 12개 이하면 전부, 초과하면 균등 샘플링 + 마지막. */
export type TrendChartDots = "all" | "last" | "none" | "auto";

export interface TrendSeries {
  /** 범례에 표시되는 이름 */
  name: string;
  /** categories 와 같은 길이의 값 배열 */
  values: number[];
  /** 토큰 이름(`"error"` 등) 권장. 미지정 시 SF-TD3 토큰 팔레트에서 순환 배정 */
  color?: ChartColor;
  /** line 전용 — 영역 그라디언트 채움. 미지정 시 시리즈 1개면 true */
  area?: boolean;
  /** line 전용 — 점선 라인 */
  dashed?: boolean;
  /** line 전용 — quadratic 곡선 보간. 기본 true (false = 직선 연결) */
  curve?: boolean;
  /** 포인트별 색상 오버라이드(막대 색 조건부 분기 등). undefined 인 원소는 시리즈 색 사용 */
  pointColors?: (ChartColor | undefined)[];
}

export interface TrendReference {
  /** 스칼라면 전 구간 가로 점선, 배열이면 카테고리별 짧은 목표 마커 */
  value: number | number[];
  /** 차트 좌상단에 붙는 라벨 */
  label?: string;
  /** 기본값 Border 토큰 */
  color?: ChartColor;
}

export interface TrendBand {
  /** 밴드 하단 값 */
  from: number;
  /** 밴드 상단 값 */
  to: number;
  /** 기본값 Error 토큰 6% */
  color?: ChartColor;
}

export interface TrendChartPadding {
  left?: number;
  right?: number;
  top?: number;
  bottom?: number;
}

export interface TrendChartProps {
  /** X축 카테고리 라벨 */
  categories: string[];
  /** 1개 이상의 시리즈 */
  series: TrendSeries[];
  /** line = 라인/영역, bar = 그룹 막대. 기본 "line" */
  kind?: TrendChartKind;
  /** 캔버스 높이 px. 기본 220 */
  height?: number;
  /** 기준선/목표선 */
  references?: TrendReference[];
  /** 값 구간 배경 밴드(임계 영역 표시) */
  bands?: TrendBand[];
  /** [min, max] 고정. 미지정 시 데이터에서 자동 산출 */
  yDomain?: [number, number];
  /** 가로 그리드 개수. 기본 4 */
  yTicks?: number;
  /** Y 눈금 문자열 변환. 미지정 시 값 범위에 따라 소수 자리 자동 */
  formatY?: (v: number) => string;
  /** X 라벨 문자열 변환 */
  formatX?: (label: string, index: number) => string;
  /** N개마다 X 라벨 표시. 미지정 시 자동 */
  xTickEvery?: number;
  /** 도트 표시 규칙. 기본 "auto" */
  dots?: TrendChartDots;
  /** false = 축·눈금·라벨 없는 스파크라인 모드. 기본 true */
  showAxis?: boolean;
  /** 가로 그리드 라인. 기본 showAxis 와 동일 */
  showGrid?: boolean;
  /** HTML 범례. 미지정 시 시리즈가 2개 이상이면 표시 */
  legend?: boolean;
  /** 여백 오버라이드 */
  padding?: TrendChartPadding;
  /** 데이터가 없을 때 표시할 문구. 기본 "데이터 없음" */
  emptyMessage?: string;
  /** 접근성 라벨 */
  ariaLabel?: string;
}

const AXIS_PADDING: Required<TrendChartPadding> = {
  left: 44,
  right: 16,
  top: 16,
  bottom: 26,
};
const BARE_PADDING: Required<TrendChartPadding> = {
  left: 0,
  right: 0,
  top: 4,
  bottom: 4,
};

function defaultFormatY(range: number): (v: number) => string {
  if (range >= 1000) return (v) => Math.round(v).toLocaleString();
  if (range >= 10) return (v) => v.toFixed(0);
  if (range >= 1) return (v) => v.toFixed(1);
  return (v) => v.toFixed(2);
}

/** 데이터에서 y 범위를 만든다. 값이 모두 같거나 1개여도 0으로 나누지 않는다. */
function computeDomain(values: number[]): [number, number] {
  if (values.length === 0) return [0, 1];
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (min === max) {
    const pad = Math.abs(min) * 0.1 || 1;
    min -= pad;
    max += pad;
  } else {
    const pad = (max - min) * 0.08;
    min -= pad;
    max += pad;
  }
  return [min, max];
}

function truncateToWidth(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string {
  if (maxWidth <= 0 || ctx.measureText(text).width <= maxWidth) return text;
  let out = text;
  while (out.length > 1 && ctx.measureText(out + "…").width > maxWidth) {
    out = out.slice(0, -1);
  }
  return out + "…";
}

export function TrendChart({
  categories,
  series,
  kind = "line",
  height = 220,
  references,
  bands,
  yDomain,
  yTicks = 4,
  formatY,
  formatX,
  xTickEvery,
  dots = "auto",
  showAxis = true,
  showGrid,
  legend,
  padding,
  emptyMessage = "데이터 없음",
  ariaLabel,
}: TrendChartProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);
  const [tokens, setTokens] = useState<ChartTokens>(readChartTokens);

  // 토큰은 마운트 후 한 번 실제 CSS 변수로 갱신한다(SSR 폴백 → 실제 값)
  useEffect(() => {
    setTokens(readChartTokens());
  }, []);

  // 컨테이너 폭 추적 — 원본 구현들은 마운트 시점 offsetWidth 만 읽어 리사이즈에서 흐려졌다
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

  const usable = useMemo(
    () => series.filter((s) => s.values.length > 0),
    [series],
  );
  const isEmpty = categories.length === 0 || usable.length === 0;

  const legendVisible = legend ?? usable.length > 1;
  const palette = useMemo(() => seriesPalette(tokens), [tokens]);
  const colorOf = useMemo(
    () => (s: TrendSeries, i: number) =>
      resolveColor(tokens, s.color) ?? palette[i % palette.length],
    [palette, tokens],
  );

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

    const base = showAxis ? AXIS_PADDING : BARE_PADDING;
    const padL = padding?.left ?? base.left;
    const padR = padding?.right ?? base.right;
    const padT = padding?.top ?? base.top;
    const padB = padding?.bottom ?? base.bottom;
    const cW = Math.max(1, W - padL - padR);
    const cH = Math.max(1, H - padT - padB);

    // ── 스케일 ────────────────────────────────────────────────────────────
    const flat = usable.flatMap((s) => s.values.filter(Number.isFinite));
    const refValues = (references ?? []).flatMap((r) =>
      Array.isArray(r.value) ? r.value : [r.value],
    );
    const bandValues = (bands ?? []).flatMap((b) => [b.from, b.to]);
    const domainSource =
      kind === "bar" ? [...flat, ...refValues, 0] : [...flat, ...refValues, ...bandValues];
    const [minV, maxV] = yDomain ?? computeDomain(domainSource);
    const span = maxV - minV || 1;
    const n = categories.length;

    const px = (i: number) => (n <= 1 ? padL + cW / 2 : padL + (i / (n - 1)) * cW);
    const py = (v: number) => padT + cH - ((v - minV) / span) * cH;
    const clampY = (y: number) => Math.max(padT, Math.min(padT + cH, y));

    const fmtY = formatY ?? defaultFormatY(span);
    const gridVisible = showGrid ?? showAxis;

    // ── 값 구간 밴드 ──────────────────────────────────────────────────────
    (bands ?? []).forEach((band) => {
      const y1 = clampY(py(Math.max(band.from, band.to)));
      const y2 = clampY(py(Math.min(band.from, band.to)));
      ctx.fillStyle = resolveColor(tokens, band.color) ?? toRgba(tokens.error, 0.06);
      ctx.fillRect(padL, y1, cW, Math.max(0, y2 - y1));
    });

    // ── 그리드 + Y 눈금 ───────────────────────────────────────────────────
    if (gridVisible) {
      const ticks = Math.max(1, yTicks);
      ctx.font = "500 10px Pretendard, system-ui, sans-serif";
      ctx.textAlign = "right";
      for (let t = 0; t <= ticks; t++) {
        const y = padT + (t / ticks) * cH;
        ctx.beginPath();
        ctx.moveTo(padL, y);
        ctx.lineTo(padL + cW, y);
        ctx.strokeStyle = tokens.grid;
        ctx.lineWidth = 1;
        ctx.stroke();
        if (showAxis && padL > 8) {
          const value = maxV - (t / ticks) * span;
          ctx.fillStyle = tokens.textMuted;
          ctx.fillText(fmtY(value), padL - 6, y + 3.5);
        }
      }
    }

    // ── 기준선 / 목표선 ───────────────────────────────────────────────────
    (references ?? []).forEach((ref) => {
      const refColor = resolveColor(tokens, ref.color) ?? tokens.border;
      ctx.save();
      ctx.strokeStyle = refColor;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      if (Array.isArray(ref.value)) {
        const slot = cW / Math.max(1, n);
        ref.value.forEach((v, i) => {
          if (!Number.isFinite(v)) return;
          const cx = n <= 1 ? padL + cW / 2 : padL + i * slot + slot / 2;
          const y = clampY(py(v));
          ctx.beginPath();
          ctx.moveTo(cx - slot * 0.35, y);
          ctx.lineTo(cx + slot * 0.35, y);
          ctx.stroke();
        });
      } else {
        const y = clampY(py(ref.value));
        ctx.beginPath();
        ctx.moveTo(padL, y);
        ctx.lineTo(padL + cW, y);
        ctx.stroke();
        if (ref.label && !legendVisible) {
          ctx.setLineDash([]);
          ctx.fillStyle = refColor;
          ctx.font = "600 9.5px Pretendard, system-ui, sans-serif";
          ctx.textAlign = "left";
          ctx.fillText(ref.label, padL + 4, Math.max(padT + 9, y - 4));
        }
      }
      ctx.restore();
    });

    // ── 시리즈 ────────────────────────────────────────────────────────────
    if (kind === "bar") {
      const slot = cW / Math.max(1, n);
      const groupW = slot * 0.66;
      const gap = usable.length > 1 ? Math.min(3, groupW * 0.08) : 0;
      const barW = Math.max(
        2,
        (groupW - gap * (usable.length - 1)) / usable.length,
      );
      const zeroY = clampY(py(Math.max(minV, Math.min(0, maxV))));

      usable.forEach((s, si) => {
        const seriesColor = colorOf(s, si);
        categories.forEach((_, i) => {
          const v = s.values[i];
          if (!Number.isFinite(v)) return;
          const cx = n <= 1 ? padL + cW / 2 : padL + i * slot + slot / 2;
          const x = cx - groupW / 2 + si * (barW + gap);
          const y = clampY(py(v));
          const top = Math.min(y, zeroY);
          const barH = Math.max(1, Math.abs(zeroY - y));
          ctx.fillStyle = resolveColor(tokens, s.pointColors?.[i]) ?? seriesColor;
          ctx.beginPath();
          ctx.roundRect(x, top, barW, barH, [3, 3, 0, 0]);
          ctx.fill();
        });
      });
    } else {
      usable.forEach((s, si) => {
        const seriesColor = colorOf(s, si);
        const pts: { x: number; y: number }[] = [];
        categories.forEach((_, i) => {
          const v = s.values[i];
          if (!Number.isFinite(v)) return;
          pts.push({ x: px(i), y: clampY(py(v)) });
        });
        if (pts.length === 0) return;

        const curve = s.curve ?? true;
        const tracePath = () => {
          ctx.beginPath();
          ctx.moveTo(pts[0].x, pts[0].y);
          for (let i = 1; i < pts.length; i++) {
            if (curve) {
              const xc = (pts[i - 1].x + pts[i].x) / 2;
              const yc = (pts[i - 1].y + pts[i].y) / 2;
              ctx.quadraticCurveTo(pts[i - 1].x, pts[i - 1].y, xc, yc);
            } else {
              ctx.lineTo(pts[i].x, pts[i].y);
            }
          }
          ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
        };

        // 영역 채움
        const areaOn = s.area ?? usable.length === 1;
        if (areaOn && pts.length > 1) {
          const grad = ctx.createLinearGradient(0, padT, 0, padT + cH);
          grad.addColorStop(0, toRgba(seriesColor, 0.19));
          grad.addColorStop(1, toRgba(seriesColor, 0));
          tracePath();
          ctx.lineTo(pts[pts.length - 1].x, padT + cH);
          ctx.lineTo(pts[0].x, padT + cH);
          ctx.closePath();
          ctx.fillStyle = grad;
          ctx.fill();
        }

        // 라인
        if (pts.length > 1) {
          ctx.save();
          if (s.dashed) ctx.setLineDash([5, 4]);
          tracePath();
          ctx.strokeStyle = seriesColor;
          ctx.lineWidth = 2;
          ctx.lineJoin = "round";
          ctx.stroke();
          ctx.restore();
        }

        // 도트
        const step =
          dots === "auto" && pts.length > 12
            ? Math.max(1, Math.floor(pts.length / 8))
            : 1;
        pts.forEach((p, i) => {
          const isLast = i === pts.length - 1;
          const show =
            dots === "all" ||
            (dots === "last" && isLast) ||
            (dots === "auto" && (i % step === 0 || isLast)) ||
            (pts.length === 1 && dots !== "none");
          if (!show) return;
          const r = 3.5;
          ctx.beginPath();
          ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
          ctx.fillStyle = resolveColor(tokens, s.pointColors?.[i]) ?? seriesColor;
          ctx.fill();
          ctx.beginPath();
          ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
          ctx.strokeStyle = tokens.surface;
          ctx.lineWidth = 1.5;
          ctx.stroke();
        });
      });
    }

    // ── X 라벨 ────────────────────────────────────────────────────────────
    if (showAxis && padB >= 16) {
      const slot = kind === "bar" ? cW / Math.max(1, n) : cW / Math.max(1, n - 1 || 1);
      const step = xTickEvery ?? (n > 12 ? Math.max(1, Math.ceil(n / 8)) : 1);
      ctx.fillStyle = tokens.textMuted;
      ctx.font = "500 10px Pretendard, system-ui, sans-serif";
      ctx.textAlign = "center";
      categories.forEach((label, i) => {
        if (i % step !== 0 && i !== n - 1) return;
        const cx =
          kind === "bar"
            ? n <= 1
              ? padL + cW / 2
              : padL + i * slot + slot / 2
            : px(i);
        const text = formatX ? formatX(label, i) : label;
        ctx.fillText(
          truncateToWidth(ctx, text, slot * 0.95),
          cx,
          padT + cH + 15,
        );
      });
    }
  }, [
    categories,
    usable,
    kind,
    height,
    width,
    references,
    bands,
    yDomain,
    yTicks,
    formatY,
    formatX,
    xTickEvery,
    dots,
    showAxis,
    showGrid,
    padding,
    tokens,
    colorOf,
    isEmpty,
    legendVisible,
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
      {legendVisible && (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 14,
            marginBottom: 8,
            fontSize: 11.5,
            color: tokens.textSub,
          }}
        >
          {usable.map((s, i) => (
            <span
              key={s.name}
              style={{ display: "inline-flex", alignItems: "center", gap: 5 }}
            >
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 2,
                  background: colorOf(s, i),
                  display: "inline-block",
                }}
              />
              {s.name}
            </span>
          ))}
          {(references ?? [])
            .filter((r) => r.label && !Array.isArray(r.value))
            .map((r) => (
              <span
                key={r.label}
                style={{ display: "inline-flex", alignItems: "center", gap: 5 }}
              >
                <span
                  style={{
                    width: 12,
                    height: 0,
                    borderTop: `2px dashed ${resolveColor(tokens, r.color) ?? tokens.border}`,
                    display: "inline-block",
                  }}
                />
                {r.label}
              </span>
            ))}
        </div>
      )}
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={ariaLabel}
        style={{ width: "100%", height, display: "block" }}
      />
    </div>
  );
}

export default TrendChart;
