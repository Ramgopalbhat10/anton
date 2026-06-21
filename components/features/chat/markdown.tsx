"use client";

import { memo, useState, type ComponentPropsWithoutRef, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

interface MarkdownProps {
  children: string;
  className?: string;
}

const REMARK_PLUGINS = [remarkGfm];

function MarkdownImpl({ children, className }: MarkdownProps) {
  const normalized = normalizeGithubMarkdown(children);

  return (
    <div className={cn("anton-md space-y-1.5 leading-relaxed", className)}>
      <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={COMPONENTS}>
        {normalized}
      </ReactMarkdown>
    </div>
  );
}

export const Markdown = memo(MarkdownImpl);

const COMPONENTS: Components = {
  p: ({ children }) => <p>{children}</p>,
  a: ({ href, children, ...rest }) => (
    <a
      {...rest}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="underline underline-offset-2 decoration-muted-foreground/60 hover:decoration-foreground"
    >
      {children}
    </a>
  ),
  ul: ({ children }) => (
    <ul className="list-disc pl-4 space-y-0.5">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="list-decimal pl-4 space-y-0.5">{children}</ol>
  ),
  li: ({ children }) => <li className="marker:text-muted-foreground">{children}</li>,
  h1: ({ children }) => (
    <h1 className="mt-1.5 text-sm font-semibold tracking-tight">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="mt-1.5 text-xs font-semibold tracking-tight">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="mt-1.5 text-xs font-semibold tracking-tight">{children}</h3>
  ),
  h4: ({ children }) => (
    <h4 className="mt-1.5 text-xs font-semibold tracking-tight">{children}</h4>
  ),
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-border pl-2.5 text-muted-foreground">
      {children}
    </blockquote>
  ),
  img: ({ alt, ...rest }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      {...rest}
      alt={alt ?? ""}
      className="inline-block max-h-[1.2em] w-auto align-[-0.15em]"
    />
  ),
  hr: () => <hr className="border-border" />,
  table: ({ children }) => (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs border-collapse">
        {children}
      </table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border border-border px-2 py-1 font-medium bg-muted/50">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border border-border px-2 py-1 align-top">{children}</td>
  ),
  code: CodeBlock,
  pre: ({ children }) => <>{children}</>,
};

function CodeBlock({
  className,
  children,
  ...rest
}: ComponentPropsWithoutRef<"code">) {
  const match = /language-([\w-]+)/.exec(className ?? "");
  const text = asText(children);
  const isBlock = text.includes("\n") || Boolean(match);

  if (!isBlock) {
    return (
      <code
        {...rest}
        className={cn("rounded bg-secondary px-1 py-0.5 font-mono text-[0.85em]", className)}
      >
        {children}
      </code>
    );
  }

  return (
    <CodeFence language={match?.[1]} text={text.replace(/\n$/, "")} />
  );
}

function CodeFence({ language, text }: { language?: string; text: string }) {
  const [copied, setCopied] = useState(false);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // noop — clipboard is best-effort
    }
  };

  return (
    <div className="group relative rounded-md bg-card/50 font-mono text-[11px] ring-1 ring-border">
      <div className="flex items-center justify-between border-b border-border px-3 py-1 text-[10px] uppercase text-muted-foreground">
        <span>{language ?? "code"}</span>
        <button
          type="button"
          onClick={onCopy}
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label={copied ? "Copied" : "Copy code"}
        >
          {copied ? (
            <>
              <Check className="size-3" /> copied
            </>
          ) : (
            <>
              <Copy className="size-3" /> copy
            </>
          )}
        </button>
      </div>
      <pre className="overflow-x-auto p-2.5 leading-snug">
        <code>{text}</code>
      </pre>
    </div>
  );
}

function asText(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(asText).join("");
  if (typeof node === "object" && "props" in node) {
    const props = (node as { props?: { children?: ReactNode } }).props;
    return asText(props?.children);
  }
  return "";
}

function normalizeGithubMarkdown(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?(?:sub|sup)>/gi, "")
    .replace(/<summary>/gi, "")
    .replace(/<\/summary>/gi, "\n\n")
    .replace(/<\/?details>/gi, "")
    .replace(
      /(^|\n)((?:P[0-3])|(?:✅|✓|✔️?|☑️?|⚠️?|❌))\s*\n+(?=\S)/g,
      "$1$2 ",
    );
}
