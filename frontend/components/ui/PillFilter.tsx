"use client";

import React from "react";
import { T } from "./tokens";

/**
 * PillFilter — 필터 칩 그룹.
 *
 * 17개 화면이 각자 복붙하고 있는 아래 패턴을 대체한다.
 *   padding:"4px 12px", borderRadius:20, border:"1px solid",
 *   borderColor: active ? "#3A5BD9" : "#E4E7EC",
 *   background:  active ? "#3A5BD9" : "#fff",
 *   color:       active ? "#fff"    : "#687182"
 *
 * 관측된 변형을 props 로 흡수한다.
 *   - 크기 3종: 4px 10px / 4px 12px / 5px 14px  → `size="sm"|"md"|"lg"`
 *   - 모양 3종: radius 20 / 8 / 6              → `shape="pill"|"rounded"|"square"`
 *   - 개수 표기: `전체 (12)` (master/code)      → `showCount` + `countStyle`
 *   - 앞 라벨:  `코드유형:` (master/code, system/logs) → `label`
 *   - 등폭 글꼴: 코드값 칩 (master/code)        → 옵션의 `mono`
 */

export interface PillFilterOption<V extends string = string> {
  /** 상태로 저장되는 값 */
  value: V;
  /** 화면에 찍히는 문자열. 생략하면 value 를 그대로 쓴다 */
  label?: string;
  /** 이 항목의 건수. `showCount` 가 켜져 있을 때만 표시된다 */
  count?: number;
  /** 개별 항목 비활성화 */
  disabled?: boolean;
  /** 등폭 글꼴로 렌더 (코드값 칩) */
  mono?: boolean;
}

/** 문자열 배열도, 객체 배열도 그대로 받는다 */
export type PillFilterItem<V extends string = string> = V | PillFilterOption<V>;

export interface PillFilterProps<V extends string = string> {
  /** 칩 목록. `["전체","합격","불합격"]` 또는 `[{value:"전체",count:12}, ...]` */
  options: readonly PillFilterItem<V>[];
  /** 현재 선택된 값 (controlled) */
  value: V;
  /** 선택 변경 콜백 */
  onChange: (value: V) => void;
  /** 그룹 앞에 붙는 라벨. 예: `"카테고리:"` */
  label?: string;
  /** 칩 크기. sm=4px 10px/11.5px · md=4px 12px/12px · lg=5px 14px/12.5px */
  size?: "sm" | "md" | "lg";
  /** 칩 모양. pill=radius 20 · rounded=radius 8 · square=radius 6 */
  shape?: "pill" | "rounded" | "square";
  /** 항목별 건수 표시 여부. `option.count` 가 있는 항목에만 적용된다 */
  showCount?: boolean;
  /** 건수 표기 방식. paren=`전체 (12)` · badge=별도 배지 pill */
  countStyle?: "paren" | "badge";
  /** 칩 사이 간격(px) */
  gap?: number;
  /** 줄바꿈 허용 여부 */
  wrap?: boolean;
  /** 그룹 전체 비활성화 */
  disabled?: boolean;
  /** 스크린리더용 그룹 이름. 생략하면 `label` 을 쓴다 */
  ariaLabel?: string;
  className?: string;
  /** 래퍼에 덧붙일 스타일 (marginLeft:"auto" 등 배치 용도) */
  style?: React.CSSProperties;
}

const SIZE_STYLES: Record<
  NonNullable<PillFilterProps["size"]>,
  { padding: string; fontSize: number }
> = {
  sm: { padding: "4px 10px", fontSize: 11.5 },
  md: { padding: "4px 12px", fontSize: 12 },
  lg: { padding: "5px 14px", fontSize: 12.5 },
};

const SHAPE_RADIUS: Record<NonNullable<PillFilterProps["shape"]>, number> = {
  pill: 20,
  rounded: 8,
  square: 6,
};

function normalize<V extends string>(item: PillFilterItem<V>): PillFilterOption<V> {
  return typeof item === "string" ? { value: item } : item;
}

export function PillFilter<V extends string = string>({
  options,
  value,
  onChange,
  label,
  size = "md",
  shape = "pill",
  showCount = false,
  countStyle = "paren",
  gap = 6,
  wrap = true,
  disabled = false,
  ariaLabel,
  className,
  style,
}: PillFilterProps<V>) {
  const sz = SIZE_STYLES[size];
  const radius = SHAPE_RADIUS[shape];

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel ?? label}
      className={className}
      style={{
        display: "flex",
        alignItems: "center",
        gap,
        flexWrap: wrap ? "wrap" : "nowrap",
        ...style,
      }}
    >
      {label && (
        <span
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: T.textSub,
            marginRight: 4,
            whiteSpace: "nowrap",
          }}
        >
          {label}
        </span>
      )}

      {options.map((item) => {
        const opt = normalize(item);
        const active = opt.value === value;
        const isDisabled = disabled || opt.disabled === true;
        const text = opt.label ?? opt.value;
        const hasCount = showCount && typeof opt.count === "number";

        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={isDisabled}
            onClick={() => onChange(opt.value)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              padding: sz.padding,
              fontSize: sz.fontSize,
              fontWeight: 600,
              fontFamily: opt.mono ? "monospace" : "inherit",
              lineHeight: 1.4,
              borderRadius: radius,
              border: "1px solid",
              borderColor: active ? T.primary : T.border,
              background: active ? T.primary : T.surface,
              color: active ? "#fff" : T.textSub,
              cursor: isDisabled ? "not-allowed" : "pointer",
              opacity: isDisabled ? 0.5 : 1,
              transition: "background 0.12s, border-color 0.12s, color 0.12s",
              whiteSpace: "nowrap",
            }}
          >
            {hasCount && countStyle === "paren" ? `${text} (${opt.count})` : text}
            {hasCount && countStyle === "badge" && (
              <span
                style={{
                  display: "inline-block",
                  minWidth: 16,
                  padding: "0 5px",
                  borderRadius: 20,
                  fontSize: sz.fontSize - 1,
                  fontWeight: 700,
                  lineHeight: "16px",
                  textAlign: "center",
                  fontVariantNumeric: "tabular-nums",
                  background: active ? "rgba(255,255,255,0.22)" : "#F2F4F7",
                  color: active ? "#fff" : T.textSub,
                }}
              >
                {opt.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
