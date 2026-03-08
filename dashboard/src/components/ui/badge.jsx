import * as React from "react";
import { cva } from "class-variance-authority";
import { cn } from "../../lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default: "border-transparent bg-zinc-700 text-zinc-100 hover:bg-zinc-700/80",
        secondary: "border-transparent bg-zinc-800 text-zinc-300 hover:bg-zinc-800/80",
        destructive: "border-transparent bg-red-500/20 text-red-400 border-red-500/30 hover:bg-red-500/30",
        success: "border-transparent bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
        warning: "border-transparent bg-amber-500/20 text-amber-400 border-amber-500/30",
        outline: "text-zinc-300 border-zinc-700",
        clean: "border-sky-500/30 bg-sky-500/10 text-sky-400",
        blocked: "border-red-500/30 bg-red-500/10 text-red-400",
        escalated: "border-amber-500/30 bg-amber-500/10 text-amber-400",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

function Badge({ className, variant, ...props }) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
