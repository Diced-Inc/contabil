"use client";

import { useMemo, useState } from "react";
import { cn } from "cn";
import type { MapeamentoSalvo } from "@/actions/bancos";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { parseCsv, type DeteccaoCsv, type FormatoData } from "@/lib/csv";
import { fmtData, fmtValor } from "@/lib/format";

export const selectCls =
  "h-9 w-full cursor-pointer rounded-md border border-input bg-card px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

const PAPEIS = { ignorar: "Ignorar", data: "Data", historico: "Histórico", valor: "Valor", debito: "Débito", credito: "Crédito", saldo: "Saldo" } as const;
type Papel = keyof typeof PAPEIS;
const UNICOS = ["data", "valor", "debito", "credito", "saldo"] as const;
const FORMATOS: Record<FormatoData, string> = { DMY: "DD/MM/AAAA", YMD: "AAAA-MM-DD", MDY: "MM/DD/AAAA" };

function papelDe(m: MapeamentoSalvo, i: number): Papel {
  for (const p of UNICOS) if (m[p] === i) return p;
  return m.historico.includes(i) ? "historico" : "ignorar";
}

function comPapel(m: MapeamentoSalvo, i: number, p: Papel): MapeamentoSalvo {
  const n: MapeamentoSalvo = { ...m, historico: m.historico.filter((h) => h !== i) };
  if (n.data === i) n.data = -1;
  for (const u of ["valor", "debito", "credito", "saldo"] as const) if (n[u] === i) n[u] = undefined;
  if (p === "historico") n.historico = [...n.historico, i].sort((a, b) => a - b);
  else if (p !== "ignorar") n[p] = i; // o papel sai da coluna que o tinha antes
  return n;
}

export function valorCls(v: string | number) {
  return Number(v) < 0 ? "text-destructive" : "text-emerald-600 dark:text-emerald-400";
}

export function MapeamentoCsvPasso({ nome, bytes, deteccao, inicial, onConfirmar, onPular }: {
  nome: string;
  bytes: Uint8Array;
  deteccao: DeteccaoCsv;
  inicial: MapeamentoSalvo;
  onConfirmar: (m: MapeamentoSalvo, salvar: boolean) => void;
  onPular: () => void;
}) {
  const [m, setM] = useState(inicial);
  const [salvar, setSalvar] = useState(true);
  const previa = useMemo(() => {
    if (m.data < 0) return { erro: "Escolha a coluna de data." };
    try {
      return parseCsv(bytes, m);
    } catch (e) {
      return { erro: (e as Error).message + "." };
    }
  }, [bytes, m]);
  const n = "erro" in previa ? 0 : previa.transacoes.length;

  return (
    <div className="grid gap-4">
      <div>
        <div className="font-medium">{nome}</div>
        <div className="text-xs text-muted-foreground">Indique o papel de cada coluna. Linhas sem data ou valor válidos (saldo anterior, totais) são ignoradas.</div>
      </div>
      <div className="max-h-72 overflow-auto rounded-md border">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-card">
            <tr>
              {deteccao.colunas.map((c, i) => (
                <th key={i} className="min-w-32 border-b p-2 text-left align-top font-normal">
                  <select
                    aria-label={`Papel da coluna ${c}`}
                    value={papelDe(m, i)}
                    onChange={(e) => setM(comPapel(m, i, e.target.value as Papel))}
                    className={cn(selectCls, "h-8 text-xs", papelDe(m, i) !== "ignorar" && "border-primary")}
                  >
                    {Object.entries(PAPEIS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                  <div className="mt-1.5 truncate font-semibold text-foreground">{c}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {deteccao.amostra.map((r, j) => (
              <tr key={j} className="border-b last:border-0">
                {r.map((c, i) => (
                  <td key={i} className={cn("max-w-56 truncate p-2", papelDe(m, i) === "ignorar" && "text-muted-foreground/60")}>{c}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
        <div className="grid w-44 gap-2">
          <Label htmlFor="formatoData">Formato da data</Label>
          <select id="formatoData" value={m.formatoData} onChange={(e) => setM({ ...m, formatoData: e.target.value as FormatoData })} className={selectCls}>
            {Object.entries(FORMATOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <Label className="h-9 cursor-pointer gap-2 font-normal">
          <Checkbox checked={!!m.sinalInvertido} onCheckedChange={(v) => setM({ ...m, sinalInvertido: v })} />
          Inverter sinal
        </Label>
        <Label className="h-9 cursor-pointer gap-2 font-normal">
          <Checkbox checked={salvar} onCheckedChange={setSalvar} />
          Salvar mapeamento para esta conta
        </Label>
      </div>
      <div className="grid gap-2">
        <div className="text-xs font-medium text-muted-foreground">
          Prévia{"erro" in previa ? "" : `: ${n} ${n === 1 ? "linha reconhecida" : "linhas reconhecidas"}`}
        </div>
        {"erro" in previa ? (
          <div className="text-sm text-destructive">{previa.erro}</div>
        ) : n === 0 ? (
          <div className="text-sm text-destructive">Nenhuma linha com data e valor válidos. Confira as colunas e o formato da data.</div>
        ) : (
          <table className="w-full text-sm">
            <tbody>
              {previa.transacoes.slice(0, 5).map((t, i) => (
                <tr key={i} className="border-b last:border-0">
                  <td className="w-24 py-1.5 pr-3 tabular-nums">{fmtData(t.data)}</td>
                  <td className="max-w-0 truncate py-1.5 pr-3">{t.memo || <span className="text-muted-foreground">(sem histórico)</span>}</td>
                  <td className={cn("w-32 py-1.5 text-right tabular-nums", valorCls(t.valor))}>{fmtValor(t.valor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onPular}>Pular arquivo</Button>
        <Button onClick={() => onConfirmar(m, salvar)} disabled={n === 0}>
          Importar {n} {n === 1 ? "linha" : "linhas"}
        </Button>
      </div>
    </div>
  );
}
