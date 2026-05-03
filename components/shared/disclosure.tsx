"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

const DISCLOSURE_ANIMATION =
  "overflow-hidden transition-[max-height,opacity] duration-300 ease-in-out will-change-[max-height,opacity] motion-reduce:transition-none";

export function Disclosure({
  className,
  defaultOpen = false,
  forceOpen = false,
  disabled = false,
  trigger,
  children,
}: {
  className?: string;
  defaultOpen?: boolean;
  forceOpen?: boolean;
  disabled?: boolean;
  trigger: (state: { open: boolean }) => ReactNode;
  children: ReactNode;
}) {
  const id = useId();
  const contentRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(defaultOpen);
  const effectiveOpen = forceOpen || open;

  useEffect(() => {
    const content = contentRef.current;
    const panel = content?.parentElement;
    if (!content || !panel) return;

    const updateHeight = () => {
      panel.style.setProperty(
        "--disclosure-height",
        `${content.scrollHeight}px`,
      );
    };
    updateHeight();

    const observer = new ResizeObserver(updateHeight);
    observer.observe(content);
    window.addEventListener("resize", updateHeight);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateHeight);
    };
  }, [children]);

  if (disabled) {
    return <div className={className}>{trigger({ open: false })}</div>;
  }

  return (
    <div className={className}>
      <button
        type="button"
        className="block max-w-full cursor-pointer text-left select-none"
        aria-expanded={effectiveOpen}
        aria-controls={id}
        onClick={() => setOpen((value) => !value)}
      >
        {trigger({ open: effectiveOpen })}
      </button>
      <div
        id={id}
        className={cn(
          DISCLOSURE_ANIMATION,
          effectiveOpen ? "opacity-100" : "opacity-0",
        )}
        style={{
          maxHeight: effectiveOpen ? "var(--disclosure-height, 0px)" : "0px",
        }}
      >
        <div ref={contentRef}>{children}</div>
      </div>
    </div>
  );
}
