import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <main className="flex flex-1 items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <h1 className="text-3xl font-semibold tracking-tight">Anton</h1>
        <p className="text-muted-foreground text-sm">
          A mini AI coding agent harness. Phase 0 scaffold.
        </p>
        <Button variant="outline" disabled>
          Chat UI coming in Phase 1
        </Button>
      </div>
    </main>
  );
}
