"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, ChevronsUpDown, X } from "lucide-react";
import type { ContaOpcao } from "@/components/conta-select";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const MESES = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, "0"));
const selectCls =
  "h-9 w-20 cursor-pointer rounded-md border border-input bg-card px-2 text-sm tabular-nums shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export type FiltrosRazao = { ano: number; de: string; ate: string; contas: string[]; todas: boolean; ocultar: boolean };

/** Barra do Razão 360: ano, mês inicial/final, contas (várias) ou todas com movimento, e ocultar estornos (padrão: mostra, como o Diário). Só tela. */
export function Filtros({ path, contas, mesAtual, inicial }: { path: string; contas: ContaOpcao[]; mesAtual: string; inicial: FiltrosRazao }) {
  const router = useRouter();
  const [f, setF] = useState(inicial);
  const [aberto, setAberto] = useState(false);
  const porId = new Map(contas.map((c) => [c.id, c]));

  function ir(n: Partial<FiltrosRazao>) {
    const v = { ...f, ...n };
    setF(v);
    const q = new URLSearchParams({ ano: String(v.ano), de: v.de, ate: v.ate });
    if (v.todas) q.set("todas", "1");
    else if (v.contas.length) q.set("contas", v.contas.join(","));
    if (v.ocultar) q.set("ocultar", "1");
    router.push(`${path}?${q}`);
  }
  const alternar = (id: string) =>
    setF((v) => ({ ...v, contas: v.contas.includes(id) ? v.contas.filter((x) => x !== id) : [...v.contas, id] }));

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid gap-1.5">
          <span className="text-xs text-muted-foreground">Ano</span>
          <div className="flex h-9 items-center">
            <Button variant="ghost" size="icon-sm" aria-label="Ano anterior" onClick={() => ir({ ano: f.ano - 1 })}><ChevronLeft /></Button>
            <span className="w-14 text-center font-semibold tabular-nums">{f.ano}</span>
            <Button variant="ghost" size="icon-sm" aria-label="Próximo ano" onClick={() => ir({ ano: f.ano + 1 })}><ChevronRight /></Button>
          </div>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="razao-de" className="text-xs text-muted-foreground">Mês inicial</Label>
          <select id="razao-de" className={selectCls} value={f.de}
            onChange={(e) => setF((v) => ({ ...v, de: e.target.value, ate: v.ate < e.target.value ? e.target.value : v.ate }))}>
            {MESES.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="razao-ate" className="text-xs text-muted-foreground">Mês final</Label>
          <select id="razao-ate" className={selectCls} value={f.ate}
            onChange={(e) => setF((v) => ({ ...v, ate: e.target.value, de: v.de > e.target.value ? e.target.value : v.de }))}>
            {MESES.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div className="flex gap-1 border-l pl-3">
          <Button variant="ghost" onClick={() => ir({ de: "01", ate: "12" })}>Ano todo</Button>
          <Button variant="ghost" onClick={() => ir({ ano: Number(mesAtual.slice(0, 4)), de: mesAtual.slice(5, 7), ate: mesAtual.slice(5, 7) })}>
            Mês atual
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Popover open={aberto} onOpenChange={setAberto}>
          <PopoverTrigger
            render={<Button variant="outline" role="combobox" aria-expanded={aberto} disabled={f.todas} className="w-80 justify-between font-normal" />}
          >
            <span className="truncate text-muted-foreground">
              {f.contas.length ? `${f.contas.length} conta(s) selecionada(s)` : "Adicionar contas"}
            </span>
            <ChevronsUpDown className="opacity-50" />
          </PopoverTrigger>
          <PopoverContent className="w-(--anchor-width) min-w-96 p-0" align="start">
            <Command>
              <CommandInput placeholder="Buscar por código ou nome..." />
              <CommandList>
                <CommandEmpty>Nenhuma conta encontrada.</CommandEmpty>
                {contas.map((c) => (
                  <CommandItem key={c.id} value={`${c.codigo} ${c.nome}`} data-checked={f.contas.includes(c.id)} onSelect={() => alternar(c.id)}>
                    <span className="tabular-nums text-muted-foreground">{c.codigo}</span>
                    <span className="truncate">{c.nome}</span>
                  </CommandItem>
                ))}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <Checkbox checked={f.todas} onCheckedChange={(todas) => setF((v) => ({ ...v, todas }))} />
          Todas as contas com movimento no período
        </label>
        <label className="flex cursor-pointer items-center gap-2 text-sm"
          title="Esconde os lançamentos estornados e seus estornos. Marcado, a impressão também sai sem eles.">
          <Checkbox checked={f.ocultar} onCheckedChange={(ocultar) => ir({ ocultar })} />
          Ocultar estornos
        </label>
        <Button className="ml-auto" onClick={() => ir({})}>Aplicar</Button>
      </div>

      {!f.todas && f.contas.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {f.contas.map((id) => {
            const c = porId.get(id);
            return (
              <span key={id} className="inline-flex max-w-72 items-center gap-1 rounded-md border bg-muted py-0.5 pr-0.5 pl-2 text-xs">
                <span className="truncate"><span className="tabular-nums text-muted-foreground">{c?.codigo}</span> {c?.nome ?? "Conta"}</span>
                <button type="button" aria-label={`Remover ${c?.nome ?? "conta"}`} onClick={() => alternar(id)}
                  className="rounded p-0.5 text-muted-foreground hover:bg-background hover:text-foreground">
                  <X className="size-3" />
                </button>
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
