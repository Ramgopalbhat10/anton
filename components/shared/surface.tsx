import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

export const surfaceVariants = cva("rounded-md ring-1 ring-border transition-colors", {
  variants: {
    variant: {
      elevated: "bg-card text-card-foreground",
      inset: "bg-secondary/80 text-foreground",
      ghost: "bg-background/35 text-foreground ring-border/70",
    },
    padding: {
      none: "",
      sm: "p-2",
      md: "p-3",
    },
  },
  defaultVariants: {
    variant: "elevated",
    padding: "none",
  },
});

export function Surface({
  className,
  variant,
  padding,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof surfaceVariants>) {
  return (
    <div
      data-slot="surface"
      className={cn(surfaceVariants({ variant, padding }), className)}
      {...props}
    />
  );
}
