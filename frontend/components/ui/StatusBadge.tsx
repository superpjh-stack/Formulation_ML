import React from "react";

type BadgeVariant = "green" | "amber" | "red" | "blue" | "violet" | "gray";

interface StatusBadgeProps {
  variant: BadgeVariant;
  label: string;
  dot?: boolean;
  className?: string;
}

/**
 * 배지 색은 **`globals.css` 의 `--badge-*` 변수가 정본**이다.
 * 폴백 HEX 는 그 변수의 현재 값과 같으며, CSS 가 없는 환경(스냅샷 등)에서만 쓰인다.
 *
 * 이전 구현은 같은 값을 여기 한 번 더 하드코딩했고, **점(dot)만 스톡 Tailwind 팔레트**
 * (`#16A34A`·`#2563EB` 등)를 따로 써서 같은 배지 안에서 글자색과 점 색이 어긋났다.
 * `StatusBadge` 는 44화면 중 27곳이 쓰는 최다 채택 컴포넌트라 토큰 밖 색의 파급이
 * 가장 컸다 (QA3 DEF-N-01). 점은 글자색과 같은 토큰을 쓴다.
 */
const VARIANT_STYLES: Record<BadgeVariant, { color: string; bg: string }> = {
  green:  { color: "var(--badge-green-text, #15803D)",  bg: "var(--badge-green-bg, #ECFDF3)" },
  amber:  { color: "var(--badge-amber-text, #B45309)",  bg: "var(--badge-amber-bg, #FEF6E7)" },
  red:    { color: "var(--badge-red-text, #B91C1C)",    bg: "var(--badge-red-bg, #FEF1F2)" },
  blue:   { color: "var(--badge-blue-text, #1D4ED8)",   bg: "var(--badge-blue-bg, #EEF1FD)" },
  violet: { color: "var(--badge-violet-text, #6D28D9)", bg: "var(--badge-violet-bg, #F5F1FE)" },
  gray:   { color: "var(--badge-gray-text, #5B6573)",   bg: "var(--badge-gray-bg, #F2F4F7)" },
};

/** 점은 **글자색과 같은 토큰**을 쓴다 — 별도 팔레트를 두지 않는다 */
const DOT_COLORS: Record<BadgeVariant, string> = Object.fromEntries(
  (Object.keys(VARIANT_STYLES) as BadgeVariant[]).map((v) => [v, VARIANT_STYLES[v].color])
) as Record<BadgeVariant, string>;

export function StatusBadge({ variant, label, dot = false, className }: StatusBadgeProps) {
  const { color, bg } = VARIANT_STYLES[variant];
  return (
    <span
      className={className}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "2px 8px",
        borderRadius: 20,
        fontSize: 11.5,
        fontWeight: 600,
        color,
        background: bg,
        lineHeight: "18px",
        whiteSpace: "nowrap",
      }}
    >
      {dot && (
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: DOT_COLORS[variant],
            flexShrink: 0,
          }}
        />
      )}
      {label}
    </span>
  );
}
