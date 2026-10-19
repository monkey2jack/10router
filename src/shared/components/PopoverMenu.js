"use client";

import PropTypes from "prop-types";
import { cn } from "@/shared/utils/cn";

/**
 * Popover + MenuItem — the dashboard's one dropdown-menu language.
 *
 * Extracted from the quota toolbar (2026-10-15) when the providers page grew a
 * connection-status filter: a native <select> (what upstream 9router ships)
 * renders with the OS chrome — white box, blue highlight, untranslated option
 * text — which is exactly the "割裂" the design avoids. Every menu here is a
 * surface-coloured rounded panel with the same item rows, so a filter on any
 * page reads as the same control.
 *
 * The backdrop is a transparent fixed button: click-away closes, and it keeps
 * the menu keyboard-reachable (Escape is left to the page; the backdrop is the
 * pointer affordance).
 */
export function Popover({ open, onClose, align = "left", className, children }) {
  if (!open) return null;
  return (
    <>
      <button type="button" className="fixed inset-0 z-30 cursor-default bg-transparent" aria-label="Close" onClick={onClose} />
      <div
        className={cn(
          "absolute z-40 mt-1.5 overflow-hidden rounded-xl border border-black/10 bg-surface/95 p-1 shadow-xl shadow-black/10 backdrop-blur dark:border-white/10",
          align === "right" ? "right-0" : "left-0",
          className,
        )}
      >
        {children}
      </div>
    </>
  );
}

Popover.propTypes = {
  open: PropTypes.bool,
  onClose: PropTypes.func.isRequired,
  align: PropTypes.oneOf(["left", "right"]),
  className: PropTypes.string,
  children: PropTypes.node,
};

export function MenuItem({ selected = false, onClick, icon, children, hint, disabled = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs transition-colors disabled:opacity-50",
        selected ? "bg-primary/10 text-primary" : "text-text hover:bg-black/[0.04] dark:hover:bg-white/[0.06]",
      )}
    >
      {icon}
      <span className="min-w-0 flex-1">
        <span className="block font-medium">{children}</span>
        {hint ? <span className="mt-0.5 block text-[11px] text-text-muted">{hint}</span> : null}
      </span>
      {selected ? <span className="material-symbols-outlined text-[16px] leading-none text-[14px]">check</span> : null}
    </button>
  );
}

MenuItem.propTypes = {
  selected: PropTypes.bool,
  onClick: PropTypes.func,
  icon: PropTypes.node,
  children: PropTypes.node,
  hint: PropTypes.node,
  disabled: PropTypes.bool,
};
