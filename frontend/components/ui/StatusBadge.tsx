import React from "react";

type BadgeVariant = "green" | "amber" | "red" | "blue" | "violet" | "gray";

interface StatusBadgeProps {
  variant: BadgeVariant;
  label: string;
  dot?: boolean;
  className?: string;
}

const VARIANT_STYLES: Record<BadgeVariant, { color: string; bg: string }> = {
  green:  { color: "#15803D", bg: "#ECFDF3" },
  amber:  { color: "#B45309", bg: "#FEF6E7" },
  red:    { color: "#B91C1C", bg: "#FEF1F2" },
  blue:   { color: "#1D4ED8", bg: "#EEF1FD" },
  violet: { color: "#6D28D9", bg: "#F5F1FE" },
  gray:   { color: "#5B6573", bg: "#F2F4F7" },
};

const DOT_COLORS: Record<BadgeVariant, string> = {
  green:  "#16A34A",
  amber:  "#D97706",
  red:    "#DC2626",
  blue:   "#2563EB",
  violet: "#7C3AED",
  gray:   "#6B7280",
};

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
