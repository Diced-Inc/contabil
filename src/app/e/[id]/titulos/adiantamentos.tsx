"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeftRight, HandCoins, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { compensarAdiantamentoAction, desfazerCompensacaoAction } from "@/actions/titulos";
import type { ContaOpcao } from "@/components/conta-select";
import { EmptyState, TablePanel } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { partidasCompensacao, valorCompensacao, type TipoAdiantamento } from "@/lib/adiantamentos";
import { cents, fmtData, fmtValor, fromCents, parseValorBR, valorParaInput } from "@/lib/format";
import type { TipoTitulo } from "@/lib/operacoes";
import { montarPrevia, PreviaLancamentos } from "../conciliacao/previa-lancamentos";
import type { CompensacaoLinha } from "./queries";

/** Adiantamento com saldo (centavos), serializável para o cliente. */
export type AdiantamentoView = {
  id: string; tipo: TipoAdiantamento; contraparte: string; contraparteDocumento: string | null; valor: string; data: string;
  contaId: string; lancamentoId: string; saldo: number;
};

/** "Compensar com adiantamento" na linha do título: escolhe o adiantamento da contraparte e o valor (total ou parcial). */
export function CompensarDialog({ empresaId, titulo, adiantamentos, contas, fechados }: {
  empresaId: string;
  titulo: { id: string; tipo: TipoTitulo; contraparte: string; descricao: string; competencia: string; saldo: number; contaId: string | null };
  adiantamentos: AdiantamentoView[]; contas: ContaOpcao[]; fechados: string[];
}) {
  const router = useRouter();
  const [aberta, setAberta] = useState(false);
  const [adId, setAdId] = useState(adiantamentos[0]?.id ?? "");
  const ad = adiantamentos.find((a) => a.id === adId);
  const [valor, setValor] = useState(() => valorParaInput(fromCents(Math.min(titulo.saldo, adiantamentos[0]?.saldo ?? 0))));
  const [pendente, iniciar] = useTransition();
  const papel = contas.find((c) => c.papel === (titulo.tipo === "receber" ? "clientes" : "fornecedores"))?.id;
  const previa = montarPrevia(() => {
    if (!ad) throw new Error("Escolha o adiantamento.");
    const v = valorCompensacao(titulo.saldo, ad.saldo, cents(parseValorBR(valor) || 0));
    return [{
      data: titulo.competencia, competencia: `${titulo.competencia.slice(0, 7)}-01`,
      historico: `Compensação de adiantamento: ${titulo.contraparte} - ${titulo.descricao}`,
      partidas: partidasCompensacao(titulo.tipo, titulo.contaId ?? papel ?? "", ad.contaId, fromCents(v)),
    }];
  });
  const enviar = () => iniciar(async () => {
    const r = await compensarAdiantamentoAction(empresaId, { tituloId: titulo.id, adiantamentoId: adId, valor });
    if (r.erro) return void toast.error(r.erro);
    toast.success("Adiantamento compensado.");
    setAberta(false);
    router.refresh();
  });
  return (
    <Dialog open={aberta} onOpenChange={setAberta}>
      <DialogTrigger render={<Button variant="outline" size="sm" title="Compensar com adiantamento da contraparte" />}>
        <ArrowLeftRight />
        Compensar
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Compensar com adiantamento</DialogTitle>
          <DialogDescription>
            {titulo.contraparte} tem adiantamento em aberto. A compensação quita o título (total ou parcial) na competência dele, sem banco.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <Label htmlFor="comp-ad">Adiantamento</Label>
          <select id="comp-ad" value={adId} onChange={(e) => {
            setAdId(e.target.value);
            const a = adiantamentos.find((x) => x.id === e.target.value);
            if (a) setValor(valorParaInput(fromCents(Math.min(titulo.saldo, a.saldo))));
          }}
            className="h-9 w-full cursor-pointer rounded-md border border-input bg-card px-3 text-sm shadow-xs outline-none">
            {adiantamentos.map((a) => (
              <option key={a.id} value={a.id}>{fmtData(a.data)} · {a.contraparte} · saldo R$ {fmtValor(fromCents(a.saldo))}</option>
            ))}
          </select>
        </div>
        <div className="grid gap-2 sm:w-48">
          <Label htmlFor="comp-valor">Valor a compensar</Label>
          <Input id="comp-valor" value={valor} onChange={(e) => setValor(e.target.value)} inputMode="decimal" className="text-right tabular-nums" />
          <p className="text-xs text-muted-foreground">Título em aberto: R$ {fmtValor(fromCents(titulo.saldo))}</p>
        </div>
        <PreviaLancamentos previa={previa} contas={contas} fechados={fechados} />
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancelar</DialogClose>
          <Button onClick={enviar} disabled={pendente || typeof previa === "string"}>
            <HandCoins />
            {pendente ? "Compensando..." : "Compensar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Aba Adiantamentos: saldo em aberto de cada adiantamento e as compensações (com desfazer). */
export function AdiantamentosLista({ empresaId, adiantamentos, compensacoes }: {
  empresaId: string; adiantamentos: AdiantamentoView[]; compensacoes: CompensacaoLinha[];
}) {
  if (!adiantamentos.length)
    return (
      <EmptyState icon={HandCoins} title="Nenhum adiantamento"
        hint="Recebimento antes da receita (ou pagamento antes da despesa) entra pela conciliação, na operação Adiantamento, e é compensado aqui com o título da contraparte." />
    );
  const link = (id: string, n: number) => (
    <Link href={`/e/${empresaId}/lancamentos/${id}`} className="font-medium text-primary underline-offset-4 hover:underline">nº {n}</Link>
  );
  return (
    <TablePanel>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Data</TableHead>
            <TableHead>Tipo</TableHead>
            <TableHead>Contraparte</TableHead>
            <TableHead className="text-right">Adiantado</TableHead>
            <TableHead className="text-right">Em aberto</TableHead>
            <TableHead>Compensações</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {adiantamentos.map((a) => (
            <TableRow key={a.id}>
              <TableCell>{fmtData(a.data)}</TableCell>
              <TableCell><Badge variant={a.tipo === "cliente" ? "success" : "info"}>{a.tipo === "cliente" ? "De cliente" : "A fornecedor"}</Badge></TableCell>
              <TableCell className="font-medium">
                {a.contraparte}
                {a.contraparteDocumento && <span className="block text-xs font-normal text-muted-foreground tabular-nums">{a.contraparteDocumento}</span>}
              </TableCell>
              <TableCell className="text-right tabular-nums">{fmtValor(a.valor)}</TableCell>
              <TableCell className="text-right font-medium tabular-nums">{fmtValor(fromCents(a.saldo))}</TableCell>
              <TableCell>
                <span className="grid gap-1 text-sm">
                  <Link href={`/e/${empresaId}/lancamentos/${a.lancamentoId}`} className="w-fit text-muted-foreground underline-offset-4 hover:underline">
                    lançamento do adiantamento
                  </Link>
                  {compensacoes.filter((c) => c.adiantamentoId === a.id).map((c) => (
                    <span key={c.lancamentoId} className="flex items-center gap-2">
                      {fmtData(c.data)} · {c.descricao} · R$ {fmtValor(c.valor)} · {link(c.lancamentoId, c.numero)}
                      <DesfazerCompensacao empresaId={empresaId} lancamentoId={c.lancamentoId} />
                    </span>
                  ))}
                </span>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TablePanel>
  );
}

function DesfazerCompensacao({ empresaId, lancamentoId }: { empresaId: string; lancamentoId: string }) {
  const router = useRouter();
  const [pendente, iniciar] = useTransition();
  return (
    <Button variant="ghost" size="icon-sm" aria-label="Desfazer compensação" title="Desfazer compensação (estorno; o título volta a ficar em aberto)"
      disabled={pendente} onClick={() => iniciar(async () => {
        const r = await desfazerCompensacaoAction(empresaId, lancamentoId);
        if (r.erro) return void toast.error(r.erro);
        toast.success("Compensação desfeita: o título voltou a ficar em aberto.");
        router.refresh();
      })}>
      <Undo2 />
    </Button>
  );
}
