"use client";

import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Ban, CheckCheck, CircleStop, ListChecks, MoreHorizontal, PencilLine, RotateCcw, Sparkles, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { aprovarEmLote, desfazerConciliacao, desfazerEmLote, ignorarEmLote, reativarTransacao, sugerirComIA } from "@/actions/conciliacao";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { contaDeTitulo, type TipoSemTitulo } from "@/lib/sem-titulo";
import { AvisoSemTitulo } from "./aviso-sem-titulo";
import { ClassificarLote } from "./classificar-lote";
import { PainelReclassificar, PainelTransacao } from "./painel-transacao";
import type { ConciliadaLinha, TituloAberto, TransacaoLinha } from "./queries";

const aprovavel = (t: TransacaoLinha) =>
  ((t.sugestaoOrigem === "regra" || t.sugestaoOrigem === "ia") && !!t.sugestaoContaId) ||
  (t.sugestaoOrigem === "transferencia" && !!t.transferenciaParId);

const MIN_CONFIANCA_IA = 0.7;
const MAX_RODADAS_IA = 50; // trava de segurança do laço do "Sugerir com IA"
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
  // Progresso do "Sugerir com IA" (null = parado); o laço roda fora da transição para mostrar o andamento.
  const [ia, setIa] = useState<{ feitas: number; total: number; parando: boolean } | null>(null);
  const parar = useRef(false);
  useEffect(() => () => void (parar.current = true), []);
  const ocupado = pendente || ia !== null;
  const visiveis = new Set(transacoes.map((t) => t.id));
  const selecionadas = [...sel].filter((id) => visiveis.has(id));
  const linhasSel = transacoes.filter((t) => sel.has(t.id));
  const todasAprovaveis = linhasSel.every(aprovavel);
  const sinalMisto = new Set(linhasSel.map((t) => cents(t.valor) > 0)).size > 1;
  const [lote, setLote] = useState(false);
  const [confirmarIa, setConfirmarIa] = useState(false);
  const [ignorar, setIgnorar] = useState(false);
  const [motivo, setMotivo] = useState("");
  const porOrigem = (o: string) => linhasSel.filter((t) => t.sugestaoOrigem === o).length;
  const [ciente, setCiente] = useState(false);
  // sugestões (regra/IA) direto em conta de título; só as da IA em Clientes pedem confirmação
  const contaPorId = new Map(contas.map((c) => [c.id, c]));
  const tipoSugestao = (t: TransacaoLinha) =>
    t.sugestaoOrigem === "regra" || t.sugestaoOrigem === "ia" ? contaDeTitulo(contaPorId.get(t.sugestaoContaId ?? "")) : null;
  const semTitulo = (tp: TipoSemTitulo) => linhasSel.filter((t) => tipoSugestao(t) === tp).length;
  const iaClientes = linhasSel.filter((t) => t.sugestaoOrigem === "ia" && tipoSugestao(t) === "clientes").length;
  const nSemTitulo = linhasSel.filter((t) => tipoSugestao(t)).length;
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
      const r = await aprovarEmLote(empresaId, selecionadas, { minConfiancaIa, confirmarSemTitulo: ciente });
      if (r.aprovadas || r.puladas)
        toast.success(
          [`${r.aprovadas} aprovadas`, r.puladas && `${r.puladas} puladas (confiança baixa)`, r.diretas && `${r.diretas} direto em conta de título`]
            .filter(Boolean).join(" · "),
        );
      if (r.semTitulo) toast.warning(`${r.semTitulo} sugestão(ões) da IA em Clientes ficaram pendentes`, { description: "Sem título; confirme com “Sei o que estou fazendo” ou classifique na receita." });
      if (r.erros.length) toast.error(`${r.erros.length} com erro`, { description: r.erros.slice(0, 5).join("\n") });
      setSel(new Set());
      setConfirmarIa(false);
      router.refresh();
    });

  const ignorarSelecionadas = () =>
    iniciar(async () => {
      const r = await ignorarEmLote(empresaId, selecionadas, motivo);
      if (r.ignoradas) toast.success(`${r.ignoradas} ignoradas`);
      if (r.erros.length) toast.error(`${r.erros.length} com erro`, { description: r.erros.slice(0, 5).join("\n") });
      setSel(new Set());
      setIgnorar(false);
      router.refresh();
    });

  /** Chama a action em rodadas enquanto sobrar transação sem sugestão e cada rodada diminuir o que falta. */
  const sugerir = async () => {
    parar.current = false;
    let total = todas.filter((t) => !t.sugestaoOrigem).length;
    setIa({ feitas: 0, total, parando: false });
    const soma = { regras: 0, transferencias: 0, ia: 0 };
    const erros: string[] = [];
    let anterior = Infinity, restantes = 0, interrompido = false;
    try {
      for (let rodada = 0; rodada < MAX_RODADAS_IA; rodada++) {
        const r = await sugerirComIA(empresaId);
        soma.regras += r.regras;
        soma.transferencias += r.transferencias;
        soma.ia += r.ia;
        erros.push(...r.erros);
        restantes = r.restantes;
        if (rodada === 0) total = r.ia + r.restantes;
        setIa((x) => x && { ...x, feitas: soma.ia, total });
        router.refresh();
        if (!restantes || !r.ia || restantes >= anterior) break; // acabou, ou a rodada não avançou (erro repetido, IA fora)
        if (parar.current) {
          interrompido = true;
          break;
        }
        anterior = restantes;
      }
    } catch (e) {
      erros.push((e as Error).message || "Falha ao chamar a IA.");
    } finally {
      setIa(null);
    }
    const falta = restantes ? `${restantes} ainda sem sugestão${interrompido ? " (interrompido)" : ""}.` : undefined;
    toast.success(`Sugestões: ${soma.regras} por regra, ${soma.transferencias} transferência(s), ${soma.ia} pela IA.`, { description: falta });
    if (erros.length) toast.error(`${erros.length} erro(s) na sugestão`, { description: erros.slice(0, 5).join("\n") });
  };

  return (
    <>
      {todas.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
          <Button onClick={() => (porOrigem("ia") || nSemTitulo ? (setCiente(false), setConfirmarIa(true)) : aprovar())}
            disabled={ocupado || selecionadas.length === 0 || !todasAprovaveis}
            title={todasAprovaveis ? undefined : "Há transações selecionadas sem sugestão"}>
            <CheckCheck />
            Aprovar selecionadas ({selecionadas.length})
          </Button>
          <Button variant="outline" onClick={() => setLote(true)} disabled={ocupado || selecionadas.length === 0 || sinalMisto}
            title={sinalMisto ? "Selecione só entradas ou só saídas" : undefined}>
            <ListChecks />
            Classificar selecionadas ({selecionadas.length})
          </Button>
          <Button variant="outline" onClick={() => (setMotivo(""), setIgnorar(true))} disabled={ocupado || selecionadas.length === 0}>
            <Ban />
            Ignorar selecionadas ({selecionadas.length})
          </Button>
          <Button variant="outline" onClick={sugerir} disabled={ocupado}>
            <Sparkles className={ia ? "animate-pulse" : undefined} />
            {ia ? `Sugerindo… ${ia.feitas} de ${ia.total}` : "Sugerir com IA"}
          </Button>
          {ia && (
            <Button variant="ghost" disabled={ia.parando} title="Para depois da rodada em andamento"
              onClick={() => {
                parar.current = true;
                setIa((x) => x && { ...x, parando: true });
              }}>
              <CircleStop />
              {ia.parando ? "Parando…" : "Parar"}
            </Button>
          )}
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
      <Dialog open={ignorar} onOpenChange={(o) => !o && !pendente && setIgnorar(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ignorar {selecionadas.length} {selecionadas.length === 1 ? "transação" : "transações"}?</DialogTitle>
            <DialogDescription>Não geram lançamento. Podem ser reativadas na aba Ignoradas.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="motivo-lote">Motivo (opcional)</Label>
            <Input id="motivo-lote" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex.: saldo do dia, não é movimentação" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIgnorar(false)} disabled={pendente}>Cancelar</Button>
            <Button disabled={pendente} onClick={ignorarSelecionadas}>
              <Ban />
              {pendente ? "Ignorando..." : "Ignorar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={confirmarIa} onOpenChange={(o) => !o && setConfirmarIa(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{porOrigem("ia") ? "Aprovar sugestões da IA?" : "Aprovar sugestões?"}</DialogTitle>
            <DialogDescription>
              {linhasSel.length} selecionadas: {porOrigem("regra")} por regra, {porOrigem("transferencia")} transferências,{" "}
              {porOrigem("ia")} por IA ({linhasSel.filter(confiancaBaixa).length} com confiança abaixo de 0,70)
            </DialogDescription>
          </DialogHeader>
          {nSemTitulo > 0 && (
            <div className="grid gap-2">
              <p className="text-sm">
                Direto em conta de título, sem título: {semTitulo("clientes")} em Clientes, {semTitulo("fornecedores")} em Fornecedores,{" "}
                {semTitulo("impostos")} em impostos a recolher.
                {semTitulo("clientes") > iaClientes && " As de Clientes por regra seguem a decisão da regra."}
              </p>
              <AvisoSemTitulo
                tipos={iaClientes ? ["clientes"] : []}
                qtd={iaClientes}
                ciente={ciente}
                onCiente={setCiente}
              />
              {iaClientes > 0 && !ciente && (
                <p className="text-xs text-muted-foreground">Sem a confirmação, as {iaClientes} sugestões da IA em Clientes ficam pendentes.</p>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmarIa(false)} disabled={pendente}>Cancelar</Button>
            {porOrigem("ia") > 0 && (
              <Button variant="outline" disabled={pendente} onClick={() => aprovar(MIN_CONFIANCA_IA)}>
                Aprovar só confiança ≥ 0,70
              </Button>
            )}
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
