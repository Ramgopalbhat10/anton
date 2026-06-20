"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

const DISCLOSURE_ANIMATION =
  "overflow-hidden transition-[max-height,opacity] ease-in-out motion-reduce:transition-none";

type DisclosureChildren = ReactNode | ((state: { open: boolean }) => ReactNode);

export function Disclosure({
  className,
  defaultOpen = false,
  forceOpen = false,
  disabled = false,
  lazyMount = false,
  trigger,
  children,
}: {
  className?: string;
  defaultOpen?: boolean;
  forceOpen?: boolean;
  disabled?: boolean;
  lazyMount?: boolean;
  trigger: (state: { open: boolean }) => ReactNode;
  children: DisclosureChildren;
}) {
  const id = useId();
  const contentRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(defaultOpen);
  const effectiveOpen = forceOpen || open;
  const renderContent = !lazyMount || effectiveOpen;
  const renderedChildren = renderContent
    ? typeof children === "function"
      ? children({ open: effectiveOpen })
      : children
    : null;

  useEffect(() => {
    if (!renderContent) return;

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
  }, [renderContent]);

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
          effectiveOpen ? "opacity-100 duration-100" : "opacity-0 duration-300",
        )}
        style={{
          maxHeight: effectiveOpen ? "var(--disclosure-height, 0px)" : "0px",
        }}
      >
        <div ref={contentRef}>{renderedChildren}</div>
      </div>
    </div>
  );
}
