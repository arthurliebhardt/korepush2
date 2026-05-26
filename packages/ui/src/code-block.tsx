import { cn } from "./cn.js";

export function CodeBlock({
  children,
  className,
  scroll = true,
}: {
  children: string;
  className?: string;
  scroll?: boolean;
}) {
  return (
    <pre
      className={cn(
        "rounded-md bg-zinc-950 text-zinc-100 text-xs font-mono p-3 leading-relaxed",
        scroll ? "overflow-x-auto" : "whitespace-pre-wrap",
        className,
      )}
    >
      <code>{children}</code>
    </pre>
  );
}
