import { cn } from "cn";
import { fmtValor } from "@/lib/format";

export function Valor({ v, className }: { v: string | number; className?: string }) {
  const n = Number(v);
  return (
    <span className={cn("tabular-nums text-right", n > 0 && "text-emerald-700", n < 0 && "text-red-700", className)}>
      {fmtValor(v)}
    </span>
  );
}
