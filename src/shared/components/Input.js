"use client";

import { useState } from "react";
import { cn } from "@/shared/utils/cn";
import { translate } from "@/i18n/runtime";

export default function Input({
  label,
  type = "text",
  placeholder,
  value,
  onChange,
  error,
  hint,
  icon,
  disabled = false,
  required = false,
  // Optional eye toggle for password fields: reveals the value as plain
  // text while held on. Only meaningful with type="password" — the input
  // keeps its real type otherwise.
  reveal = false,
  className,
  inputClassName,
  ...props
}) {
  const [revealed, setRevealed] = useState(false);
  const revealable = reveal && type === "password";
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {label && (
        <label className="text-sm font-medium text-text-main">
          {label}
          {required && <span className="text-red-500 ml-1">*</span>}
        </label>
      )}
      <div className="relative">
        {icon && (
          <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-text-muted">
            <span className="material-symbols-outlined text-[20px]">{icon}</span>
          </div>
        )}
        <input
          type={revealable && revealed ? "text" : type}
          placeholder={placeholder}
          value={value}
          onChange={onChange}
          disabled={disabled}
          className={cn(
            "w-full py-2.5 px-3 text-sm text-text-main bg-surface-2 rounded-[10px]",
            "border border-transparent placeholder-text-muted/70",
            "focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500/40",
            "transition-all duration-150 ease-out disabled:opacity-50 disabled:cursor-not-allowed",
            // iOS zoom fix
            "text-[16px] sm:text-sm",
            icon && "pl-10",
            revealable && "pr-11",
            error && "ring-1 ring-red-500 focus:ring-2 focus:ring-red-500/40 border-red-500/40",
            inputClassName
          )}
          {...props}
        />
        {revealable && (
          <button
            type="button"
            tabIndex={-1}
            aria-label={revealed ? translate("Hide password") : translate("Show password")}
            onClick={() => setRevealed((v) => !v)}
            className="absolute inset-y-0 right-0 flex items-center pr-3 text-text-muted hover:text-text-main transition-colors"
          >
            <span className="material-symbols-outlined text-[20px]">{revealed ? "visibility_off" : "visibility"}</span>
          </button>
        )}
      </div>
      {error && (
        <p className="text-xs text-red-500 flex items-center gap-1">
          <span className="material-symbols-outlined text-[14px]">error</span>
          {error}
        </p>
      )}
      {hint && !error && (
        <p className="text-xs text-text-muted">{hint}</p>
      )}
    </div>
  );
}
