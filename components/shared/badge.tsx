import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

export const badgeVariants = cva(
  "inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide transition-colors",
  {
    variants: {
      variant: {
        default: "bg-secondary text-secondary-foreground ring-1 ring-border",
        success:
          "bg-success/10 text-success ring-1 ring-success/30",
        warning:
          "bg-warning/10 text-warning ring-1 ring-warning/30",
        destructive:
          "bg-destructive/10 text-destructive ring-1 ring-destructive/30",
        info: "bg-info/10 text-info ring-1 ring-info/30",
        outline: "bg-transparent text-muted-foreground ring-1 ring-border",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export function Badge({
  className,
  variant,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return (
    <span
      data-slot="badge"
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  );
}
