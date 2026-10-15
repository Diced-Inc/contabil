import type { ReactNode } from "react";
import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { hoje } from "@/lib/format";

type SP = Record<string, string | string[] | undefined>;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

export function mesAtual() {
  const h = hoje(), y = Number(h.slice(0, 4)), m = Number(h.slice(5, 7));
  return { de: h.slice(0, 8) + "01", ate: new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10) };
}
export function anoAtual() {
  const y = hoje().slice(0, 4);
  return { de: `${y}-01-01`, ate: `${y}-12-31` };
}

/** Lê `de`/`ate` dos searchParams; inválidos ou invertidos caem no padrão. */
export function lerPeriodo(sp: SP, padrao: "mes" | "ano") {
  const p = padrao === "mes" ? mesAtual() : anoAtual();
  const de = typeof sp.de === "string" && ISO.test(sp.de) ? sp.de : p.de;
  const ate = typeof sp.ate === "string" && ISO.test(sp.ate) ? sp.ate : p.ate;
  return de <= ate ? { de, ate } : p;
}

function hrefCom(path: string, sp: SP, periodo: { de: string; ate: string }) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (typeof v === "string" && k !== "de" && k !== "ate") q.set(k, v);
  q.set("de", periodo.de);
  q.set("ate", periodo.ate);
  return `${path}?${q}`;
}

/** Formulário GET de período; preserva os demais searchParams, menos os campos que `children` já posta (`proprios`). */
export function DataRange({ path, sp, de, ate, proprios = [], children }: {
  path: string; sp: SP; de: string; ate: string; proprios?: string[]; children?: ReactNode;
}) {
  return (
    <form method="GET" action={path} className="flex flex-wrap items-end gap-3">
      {Object.entries(sp).map(([k, v]) =>
        typeof v === "string" && !["de", "ate", ...proprios].includes(k) ? (
          <input key={k} type="hidden" name={k} value={v} />
        ) : null,
      )}
      {children}
      <div className="grid gap-1">
        <Label htmlFor="de">De</Label>
        <Input id="de" name="de" type="date" defaultValue={de} required className="w-40" />
      </div>
      <div className="grid gap-1">
        <Label htmlFor="ate">Até</Label>
        <Input id="ate" name="ate" type="date" defaultValue={ate} required className="w-40" />
      </div>
      <Button type="submit" size="sm">Aplicar</Button>
      <Link href={hrefCom(path, sp, mesAtual())} className={buttonVariants({ variant: "ghost", size: "sm" })}>Mês atual</Link>
      <Link href={hrefCom(path, sp, anoAtual())} className={buttonVariants({ variant: "ghost", size: "sm" })}>Ano atual</Link>
    </form>
  );
}
