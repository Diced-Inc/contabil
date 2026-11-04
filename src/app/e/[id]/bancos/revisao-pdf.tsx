"use client";

import { useState } from "react";
import { cn } from "cn";
import { Plus, Trash2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { parseValor } from "@/lib/csv";
import type { ExtratoIA } from "@/lib/extrato-ia";
import { fmtData, fmtValor } from "@/lib/format";
import { valorCls } from "./mapeamento-csv";

type Linha = { id: number; data: string; memo: string; valor: string };
export type Revisada = { linhas: { data: string; memo: string; valor: string }[]; saldoFinal?: string; dataSaldo?: string };

const digitos = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "").replace(/^0+/, "");
/** Mesmo número com ou sem dígito/agência colados: um termina com o outro. */
const mesmaConta = (a: string, b: string) => a.endsWith(b) || b.endsWith(a);
const valido = (l: Linha) => /^\d{4}-\d{2}-\d{2}$/.test(l.data) && !!Number(parseValor(l.valor));

export function RevisaoPdfPasso({ nome, extracao, numeroConta, onConfirmar, onPular }: {
  nome: string;
  extracao: ExtratoIA;
  numeroConta: string | null;
  onConfirmar: (r: Revisada) => void;
  onPular: () => void;
}) {
  const [seq, setSeq] = useState(extracao.transacoes.length);
  const [linhas, setLinhas] = useState<Linha[]>(() =>
    extracao.transacoes.map((t, id) => ({ id, data: t.data, memo: t.historico, valor: fmtValor(t.valor) })),
  );
  const set = (id: number, campo: keyof Omit<Linha, "id">, v: string) =>
    setLinhas((ls) => ls.map((l) => (l.id === id ? { ...l, [campo]: v } : l)));
  const valores = linhas.map((l) => Number(parseValor(l.valor) ?? 0));
  const entradas = valores.filter((v) => v > 0).reduce((s, v) => s + v, 0);
  const saidas = valores.filter((v) => v < 0).reduce((s, v) => s + v, 0);
  const invalidas = linhas.filter((l) => !valido(l)).length;
  const lida = digitos(extracao.conta), cadastrada = digitos(numeroConta);
  const outraConta = !!lida && !!cadastrada && !mesmaConta(lida, cadastrada);

  function confirmar() {
    const datas = linhas.map((l) => l.data).sort();
    onConfirmar({
      linhas: linhas.map((l) => ({ data: l.data, memo: l.memo.trim(), valor: parseValor(l.valor)! })),
      ...(extracao.saldoFinal && { saldoFinal: extracao.saldoFinal, dataSaldo: extracao.periodo?.ate ?? datas[datas.length - 1] }),
    });
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-medium">{nome}</div>
          <div className="text-xs text-muted-foreground">
            {[extracao.banco, extracao.conta && `conta ${extracao.conta}`,
              extracao.periodo && `${fmtData(extracao.periodo.de)} a ${fmtData(extracao.periodo.ate)}`,
              extracao.saldoFinal && `saldo final ${fmtValor(extracao.saldoFinal)}`].filter(Boolean).join(" · ") || "Banco e período não identificados"}
          </div>
        </div>
        <div className="flex gap-4 text-right text-xs tabular-nums">
          <div><div className="text-muted-foreground">Linhas</div><div className="text-sm font-medium">{linhas.length}</div></div>
          <div><div className="text-muted-foreground">Entradas</div><div className={cn("text-sm font-medium", valorCls(1))}>{fmtValor(entradas)}</div></div>
          <div><div className="text-muted-foreground">Saídas</div><div className={cn("text-sm font-medium", valorCls(-1))}>{fmtValor(saidas)}</div></div>
        </div>
      </div>
      {outraConta && (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          O PDF parece ser da conta {extracao.conta}, mas a conta selecionada é {numeroConta}. Confira antes de importar.
        </div>
      )}
      <div className="text-xs text-muted-foreground">
        Extraído por IA: confira datas, sinais e valores. Saída é negativa. Duas linhas com mesma data, valor e histórico contam como repetidas; se forem movimentações diferentes, diferencie o histórico.
      </div>
      <div className="max-h-[50vh] overflow-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-card text-xs text-muted-foreground">
            <tr className="border-b">
              <th className="w-40 p-2 text-left font-medium">Data</th>
              <th className="p-2 text-left font-medium">Histórico</th>
              <th className="w-36 p-2 text-right font-medium">Valor</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => {
              const v = parseValor(l.valor);
              return (
                <tr key={l.id} className="border-b last:border-0">
                  <td className="p-1">
                    <Input type="date" aria-label="Data" value={l.data} onChange={(e) => set(l.id, "data", e.target.value)}
                      aria-invalid={!/^\d{4}-\d{2}-\d{2}$/.test(l.data)} className="h-8" />
                  </td>
                  <td className="p-1">
                    <Input aria-label="Histórico" value={l.memo} onChange={(e) => set(l.id, "memo", e.target.value)} className="h-8" />
                  </td>
                  <td className="p-1">
                    <Input aria-label="Valor" inputMode="decimal" value={l.valor} placeholder="-0,00"
                      onChange={(e) => set(l.id, "valor", e.target.value.replace(/[^\d.,()\-]/g, ""))}
                      onBlur={() => v !== null && set(l.id, "valor", fmtValor(v))}
                      aria-invalid={!Number(v)} className={cn("h-8 text-right tabular-nums", v !== null && valorCls(v))} />
                  </td>
                  <td className="p-1">
                    <Button variant="ghost" size="icon" aria-label="Remover linha" onClick={() => setLinhas((ls) => ls.filter((x) => x.id !== l.id))}>
                      <Trash2 />
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="outline" onClick={() => {
          setLinhas((ls) => [...ls, { id: seq, data: ls[ls.length - 1]?.data ?? "", memo: "", valor: "" }]);
          setSeq((n) => n + 1);
        }}>
          <Plus />
          Adicionar linha
        </Button>
        <div className="flex items-center gap-2">
          {invalidas > 0 && <span className="text-xs text-destructive">{invalidas} {invalidas === 1 ? "linha inválida" : "linhas inválidas"}</span>}
          <Button variant="outline" onClick={onPular}>Pular arquivo</Button>
          <Button onClick={confirmar} disabled={linhas.length === 0 || invalidas > 0}>
            Importar {linhas.length} {linhas.length === 1 ? "linha" : "linhas"}
          </Button>
        </div>
      </div>
    </div>
  );
}
