"use client";

import React, { useState } from "react";
import { T } from "./tokens";

/**
 * SearchInput — 돋보기 아이콘 + controlled 텍스트 입력.
 *
 * `AppHeader` · `master/code` · `master/workstd` · `system/logs` · `shipping/lot`
 * 5곳에 복붙돼 있는 아래 SVG 와 입력 스타일을 대체한다.
 *
 *   <svg width="13" height="13" viewBox="0 0 16 16" fill="none" style={{position:"absolute",...}}>
 *     <circle cx="7" cy="7" r="5" stroke="#9AA4B2" strokeWidth="1.5" />
 *     <path d="M11 11l3 3" stroke="#9AA4B2" strokeWidth="1.5" strokeLinecap="round" />
 *   </svg>
 *
 * 관측된 변형은 props 로 흡수한다.
 *   - 높이 3종: 32(master/code) / 34(AppHeader·system/logs) / 36(workstd·shipping/lot)
 *   - 폭 4종:   200 / 220 / 300 / 320 / "100%"
 *   - 배경 2종: #F8F9FB 고정 vs 포커스 시 #fff 전환(AppHeader)
 */

export interface SearchInputProps {
  /** 현재 검색어 (controlled) */
  value: string;
  /** 검색어 변경 콜백 */
  onChange: (value: string) => void;
  /** 플레이스홀더 */
  placeholder?: string;
  /** 입력 높이. sm=32 · md=34 · lg=36 */
  size?: "sm" | "md" | "lg";
  /** 입력 폭. 숫자는 px, 문자열은 그대로 (기본 220) */
  width?: number | string;
  /** 배경. filled=#F8F9FB → 포커스 시 흰색 · plain=항상 흰색 */
  variant?: "filled" | "plain";
  /** 값이 있을 때 우측에 지우기(×) 버튼 표시 */
  clearable?: boolean;
  /** Enter 키 입력 시 호출. 현재 값이 인자로 넘어온다 */
  onSubmit?: (value: string) => void;
  /** 비활성화 */
  disabled?: boolean;
  /** 마운트 시 포커스 */
  autoFocus?: boolean;
  /** 스크린리더용 라벨. 생략하면 placeholder 를 쓴다 */
  ariaLabel?: string;
  /** input 의 name 속성 */
  name?: string;
  className?: string;
  /** 래퍼에 덧붙일 스타일 (marginLeft:"auto", flex:1 등 배치 용도) */
  style?: React.CSSProperties;
}

const SIZE_STYLES: Record<
  NonNullable<SearchInputProps["size"]>,
  { height: number; fontSize: number; icon: number; iconLeft: number; padLeft: number; radius: number }
> = {
  sm: { height: 32, fontSize: 12, icon: 13, iconLeft: 9, padLeft: 28, radius: 7 },
  md: { height: 34, fontSize: 12.5, icon: 14, iconLeft: 10, padLeft: 32, radius: 8 },
  lg: { height: 36, fontSize: 12.5, icon: 14, iconLeft: 10, padLeft: 32, radius: 8 },
};

/** 5개 화면에 복붙돼 있던 돋보기 아이콘. 단독으로도 재사용 가능 */
export function SearchIcon({
  size = 14,
  color = T.textMuted,
  className,
  style,
}: {
  size?: number;
  color?: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      focusable="false"
      className={className}
      style={style}
    >
      <circle cx="7" cy="7" r="5" stroke={color} strokeWidth="1.5" />
      <path d="M11 11l3 3" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function SearchInput({
  value,
  onChange,
  placeholder = "검색...",
  size = "md",
  width = 220,
  variant = "filled",
  clearable = false,
  onSubmit,
  disabled = false,
  autoFocus = false,
  ariaLabel,
  name,
  className,
  style,
}: SearchInputProps) {
  const [focused, setFocused] = useState(false);
  const sz = SIZE_STYLES[size];
  const showClear = clearable && value.length > 0 && !disabled;

  const background =
    variant === "plain" ? T.surface : focused ? T.surface : T.surfaceSubtle;

  return (
    <div
      className={className}
      style={{ position: "relative", width, ...style }}
    >
      <SearchIcon
        size={sz.icon}
        style={{
          position: "absolute",
          left: sz.iconLeft,
          top: "50%",
          transform: "translateY(-50%)",
          pointerEvents: "none",
        }}
      />
      <input
        type="text"
        name={name}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        autoFocus={autoFocus}
        aria-label={ariaLabel ?? placeholder}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && onSubmit) onSubmit(value);
        }}
        style={{
          width: "100%",
          height: sz.height,
          paddingLeft: sz.padLeft,
          paddingRight: showClear ? 28 : 12,
          border: "1px solid",
          borderColor: focused ? T.primary : T.border,
          borderRadius: sz.radius,
          fontSize: sz.fontSize,
          fontFamily: "inherit",
          color: T.text,
          background,
          outline: "none",
          boxSizing: "border-box",
          transition: "border-color 0.12s, background 0.12s",
          cursor: disabled ? "not-allowed" : "text",
        }}
      />
      {showClear && (
        <button
          type="button"
          aria-label="검색어 지우기"
          onClick={() => onChange("")}
          style={{
            position: "absolute",
            right: 8,
            top: "50%",
            transform: "translateY(-50%)",
            width: 16,
            height: 16,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            border: "none",
            borderRadius: "50%",
            background: "transparent",
            color: T.textMuted,
            fontSize: 14,
            lineHeight: 1,
            cursor: "pointer",
            padding: 0,
          }}
        >
          ×
        </button>
      )}
    </div>
  );
}
