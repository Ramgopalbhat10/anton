import { cn } from "@/lib/utils";

export function MetricTile({
  label,
  value,
  tone,
  className,
}: {
  label: string;
  value: React.ReactNode;
  tone?: "add" | "delete";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-md bg-card px-2 py-1 ring-1 ring-border",
        className,
      )}
    >
      <div className="text-[10px] uppercase text-muted-foreground">{label}</div>
      <div
        className={cn(
          "mt-0.5 truncate font-mono text-xs font-semibold tabular-nums",
          tone === "add" && "text-success",
          tone === "delete" && "text-destructive",
        )}
      >
        {value}
      </div>
    </div>
  );
}
