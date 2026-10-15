"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { CircleAlert, Plus, Save, Trash2 } from "lucide-react";
import { cn } from "cn";
import type { EstadoForm } from "@/actions/empresas";
import { ContaSelect, type ContaOpcao } from "@/components/conta-select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cents, fmtValor, fromCents, hoje, parseValorBR, valorParaInput } from "@/lib/format";

export type LancamentoInicial = {
  data: string;
  competencia: string;
  dataPagamento: string | null;
  historico: string;
  documento: string | null;
  partidas: { contaId: string; debito: string; credito: string }[];
};
type Linha = { key: number; contaId: string; debito: string; credito: string };

let seq = 0;
const novaLinha = (p?: { contaId: string; debito: string; credito: string }): Linha => ({
  key: ++seq,
  contaId: p?.contaId ?? "",
  debito: p ? valorParaInput(p.debito) : "",
  credito: p ? valorParaInput(p.credito) : "",
});
/** Centavos do input pt-BR; inválido conta como 0 (o servidor rejeita). */
const c = (s: string) => cents(parseValorBR(s) || 0) || 0;

export function FormLancamento({ action, contas, inicial, voltar }: {
  action: (prev: EstadoForm, form: FormData) => Promise<EstadoForm>;
  contas: ContaOpcao[];
  inicial?: LancamentoInicial;
  voltar: string;
}) {
  const [estado, enviar, pendente] = useActionState(action, {});
  const [linhas, setLinhas] = useState<Linha[]>(() =>
    inicial ? inicial.partidas.map(novaLinha) : [novaLinha(), novaLinha()],
  );
  const mudar = (key: number, campo: keyof Omit<Linha, "key">, v: string) =>
    setLinhas((ls) => ls.map((l) => (l.key === key ? { ...l, [campo]: v } : l)));

  const totalD = linhas.reduce((s, l) => s + c(l.debito), 0);
  const totalC = linhas.reduce((s, l) => s + c(l.credito), 0);
  const diferenca = totalD - totalC;
  const podeSalvar = linhas.length >= 2 && diferenca === 0 && totalD > 0 && !pendente;

  return (
    <form action={enviar} className="grid max-w-5xl gap-5">
      {estado.erro && (
        <Alert variant="destructive">
          <CircleAlert />
          <AlertDescription>{estado.erro}</AlertDescription>
        </Alert>
      )}
      <section className="grid gap-4 rounded-xl border bg-card p-5 shadow-card">
        <h2 className="text-sm font-semibold">Dados do lançamento</h2>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div className="grid gap-2">
            <Label htmlFor="data">Data</Label>
            <Input id="data" name="data" type="date" required defaultValue={inicial?.data ?? hoje()} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="competencia">Competência</Label>
            <Input id="competencia" name="competencia" type="month" defaultValue={inicial?.competencia.slice(0, 7)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="dataPagamento">Data de pagamento</Label>
            <Input id="dataPagamento" name="dataPagamento" type="date" defaultValue={inicial?.dataPagamento ?? ""} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="documento">Documento</Label>
            <Input id="documento" name="documento" defaultValue={inicial?.documento ?? ""} />
          </div>
        </div>
        <p className="-mt-2 text-xs text-muted-foreground">Competência em branco: mês da data.</p>
        <div className="grid gap-2">
          <Label htmlFor="historico">Histórico</Label>
          <Input id="historico" name="historico" required minLength={3} defaultValue={inicial?.historico} />
        </div>
      </section>

      <section className="overflow-hidden rounded-xl border bg-card shadow-card">
        <div className="border-b px-5 py-3.5">
          <h2 className="text-sm font-semibold">Partidas</h2>
          <p className="text-xs text-muted-foreground">Débitos e créditos precisam fechar. Mínimo de duas partidas.</p>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Conta</TableHead>
              <TableHead className="w-40 text-right">Débito</TableHead>
              <TableHead className="w-40 text-right">Crédito</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {linhas.map((l, i) => (
              <TableRow key={l.key}>
                <TableCell className="py-2">
                  <ContaSelect
                    contas={contas}
                    name={`partidas[${i}].contaId`}
                    value={l.contaId}
                    onChange={(v) => mudar(l.key, "contaId", v)}
                  />
                </TableCell>
                {(["debito", "credito"] as const).map((campo) => (
                  <TableCell key={campo} className="py-1">
                    <Input
                      name={`partidas[${i}].${campo}`}
                      inputMode="decimal"
                      autoComplete="off"
                      placeholder="0,00"
                      className="text-right tabular-nums"
                      aria-label={campo === "debito" ? "Débito" : "Crédito"}
                      value={l[campo]}
                      onChange={(e) => mudar(l.key, campo, e.target.value)}
                    />
                  </TableCell>
                ))}
                <TableCell className="py-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    title="Remover partida"
                    aria-label="Remover partida"
                    onClick={() => setLinhas((ls) => ls.filter((x) => x.key !== l.key))}
                  >
                    <Trash2 />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell>
                <Button type="button" variant="outline" size="sm" onClick={() => setLinhas((ls) => [...ls, novaLinha()])}>
                  <Plus />
                  Adicionar partida
                </Button>
              </TableCell>
              <TableCell className="text-right tabular-nums">{fmtValor(fromCents(totalD))}</TableCell>
              <TableCell className="text-right tabular-nums">{fmtValor(fromCents(totalC))}</TableCell>
              <TableCell />
            </TableRow>
            <TableRow>
              <TableCell className="text-right text-muted-foreground">Diferença (D − C)</TableCell>
              <TableCell colSpan={2} className={cn("text-right tabular-nums font-semibold", diferenca !== 0 ? "text-danger" : "text-success")}>
                {fmtValor(fromCents(diferenca))}
              </TableCell>
              <TableCell />
            </TableRow>
          </TableFooter>
        </Table>
      </section>

      <div className="flex justify-end gap-2">
        <Link href={voltar} className={buttonVariants({ variant: "outline" })}>
          Cancelar
        </Link>
        <Button type="submit" disabled={!podeSalvar}>
          <Save />
          {pendente ? "Salvando..." : "Salvar"}
        </Button>
      </div>
    </form>
  );
}
