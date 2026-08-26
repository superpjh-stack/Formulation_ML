"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { T, OVERLAY_BG, MODAL_SHADOW } from "./tokens";

/**
 * Modal — fixed 오버레이 다이얼로그.
 *
 * `mixing/collect` · `data/training` · `process/condition` · `system/users`
 * 4곳이 각자 구현한 오버레이/패널/헤더/닫기버튼/푸터를 하나로 모은다.
 *
 * 손으로 짠 4개 구현에는 아래가 전부 빠져 있었다. 여기서 채운다.
 *   - ESC 로 닫기
 *   - 포커스 트랩 (Tab 순환) + 닫힐 때 이전 포커스 복원
 *   - body 스크롤 잠금
 *   - role="dialog" / aria-modal / aria-labelledby
 *   - portal 로 document.body 에 붙여 부모 stacking context 영향 제거
 *
 * 관측된 변형은 props 로 흡수한다.
 *   - 폭 3종: 420(system/users) · 460(data/training) · 520(collect·condition)
 *   - 오버레이 색 3종 → OVERLAY_BG 하나로 통일
 *   - 푸터 배경 2종: 투명 / #F8F9FB(collect) → `footerVariant`
 *   - 본문 여백: 20~28px → `bodyPadding`
 */

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface ModalProps {
  /** 열림 여부. false 면 아무것도 렌더하지 않는다 */
  open: boolean;
  /** 닫기 요청 콜백 (ESC · 오버레이 클릭 · × 버튼) */
  onClose: () => void;
  /** 헤더 제목 */
  title: React.ReactNode;
  /** 제목 아래 보조 설명 (예: 대상 LOT명·데이터셋명) */
  description?: React.ReactNode;
  /** 본문 */
  children: React.ReactNode;
  /** 푸터. 보통 취소/확인 버튼 (`className="btn"` / `"btn pri"`) */
  footer?: React.ReactNode;
  /** 패널 최대 폭(px). 기본 520 */
  width?: number;
  /** 본문 패딩 CSS 값. 기본 `"20px 24px"` */
  bodyPadding?: string;
  /** 푸터 배경. plain=흰색 · surface=#F8F9FB */
  footerVariant?: "plain" | "surface";
  /** 오버레이 클릭으로 닫기 허용 (기본 true) */
  closeOnOverlayClick?: boolean;
  /** ESC 로 닫기 허용 (기본 true) */
  closeOnEsc?: boolean;
  /** 헤더 우측 × 버튼 표시 (기본 true) */
  showCloseButton?: boolean;
  /** z-index. 기본 100 (토스트는 200을 쓰므로 그 아래) */
  zIndex?: number;
  /** 다이얼로그 패널에 붙일 클래스 */
  className?: string;
}

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  width = 520,
  bodyPadding = "20px 24px",
  footerVariant = "plain",
  closeOnOverlayClick = true,
  closeOnEsc = true,
  showCloseButton = true,
  zIndex = 100,
  className,
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const prevFocusRef = useRef<HTMLElement | null>(null);
  const [mounted, setMounted] = useState(false);
  const titleId = useRef(`modal-title-${Math.random().toString(36).slice(2, 9)}`);

  useEffect(() => {
    setMounted(true);
  }, []);

  /** body 스크롤 잠금 */
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  /** 열릴 때 첫 포커스 이동, 닫힐 때 원래 자리로 복원 */
  useEffect(() => {
    if (!open) return;
    prevFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const panel = panelRef.current;
    if (panel) {
      const first = panel.querySelector<HTMLElement>(FOCUSABLE);
      (first ?? panel).focus();
    }

    return () => {
      prevFocusRef.current?.focus();
    };
  }, [open]);

  /** ESC 닫기 + Tab 포커스 트랩 */
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape" && closeOnEsc) {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;

      const panel = panelRef.current;
      if (!panel) return;
      const nodes = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (n) => n.offsetParent !== null || n === document.activeElement
      );
      if (nodes.length === 0) {
        e.preventDefault();
        panel.focus();
        return;
      }
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const active = document.activeElement;

      if (e.shiftKey && (active === first || active === panel)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    },
    [closeOnEsc, onClose]
  );

  useEffect(() => {
    if (!open) return;
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [open, handleKeyDown]);

  if (!open || !mounted) return null;

  const overlay = (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex,
        background: OVERLAY_BG,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
      onMouseDown={(e) => {
        if (closeOnOverlayClick && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId.current}
        tabIndex={-1}
        className={className}
        style={{
          width: "100%",
          maxWidth: width,
          maxHeight: "calc(100vh - 48px)",
          display: "flex",
          flexDirection: "column",
          background: T.surface,
          borderRadius: 16,
          boxShadow: MODAL_SHADOW,
          overflow: "hidden",
          outline: "none",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "18px 24px",
            borderBottom: `1px solid ${T.border}`,
            flexShrink: 0,
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              id={titleId.current}
              style={{ fontSize: 15, fontWeight: 700, color: T.text, lineHeight: 1.4 }}
            >
              {title}
            </div>
            {description && (
              <div style={{ fontSize: 12, color: T.textSub, marginTop: 2 }}>
                {description}
              </div>
            )}
          </div>
          {showCloseButton && (
            <button
              type="button"
              aria-label="닫기"
              onClick={onClose}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                color: T.textMuted,
                fontSize: 20,
                lineHeight: 1,
                padding: 4,
                flexShrink: 0,
              }}
            >
              ×
            </button>
          )}
        </div>

        {/* Body */}
        <div style={{ padding: bodyPadding, overflowY: "auto", flex: 1, minHeight: 0 }}>
          {children}
        </div>

        {/* Footer */}
        {footer && (
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              gap: 10,
              padding: "16px 24px",
              borderTop: `1px solid ${T.border}`,
              background: footerVariant === "surface" ? "#F8F9FB" : T.surface,
              flexShrink: 0,
            }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );

  return createPortal(overlay, document.body);
}
