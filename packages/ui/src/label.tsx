import { forwardRef, type LabelHTMLAttributes } from "react";
import { cn } from "./cn.js";

export const Label = forwardRef<HTMLLabelElement, LabelHTMLAttributes<HTMLLabelElement>>(
  function Label({ className, ...props }, ref) {
    return (
      <label
        ref={ref}
        className={cn("text-sm font-medium text-zinc-900 dark:text-zinc-100", className)}
        {...props}
      />
    );
  },
);
