"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeftRight, Eraser, Landmark, Plus } from "lucide-react";
import { toast } from "sonner";
import { criarContaOutroBanco, parearSemPar, previaZerarTransferencias, zerarTransferencias } from "@/actions/conciliacao";
import { ContaSelect, type ContaOpcao } from "@/components/conta-select";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TablePanel } from "@/components/page-header";
import { Valor } from "@/components/valor";
import { NOME_OUTRA_CONTA } from "@/lib/classificacao/transferencias";
import { cents, fmtData, fmtSaldoDC, fmtValor, fromCents } from "@/lib/format";
import type { SemParLinha } from "./queries";

type Par = Pick<SemParLinha, "id" | "data" | "contaBancariaNome" | "valor" | "memo">;
type Transitoria = { id: string; codigo: string; nome: string; saldo: string };

/** Aba Transferências: saldo da transitória, "Zerar manualmente" e as classificadas nela sem par (com o par, se apareceu). */
export function TransferenciasSemPar({ empresaId, transitoria, ate, semPar, contas }: {
  empresaId: string; transitoria: Transitoria; ate: string; semPar: (SemParLinha & { par: Par | null })[]; contas: ContaOpcao[];
}) {
  const router = useRouter();
  const [pendente, iniciar] = useTransition();
  const [zerar, setZerar] = useState(false);
  const saldo = cents(transitoria.saldo);
  const parear = (transacaoId: string, parId: string) =>
    iniciar(async () => {
      const r = await parearSemPar(empresaId, { transacaoId, parId });
      if (r.erro) return void toast.error(r.erro);
      toast.success("Transferência pareada.");
      router.refresh();
    });

  return (
    <div className="mb-6 grid gap-4">
      <div className="flex flex-wrap items-center gap-4 rounded-xl border bg-card p-4 shadow-card">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-violet-soft text-violet">
          <ArrowLeftRight className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">
            <span className="font-mono text-xs text-muted-foreground">{transitoria.codigo}</span> {transitoria.nome}
          </p>
          <p className="text-sm text-muted-foreground">
            Saldo em {fmtData(ate)}: <span className="font-medium text-foreground tabular-nums">{fmtSaldoDC(transitoria.saldo, "D")}</span>
            {" · "}{semPar.length} transação(ões) sem par.
            {saldo !== 0 && " Cadastre a outra conta bancária e importe o extrato dela: as transferências passam a casar sozinhas."}
          </p>
        </div>
        <Link href={`/e/${empresaId}/bancos`} className={buttonVariants({ variant: "outline" })}>
          <Landmark />
          Contas bancárias
        </Link>
        <Button variant="outline" disabled={saldo === 0} onClick={() => setZerar(true)}>
          <Eraser />
          Zerar manualmente
        </Button>
      </div>

      {semPar.length > 0 && (
        <TablePanel>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-24">Data</TableHead>
                <TableHead className="w-40">Conta</TableHead>
                <TableHead>Memo</TableHead>
                <TableHead className="w-32 text-right">Valor</TableHead>
                <TableHead className="w-72">Par</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {semPar.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="py-2 text-muted-foreground">{fmtData(t.data)}</TableCell>
                  <TableCell className="max-w-40 truncate py-1.5">{t.contaBancariaNome}</TableCell>
                  <TableCell className="max-w-96 truncate py-1.5" title={t.memo}>
                    <Link href={`/e/${empresaId}/lancamentos/${t.lancamentoId}`} className="hover:underline">{t.memo}</Link>
                  </TableCell>
                  <TableCell className="py-2 text-right"><Valor v={t.valor} /></TableCell>
                  <TableCell className="py-1.5">
                    {t.par ? (
                      <Button size="sm" variant="outline" disabled={pendente} onClick={() => parear(t.id, t.par!.id)}
                        title={`${fmtData(t.par.data)} · ${t.par.contaBancariaNome} · ${fmtValor(t.par.valor)} · ${t.par.memo}`}>
                        <ArrowLeftRight />
                        Parear com {fmtData(t.par.data).slice(0, 5)} · {t.par.contaBancariaNome}
                      </Button>
                    ) : (
                      <span className="text-xs text-muted-foreground">Sem par no extrato importado</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TablePanel>
      )}
      {zerar && (
        <ZerarDialog empresaId={empresaId} transitoria={transitoria} ate={ate} contas={contas} onClose={() => setZerar(false)} />
      )}
    </div>
  );
}

function ZerarDialog({ empresaId, transitoria, ate, contas: iniciais, onClose }: {
  empresaId: string; transitoria: Transitoria; ate: string; contas: ContaOpcao[]; onClose: () => void;
}) {
  const router = useRouter();
  const [pendente, iniciar] = useTransition();
  const [contas, setContas] = useState(iniciais.filter((c) => c.id !== transitoria.id));
  const [contaId, setContaId] = useState<string | null>(contas.find((c) => c.nome === NOME_OUTRA_CONTA)?.id ?? null);
  const [data, setData] = useState(ate);
  const [historico, setHistorico] = useState("Ajuste manual de transferências sem par");
  const [previa, setPrevia] = useState<{ saldo: number; data: string } | null>(null);
  const [erro, setErro] = useState<string>();
  const conta = contas.find((c) => c.id === contaId);

  const criarConta = () =>
    iniciar(async () => {
      const r = await criarContaOutroBanco(empresaId);
      if (r.erro || !r.conta) return setErro(r.erro);
      const c = r.conta;
      setContas((cs) => (cs.some((x) => x.id === c.id) ? cs : [...cs, c].sort((a, b) => a.codigo.localeCompare(b.codigo))));
      setContaId(c.id);
    });
  const revisar = () =>
    iniciar(async () => {
      setErro(undefined);
      const r = await previaZerarTransferencias(empresaId, data);
      if (r.erro || r.saldo === undefined) return setErro(r.erro);
      if (r.saldo === 0) return setErro(`A conta de transferências já está zerada em ${fmtData(data)}.`);
      setPrevia({ saldo: r.saldo, data });
    });
  const confirmar = () =>
    previa && contaId &&
    iniciar(async () => {
      const r = await zerarTransferencias(empresaId, { contaId, data: previa.data, historico, saldoEsperado: previa.saldo });
      if (r.erro) return setErro(r.erro);
      toast.success(`Lançamento ${r.numero ?? ""} criado: transferências zeradas em ${fmtData(previa.data)}.`);
      onClose();
      router.refresh();
    });

  const v = previa ? fmtValor(fromCents(Math.abs(previa.saldo))) : "";
  const linhas = previa && conta
    ? previa.saldo < 0
      ? [{ lado: "D", c: transitoria }, { lado: "C", c: conta }]
      : [{ lado: "D", c: conta }, { lado: "C", c: transitoria }]
    : [];

  return (
    <Dialog open onOpenChange={(o) => !o && !pendente && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Zerar transferências sem par</DialogTitle>
          <DialogDescription>
            Cria um lançamento manual que leva o saldo da conta de transferências para a conta escolhida. Quando a outra conta
            bancária for cadastrada, estorne este lançamento e pareie as transferências.
          </DialogDescription>
        </DialogHeader>
        {!previa ? (
          <div className="grid gap-3">
            <div className="grid gap-2">
              <Label>Contrapartida</Label>
              <ContaSelect contas={contas} value={contaId} onChange={setContaId} placeholder="Conta da outra ponta" />
              {!contas.some((c) => c.nome === NOME_OUTRA_CONTA) && (
                <Button type="button" variant="ghost" size="sm" className="w-fit" disabled={pendente} onClick={criarConta}>
                  <Plus />
                  Criar “{NOME_OUTRA_CONTA}” em 1.1.1
                </Button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label htmlFor="zerar-data">Data</Label>
                <Input id="zerar-data" type="date" value={data} onChange={(e) => setData(e.target.value)} />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="zerar-historico">Histórico</Label>
              <Input id="zerar-historico" value={historico} onChange={(e) => setHistorico(e.target.value)} />
            </div>
          </div>
        ) : (
          <div className="grid gap-2 text-sm">
            <p className="text-muted-foreground">Lançamento manual em {fmtData(previa.data)}: {historico}</p>
            <div className="divide-y rounded-lg border">
              {linhas.map((l) => (
                <div key={l.lado} className="flex items-center gap-3 px-3 py-2">
                  <span className="w-5 font-semibold">{l.lado}</span>
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-mono text-xs text-muted-foreground">{l.c.codigo}</span> {l.c.nome}
                  </span>
                  <span className="tabular-nums">R$ {v}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {erro && <p className="text-sm text-danger">{erro}</p>}
        <DialogFooter>
          {previa ? (
            <>
              <Button variant="outline" disabled={pendente} onClick={() => setPrevia(null)}>Voltar</Button>
              <Button disabled={pendente} onClick={confirmar}>
                <Eraser />
                {pendente ? "Lançando..." : "Confirmar lançamento"}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" disabled={pendente} onClick={onClose}>Cancelar</Button>
              <Button disabled={pendente || !contaId || !data || historico.trim().length < 3} onClick={revisar}>
                {pendente ? "Calculando..." : "Revisar lançamento"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
