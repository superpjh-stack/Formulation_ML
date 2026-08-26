"use client";

import Link from "next/link";
import { Spinner } from "@/components/ui/Spinner";
import { ErrorAlert } from "@/components/ui/ErrorAlert";
import { T } from "@/components/ui/tokens";

/**
 * 전면(全面) 상태 화면 — 로딩 · 오류 · 404 · 빈 데이터가 같은 골격을 쓴다.
 *
 * 화면 하나가 통째로 한 상태에 있을 때만 쓴다. 카드 하나가 로딩 중이라면
 * 이걸 쓰지 말고 그 카드 안에서 `<Spinner />` 를 돌려라 (specs/design-standards.md §3).
 */

export type StatusTone = "loading" | "error" | "empty";

export interface StatusScreenAction {
  label: string;
  /** href 를 주면 링크, onClick 을 주면 버튼 */
  href?: string;
  onClick?: () => void;
  primary?: boolean;
}

interface StatusScreenProps {
  tone: StatusTone;
  title: string;
  detail?: string;
  /** 오류 코드·digest 등 관리자에게 전달할 식별자 */
  code?: string;
  actions?: StatusScreenAction[];
  /** 계약 출처 표기 (오류 화면에서만) */
  source?: string;
}

export function StatusScreen({
  tone,
  title,
  detail,
  code,
  actions = [],
  source,
}: StatusScreenProps) {
  return (
    <div
      role={tone === "error" ? "alert" : undefined}
      aria-busy={tone === "loading" || undefined}
      style={{
        minHeight: 420,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 16,
        padding: "48px 24px",
        textAlign: "center",
      }}
    >
      {tone === "loading" ? (
        <Spinner size="lg" />
      ) : (
        <StatusGlyph tone={tone} />
      )}

      <div style={{ maxWidth: 520 }}>
        <h2
          style={{
            fontSize: 16,
            fontWeight: 600,
            color: T.text,
            margin: 0,
            lineHeight: 1.4,
          }}
        >
          {title}
        </h2>
        {detail && (
          <p
            style={{
              fontSize: 13,
              fontWeight: 400,
              color: T.textSub,
              margin: "8px 0 0",
              lineHeight: 1.6,
            }}
          >
            {detail}
          </p>
        )}
      </div>

      {code && (
        <div style={{ width: "100%", maxWidth: 520 }}>
          <ErrorAlert message={code} />
        </div>
      )}

      {actions.length > 0 && (
        <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
          {actions.map((a) =>
            a.href ? (
              <Link key={a.label} href={a.href} className={a.primary ? "btn pri" : "btn"}>
                {a.label}
              </Link>
            ) : (
              <button
                key={a.label}
                type="button"
                onClick={a.onClick}
                className={a.primary ? "btn pri" : "btn"}
              >
                {a.label}
              </button>
            )
          )}
        </div>
      )}

      {source && (
        <p style={{ fontSize: 11, fontWeight: 400, color: T.textMuted, margin: 0 }}>
          {source}
        </p>
      )}
    </div>
  );
}

function StatusGlyph({ tone }: { tone: Exclude<StatusTone, "loading"> }) {
  const color = tone === "error" ? T.error : T.textMuted;
  return (
    <span
      aria-hidden="true"
      style={{
        width: 48,
        height: 48,
        borderRadius: "50%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: T.surfaceSubtle,
        border: `1px solid ${T.border}`,
      }}
    >
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="9" stroke={color} strokeWidth="1.6" />
        {tone === "error" ? (
          <>
            <path d="M12 7.5v5.5" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
            <circle cx="12" cy="16.4" r="1" fill={color} />
          </>
        ) : (
          <path
            d="M8.5 12h7"
            stroke={color}
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        )}
      </svg>
    </span>
  );
}
