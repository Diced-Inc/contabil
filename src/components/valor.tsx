import { cn } from "cn";
import { fmtValor } from "@/lib/format";

export function Valor({ v, className }: { v: string | number; className?: string }) {
  const n = Number(v);
  return (
    <span className={cn("tabular-nums text-right", n > 0 && "text-success", n < 0 && "text-danger", className)}>
      {fmtValor(v)}
    </span>
  );
}
