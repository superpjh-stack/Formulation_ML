"use client";

import React, { useId } from "react";
import { T } from "./tokens";

/**
 * NumericField — 라벨 + 숫자 입력 + 단위.
 *
 * `mixing/collect` 의 로컬 `NumericField` 와 `process/condition` 의 `field()` 클로저가
 * 사실상 같은 컴포넌트다. 여기로 일반화한다.
 *
 * 값을 `number` 가 아니라 `string` 으로 다루는 것은 원본과 같은 의도다.
 * 사용자가 `62.` 처럼 중간 상태를 입력하는 동안 값을 잃지 않아야 하고,
 * 빈 문자열과 `0` 을 구분해야 한다. 숫자 변환은 호출부의 책임이다.
 *
 * 하드 비즈니스 룰(goal.md §2.3)의 경계값을 `min`/`max` 로 바로 꽂을 수 있다.
 *   Sn 55~70 · Ag 1~5 · Cu 0.1~1.5 · Pb 25~45 · 용해온도 200~320
 * 경계를 벗어났을 때의 표시는 `error` 로 넘긴다 (컴포넌트가 스스로 판정하지 않는다 —
 * 합계 100% 같은 교차 필드 규칙은 호출부에서만 알 수 있기 때문).
 */

export interface NumericFieldProps {
  /** 필드 라벨. 예: `"SN (주석)"` */
  label: string;
  /** 현재 값 (controlled, 문자열) */
  value: string;
  /** 값 변경 콜백. input 의 raw 문자열이 그대로 넘어온다 */
  onChange: (value: string) => void;
  /** 입력 우측 단위 표기. `null` 이면 표기하지 않는다. 기본 `"%"` */
  unit?: string | null;
  /** HTML min */
  min?: number | string;
  /** HTML max */
  max?: number | string;
  /** HTML step. 기본 `"0.01"` */
  step?: number | string;
  /** 플레이스홀더 */
  placeholder?: string;
  /** 비활성화 */
  disabled?: boolean;
  /** 읽기 전용 */
  readOnly?: boolean;
  /** 오류 메시지. 있으면 테두리가 Error 색으로 바뀌고 메시지가 아래 표시된다 */
  error?: string;
  /** 보조 설명. `error` 가 있으면 가려진다 */
  hint?: string;
  /** 라벨 우측에 붙는 부가 표기. 예: 목표값 `"목표 62.0"` */
  labelSuffix?: React.ReactNode;
  /** input 의 name */
  name?: string;
  className?: string;
  /** 래퍼에 덧붙일 스타일 */
  style?: React.CSSProperties;
}

export function NumericField({
  label,
  value,
  onChange,
  unit = "%",
  min,
  max,
  step = "0.01",
  placeholder,
  disabled = false,
  readOnly = false,
  error,
  hint,
  labelSuffix,
  name,
  className,
  style,
}: NumericFieldProps) {
  const reactId = useId();
  const inputId = `numeric-${reactId}`;
  const msgId = `${inputId}-msg`;
  const hasError = Boolean(error);
  const message = error ?? hint;

  return (
    <div
      className={className}
      style={{ display: "flex", flexDirection: "column", gap: 5, minWidth: 0, ...style }}
    >
      <label
        htmlFor={inputId}
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 6,
          fontSize: 12,
          fontWeight: 600,
          color: T.textSub,
          letterSpacing: "0.02em",
        }}
      >
        <span>{label}</span>
        {labelSuffix && (
          <span style={{ fontSize: 11, fontWeight: 500, color: T.textMuted }}>
            {labelSuffix}
          </span>
        )}
      </label>

      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <input
          id={inputId}
          name={name}
          type="number"
          inputMode="decimal"
          value={value}
          min={min}
          max={max}
          step={step}
          placeholder={placeholder}
          disabled={disabled}
          readOnly={readOnly}
          aria-invalid={hasError || undefined}
          aria-describedby={message ? msgId : undefined}
          onChange={(e) => onChange(e.target.value)}
          style={{
            flex: 1,
            minWidth: 0,
            padding: "8px 10px",
            fontSize: 13,
            fontWeight: 600,
            fontFamily: "inherit",
            color: T.text,
            border: "1px solid",
            borderColor: hasError ? T.error : T.border,
            borderRadius: 8,
            outline: "none",
            background: disabled ? "#F8F9FB" : T.surface,
            cursor: disabled ? "not-allowed" : "text",
            fontVariantNumeric: "tabular-nums",
            boxSizing: "border-box",
          }}
        />
        {unit !== null && unit !== undefined && unit !== "" && (
          <span
            aria-hidden="true"
            style={{ fontSize: 12, color: T.textMuted, minWidth: 20, flexShrink: 0 }}
          >
            {unit}
          </span>
        )}
      </div>

      {message && (
        <span
          id={msgId}
          role={hasError ? "alert" : undefined}
          style={{ fontSize: 11, color: hasError ? T.error : T.textMuted, lineHeight: 1.4 }}
        >
          {message}
        </span>
      )}
    </div>
  );
}
