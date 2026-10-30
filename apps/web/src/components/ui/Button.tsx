import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "./cn";
import { Spinner } from "./Spinner";

export type ButtonVariant = "primary" | "secondary" | "outline" | "ghost" | "danger";
export type ButtonSize = "xs" | "sm" | "md" | "lg";

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-accent text-accent-fg shadow-[inset_0_1px_0_rgb(255_255_255/0.18),0_1px_2px_rgb(0_0_0/0.4)] hover:bg-accent-hover active:bg-accent disabled:bg-surface-3 disabled:text-subtle disabled:shadow-none",
  secondary: "bg-surface-3 text-fg hover:bg-[#1d2536] border border-border-strong disabled:text-subtle",
  outline: "border border-border-strong text-fg hover:border-accent-strong/60 hover:bg-surface-2 disabled:text-subtle",
  ghost: "text-muted hover:text-fg hover:bg-surface-2 disabled:text-subtle",
  danger: "border border-danger/40 bg-danger/10 text-danger hover:bg-danger/15",
};

const SIZES: Record<ButtonSize, string> = {
  xs: "h-7 gap-1.5 rounded-md px-2.5 text-xs",
  sm: "h-9 gap-2 rounded-lg px-3.5 text-sm",
  md: "h-11 gap-2 rounded-[10px] px-5 text-sm",
  lg: "h-13 gap-2.5 rounded-xl px-6 text-[15px]",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading = false, className, type = "button", disabled, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        "inline-flex select-none items-center justify-center whitespace-nowrap font-medium transition-[background-color,border-color,color,box-shadow,transform] duration-150 active:translate-y-px disabled:cursor-not-allowed disabled:active:translate-y-0",
        SIZES[size],
        VARIANTS[variant],
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner /> : null}
      {children}
    </button>
  );
});
