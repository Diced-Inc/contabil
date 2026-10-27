"use client";

import { useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCheck, ListChecks, MoreHorizontal, PencilLine, RotateCcw, Sparkles, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { aprovarEmLote, desfazerConciliacao, desfazerEmLote, reativarTransacao, sugerirComIA } from "@/actions/conciliacao";
import type { ContaOpcao } from "@/components/conta-select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TablePanel } from "@/components/page-header";
import { Valor } from "@/components/valor";
import { cents, fmtData } from "@/lib/format";
import { ClassificarLote } from "./classificar-lote";
import { PainelReclassificar, PainelTransacao } from "./painel-transacao";
import type { ConciliadaLinha, TituloAberto, TransacaoLinha } from "./queries";

const aprovavel = (t: TransacaoLinha) =>
  ((t.sugestaoOrigem === "regra" || t.sugestaoOrigem === "ia") && !!t.sugestaoContaId) ||
  (t.sugestaoOrigem === "transferencia" && !!t.transferenciaParId);

const MIN_CONFIANCA_IA = 0.7;
const confiancaBaixa = (t: TransacaoLinha) => t.sugestaoOrigem === "ia" && Number(t.sugestaoConfianca ?? 0) < MIN_CONFIANCA_IA;

function Sugestao({ t }: { t: TransacaoLinha }) {
  if (!t.sugestaoOrigem) return <Badge variant="warning">Sem sugestão</Badge>;
  const badge =
    t.sugestaoOrigem === "regra" ? (
      <Badge variant="info">Regra</Badge>
    ) : t.sugestaoOrigem === "transferencia" ? (
      <Badge variant="violet">Transf.</Badge>
    ) : (
      <Badge variant="muted">IA {Number(t.sugestaoConfianca ?? 0).toFixed(2).replace(".", ",")}</Badge>
    );
  return (
    <span className="flex min-w-0 items-center gap-2">
      {badge}
      <span className="truncate" title={t.sugestaoNome ?? undefined}>
        <span className="font-mono text-xs text-muted-foreground">{t.sugestaoCodigo}</span> {t.sugestaoNome}
      </span>
    </span>
  );
}

export function ConciliacaoLista({ empresaId, transacoes, todas, contas, titulos, vazio }: {
  vazio: ReactNode;
  empresaId: string;
  transacoes: TransacaoLinha[];
  todas: TransacaoLinha[];
  contas: ContaOpcao[];
  titulos: TituloAberto[];
}) {
  const router = useRouter();
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [aberta, setAberta] = useState<TransacaoLinha | null>(null);
  const [pendente, iniciar] = useTransition();
  const visiveis = new Set(transacoes.map((t) => t.id));
  const selecionadas = [...sel].filter((id) => visiveis.has(id));
  const linhasSel = transacoes.filter((t) => sel.has(t.id));
  const todasAprovaveis = linhasSel.every(aprovavel);
  const sinalMisto = new Set(linhasSel.map((t) => cents(t.valor) > 0)).size > 1;
  const [lote, setLote] = useState(false);
  const [confirmarIa, setConfirmarIa] = useState(false);
  const porOrigem = (o: string) => linhasSel.filter((t) => t.sugestaoOrigem === o).length;
  const contagem = (o: string | null) => transacoes.filter((t) => t.sugestaoOrigem === o).length;

  const alternar = (id: string, marcado: boolean) =>
    setSel((s) => {
      const n = new Set(s);
      if (marcado) n.add(id);
      else n.delete(id);
      return n;
    });

  const aprovar = (minConfiancaIa?: number) =>
    iniciar(async () => {
      const r = await aprovarEmLote(empresaId, selecionadas, { minConfiancaIa });
      if (r.aprovadas || r.puladas)
        toast.success(r.puladas ? `${r.aprovadas} aprovadas · ${r.puladas} puladas (confiança baixa)` : `${r.aprovadas} aprovadas`);
      if (r.erros.length) toast.error(`${r.erros.length} com erro`, { description: r.erros.slice(0, 5).join("\n") });
      setSel(new Set());
      setConfirmarIa(false);
      router.refresh();
    });

  const sugerir = () =>
    iniciar(async () => {
      const r = await sugerirComIA(empresaId);
      toast.success(`Sugestões: ${r.regras} por regra, ${r.transferencias} transferência(s), ${r.ia} pela IA.`);
      if (r.erros.length) toast.error(`${r.erros.length} erro(s) na sugestão`, { description: r.erros.slice(0, 5).join("\n") });
      router.refresh();
    });

  return (
    <>
      {todas.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
          <Button onClick={() => (porOrigem("ia") ? setConfirmarIa(true) : aprovar())}
            disabled={pendente || selecionadas.length === 0 || !todasAprovaveis}
            title={todasAprovaveis ? undefined : "Há transações selecionadas sem sugestão"}>
            <CheckCheck />
            Aprovar selecionadas ({selecionadas.length})
          </Button>
          <Button variant="outline" onClick={() => setLote(true)} disabled={pendente || selecionadas.length === 0 || sinalMisto}
            title={sinalMisto ? "Selecione só entradas ou só saídas" : undefined}>
            <ListChecks />
            Classificar selecionadas ({selecionadas.length})
          </Button>
          <Button variant="outline" onClick={sugerir} disabled={pendente}>
            <Sparkles />
            {pendente ? "Processando..." : "Sugerir com IA"}
          </Button>
          <span className="ml-auto flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{transacoes.length} pendentes</span>
            <Badge variant="info">{contagem("regra")} regra</Badge>
            <Badge variant="violet">{contagem("transferencia")} transf.</Badge>
            <Badge variant="muted">{contagem("ia")} IA</Badge>
            <Badge variant="warning">{contagem(null)} sem sugestão</Badge>
          </span>
        </div>
      )}
      {transacoes.length === 0 ? (
        vazio
      ) : (
        <TablePanel>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8">
                  <Checkbox
                    aria-label="Selecionar todas"
                    checked={transacoes.every((t) => sel.has(t.id))}
                    onCheckedChange={(c) => setSel(c ? new Set(transacoes.map((t) => t.id)) : new Set())}
                  />
                </TableHead>
                <TableHead className="w-24">Data</TableHead>
                <TableHead className="w-40">Conta</TableHead>
                <TableHead>Memo</TableHead>
                <TableHead className="w-32 text-right">Valor</TableHead>
                <TableHead className="w-80">Sugestão</TableHead>
                <TableHead className="w-20" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {transacoes.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="py-2">
                    <Checkbox
                      aria-label="Selecionar"
                      checked={sel.has(t.id)}
                      onCheckedChange={(c) => alternar(t.id, !!c)}
                    />
                  </TableCell>
                  <TableCell className="py-2 text-muted-foreground">{fmtData(t.data)}</TableCell>
                  <TableCell className="max-w-40 truncate py-1.5">{t.contaBancariaNome}</TableCell>
                  <TableCell className="max-w-96 truncate py-1.5" title={t.memo}>{t.memo}</TableCell>
                  <TableCell className="py-2 text-right"><Valor v={t.valor} /></TableCell>
                  <TableCell className="max-w-80 py-1.5"><Sugestao t={t} /></TableCell>
                  <TableCell className="py-2 text-right">
                    <Button size="sm" variant="outline" onClick={() => setAberta(t)}>Revisar</Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TablePanel>
      )}
      <PainelTransacao
        key={aberta?.id ?? "nenhuma"}
        empresaId={empresaId}
        transacao={aberta}
        onClose={() => setAberta(null)}
        todas={todas}
        contas={contas}
        titulos={titulos}
      />
      <ClassificarLote
        empresaId={empresaId}
        transacoes={linhasSel}
        contas={contas}
        open={lote}
        onClose={() => setLote(false)}
        onDone={() => setSel(new Set())}
      />
      <Dialog open={confirmarIa} onOpenChange={(o) => !o && setConfirmarIa(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Aprovar sugestões da IA?</DialogTitle>
            <DialogDescription>
              {linhasSel.length} selecionadas: {porOrigem("regra")} por regra, {porOrigem("transferencia")} transferências,{" "}
              {porOrigem("ia")} por IA ({linhasSel.filter(confiancaBaixa).length} com confiança abaixo de 0,70)
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmarIa(false)} disabled={pendente}>Cancelar</Button>
            <Button variant="outline" disabled={pendente} onClick={() => aprovar(MIN_CONFIANCA_IA)}>
              Aprovar só confiança ≥ 0,70
            </Button>
            <Button disabled={pendente} onClick={() => aprovar()}>
              <CheckCheck />
              {pendente ? "Aprovando..." : "Aprovar todas"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function Ignoradas({ empresaId, transacoes, vazio }: { empresaId: string; transacoes: TransacaoLinha[]; vazio: ReactNode }) {
  const router = useRouter();
  const [pendente, iniciar] = useTransition();
  const reativar = (id: string) =>
    iniciar(async () => {
      const r = await reativarTransacao(empresaId, id);
      if (r.erro) return void toast.error(r.erro);
      toast.success("Transação reativada.");
      router.refresh();
    });
  if (!transacoes.length) return vazio;
  return (
    <TablePanel>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-24">Data</TableHead>
            <TableHead className="w-40">Conta</TableHead>
            <TableHead>Memo</TableHead>
            <TableHead className="w-32 text-right">Valor</TableHead>
            <TableHead>Motivo</TableHead>
            <TableHead className="w-28" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {transacoes.map((t) => (
            <TableRow key={t.id}>
              <TableCell className="py-2 text-muted-foreground">{fmtData(t.data)}</TableCell>
              <TableCell className="max-w-40 truncate py-1.5">{t.contaBancariaNome}</TableCell>
              <TableCell className="max-w-96 truncate py-1.5" title={t.memo}>{t.memo}</TableCell>
              <TableCell className="py-2 text-right"><Valor v={t.valor} /></TableCell>
              <TableCell className="max-w-64 truncate py-1.5 text-muted-foreground">{t.sugestaoJustificativa}</TableCell>
              <TableCell className="py-2 text-right">
                <Button size="sm" variant="outline" disabled={pendente} onClick={() => reativar(t.id)}>
                  <RotateCcw />
                  Reativar
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TablePanel>
  );
}

function Classificacao({ c }: { c: ConciliadaLinha }) {
  const [primeira, ...resto] = c.contras;
  return (
    <span className="flex min-w-0 items-center gap-2">
      {c.status === "transferencia" ? (
        <>
          <Badge variant="violet">Transf.</Badge>
          <span className="truncate">{c.parContaNome}</span>
        </>
      ) : (
        primeira && (
          <span className="truncate" title={c.contras.map((x) => `${x.codigo} ${x.nome}`).join("\n")}>
            <span className="font-mono text-xs text-muted-foreground">{primeira.codigo}</span> {primeira.nome}
          </span>
        )
      )}
      {resto.length > 0 && <Badge variant="muted">+{resto.length}</Badge>}
      {c.baixaTitulo && <Badge variant="info">Baixa de título</Badge>}
    </span>
  );
}

export function Conciliadas({ empresaId, transacoes, contas, vazio }: {
  empresaId: string; transacoes: ConciliadaLinha[]; contas: ContaOpcao[]; vazio: ReactNode;
}) {
  const router = useRouter();
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [aberta, setAberta] = useState<ConciliadaLinha | null>(null);
  const [confirmar, setConfirmar] = useState<string[] | null>(null);
  const [pendente, iniciar] = useTransition();
  const selecionadas = transacoes.filter((t) => sel.has(t.transacaoId)).map((t) => t.transacaoId);

  const alternar = (id: string, marcado: boolean) =>
    setSel((s) => {
      const n = new Set(s);
      if (marcado) n.add(id);
      else n.delete(id);
      return n;
    });

  const desfazer = (ids: string[]) =>
    iniciar(async () => {
      if (ids.length === 1) {
        const r = await desfazerConciliacao(empresaId, ids[0]);
        if (r.erro) return void toast.error(r.erro);
        toast.success("Conciliação desfeita.");
      } else {
        const r = await desfazerEmLote(empresaId, ids);
        if (r.desfeitas) toast.success(`${r.desfeitas} conciliação(ões) desfeita(s).`);
        if (r.erros.length) toast.error(`${r.erros.length} com erro`, { description: r.erros.slice(0, 5).join("\n") });
      }
      setConfirmar(null);
      setSel(new Set());
      router.refresh();
    });

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <Button variant="outline" onClick={() => setConfirmar(selecionadas)} disabled={pendente || selecionadas.length === 0}>
          <Undo2 />
          Desfazer selecionadas ({selecionadas.length})
        </Button>
        <span className="ml-auto text-xs font-medium">{transacoes.length} conciliadas no período</span>
      </div>
      {transacoes.length === 0 ? (
        vazio
      ) : (
        <TablePanel>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8">
                  <Checkbox
                    aria-label="Selecionar todas"
                    checked={transacoes.every((t) => sel.has(t.transacaoId))}
                    onCheckedChange={(c) => setSel(c ? new Set(transacoes.map((t) => t.transacaoId)) : new Set())}
                  />
                </TableHead>
                <TableHead className="w-24">Data</TableHead>
                <TableHead className="w-40">Conta</TableHead>
                <TableHead>Memo</TableHead>
                <TableHead className="w-32 text-right">Valor</TableHead>
                <TableHead className="w-80">Classificação</TableHead>
                <TableHead className="w-16 text-right">Lanç.</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {transacoes.map((t) => {
                const podeReclassificar = t.status === "classificada" && !t.baixaTitulo;
                return (
                  <TableRow key={t.transacaoId}>
                    <TableCell className="py-2">
                      <Checkbox aria-label="Selecionar" checked={sel.has(t.transacaoId)} onCheckedChange={(c) => alternar(t.transacaoId, !!c)} />
                    </TableCell>
                    <TableCell className="py-2 text-muted-foreground">{fmtData(t.data)}</TableCell>
                    <TableCell className="max-w-40 truncate py-1.5">{t.contaBancariaNome}</TableCell>
                    <TableCell className="max-w-96 truncate py-1.5" title={t.memo}>{t.memo}</TableCell>
                    <TableCell className="py-2 text-right"><Valor v={t.valor} /></TableCell>
                    <TableCell className="max-w-80 py-1.5"><Classificacao c={t} /></TableCell>
                    <TableCell className="py-2 text-right tabular-nums">
                      <Link href={`/e/${empresaId}/lancamentos/${t.lancamentoId}`} className="text-primary hover:underline">
                        {t.numero}
                      </Link>
                    </TableCell>
                    <TableCell className="py-1.5 text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger render={<Button size="icon-sm" variant="ghost" aria-label="Ações" disabled={pendente} />}>
                          <MoreHorizontal />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem disabled={!podeReclassificar} onClick={() => setAberta(t)}>
                            <PencilLine />
                            Reclassificar
                          </DropdownMenuItem>
                          <DropdownMenuItem variant="destructive" onClick={() => setConfirmar([t.transacaoId])}>
                            <Undo2 />
                            Desfazer
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TablePanel>
      )}
      <PainelReclassificar
        key={aberta?.transacaoId ?? "nenhuma"}
        empresaId={empresaId}
        transacao={aberta}
        contas={contas}
        onClose={() => setAberta(null)}
      />
      <Dialog open={!!confirmar} onOpenChange={(o) => !o && setConfirmar(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirmar && confirmar.length > 1 ? `Desfazer ${confirmar.length} conciliações?` : "Desfazer a conciliação?"}
            </DialogTitle>
            <DialogDescription>A transação volta para pendentes e o lançamento é estornado.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmar(null)} disabled={pendente}>Cancelar</Button>
            <Button variant="destructive" disabled={pendente} onClick={() => confirmar && desfazer(confirmar)}>
              <Undo2 />
              {pendente ? "Desfazendo..." : "Desfazer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
