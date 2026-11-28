"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CalendarX2, CircleCheck, CircleX, Eye, FileText, Info, ListRestart, Repeat2, SkipForward, TriangleAlert, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import {
  desfazerLoteAction, executarReclassificacao, previaReclassificacao, type AlvoInput, type FiltroLoteInput, type PreviaReclassificacao,
} from "@/actions/reclassificacao";
import { ContaSelect, type ContaOpcao } from "@/components/conta-select";
import { TablePanel } from "@/components/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Valor } from "@/components/valor";
import { fmtCompetencia, fmtData, fmtValor } from "@/lib/format";
import { contaServe, IDS_OPERACAO, OPERACOES } from "@/lib/operacoes";
import { OPERACOES_LOTE, type OperacaoLote } from "@/lib/reclassificacao";
import type { ResultadoLote } from "@/lib/reclassificacao-registro";
import { contaDeTitulo } from "@/lib/sem-titulo";
import { PreviaLancamentos } from "../previa-lancamentos";

const selectCls =
  "h-9 w-full cursor-pointer rounded-md border border-input bg-card px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";
const TZ = "America/Sao_Paulo";
/** D − C em centavos: "1.234,56 D" / "C". */
const dc = (c: number) => (c === 0 ? "0,00" : `${fmtValor(Math.abs(c) / 100)} ${c > 0 ? "D" : "C"}`);

type Conta = ContaOpcao & { ativa: boolean };
type Lote = {
  loteId: string; quando: string; motivo: string | null; email: string | null; usuarioId: string | null; estornados: number; novos: number;
  tipo: "reclassificacao" | "desfazer" | "correcao";
};
type Filtro = Required<{ [K in keyof FiltroLoteInput]: string }>;
const FILTRO: Filtro = { contaBancariaId: "", contaId: "", operacao: "", memo: "", sinal: "", valorMin: "", valorMax: "", de: "", ate: "", compDe: "", compAte: "" };
type Destino = { operacao: OperacaoLote | ""; contaId: string | null; competencia: string; confirmar: boolean };
const GRUPOS = ["Resultado", "Títulos", "Movimentos", "Outros"] as const;
const SITUACAO = {
  reclassificar: { rotulo: "Reclassifica", variant: "info" },
  pulada: { rotulo: "Já no destino", variant: "muted" },
  bloqueada: { rotulo: "Bloqueada", variant: "danger" },
} as const;

export function ReclassificarLote({ empresaId, contas, bancos, lotes }: {
  empresaId: string; contas: Conta[]; bancos: { id: string; nome: string }[]; lotes: Lote[];
}) {
  const router = useRouter();
  const [pendente, iniciar] = useTransition();
  const [filtro, setFiltro] = useState<Filtro>(FILTRO);
  const [destino, setDestino] = useState<Destino>({ operacao: "receita_direta", contaId: null, competencia: "", confirmar: false });
  const [previa, setPrevia] = useState<{ dados: PreviaReclassificacao; alvo: AlvoInput } | null>(null);
  const [confirmar, setConfirmar] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [resultado, setResultado] = useState<(ResultadoLote & { titulo: string }) | null>(null);
  const [desfazer, setDesfazer] = useState<Lote | null>(null);

  const ativas = contas.filter((c) => c.ativa);
  const op = destino.operacao || null;
  const contasDestino = op ? ativas.filter((c) => contaServe(op, c, true) || contaServe(op, c, false)) : ativas;
  const direta = op === "receita_direta" || op === "despesa_direta";
  const contaEscolhida = ativas.find((c) => c.id === destino.contaId);
  const clientes = contaDeTitulo(contaEscolhida) === "clientes";
  const f = (p: Partial<Filtro>) => { setFiltro((x) => ({ ...x, ...p })); setPrevia(null); };
  const d = (p: Partial<Destino>) => { setDestino((x) => ({ ...x, ...p })); setPrevia(null); };
  const alvo = (): AlvoInput => ({
    operacao: op, contaId: op === "adiantamento" ? null : destino.contaId,
    competencia: direta && destino.competencia ? destino.competencia : null, confirmarSemTitulo: clientes && destino.confirmar,
  });

  const verPrevia = () => iniciar(async () => {
    const a = alvo();
    const r = await previaReclassificacao(empresaId, filtro, a);
    if ("erro" in r) return void toast.error(r.erro);
    setResultado(null);
    setPrevia({ dados: r, alvo: a });
  });
  const aEnviar = previa ? previa.dados.itens.filter((i) => i.tipo !== "bloqueada").map((i) => i.transacaoId) : [];
  const executar = () => iniciar(async () => {
    if (!previa) return;
    const r = await executarReclassificacao(empresaId, { transacaoIds: aEnviar, alvo: previa.alvo, motivo });
    if ("erro" in r) return void toast.error(r.erro);
    setConfirmar(false);
    setPrevia(null);
    setResultado({ ...r, titulo: "Reclassificação em lote" });
    toast.success(`${r.feitas} reclassificada(s), ${r.puladas.length} pulada(s), ${r.erros.length} com erro.`);
    router.refresh();
  });

  return (
    <div className="grid gap-5">
      <section className="grid gap-3 rounded-xl border bg-card p-4 shadow-card">
        <h2 className="text-sm font-semibold">1. Quais transações conciliadas</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Campo rotulo="Conta bancária">
            <select className={selectCls} value={filtro.contaBancariaId} onChange={(e) => f({ contaBancariaId: e.target.value })}>
              <option value="">Todas</option>
              {bancos.map((b) => <option key={b.id} value={b.id}>{b.nome}</option>)}
            </select>
          </Campo>
          <Campo rotulo="Contrapartida atual">
            <div className="flex gap-1">
              <ContaSelect contas={contas} value={filtro.contaId || null} onChange={(id) => f({ contaId: id })} placeholder="Qualquer conta" className="min-w-0 flex-1" />
              {filtro.contaId && <Button type="button" variant="ghost" size="sm" onClick={() => f({ contaId: "" })}>Limpar</Button>}
            </div>
          </Campo>
          <Campo rotulo="Operação atual">
            <select className={selectCls} value={filtro.operacao} onChange={(e) => f({ operacao: e.target.value })}>
              <option value="">Qualquer</option>
              {IDS_OPERACAO.map((o) => <option key={o} value={o}>{OPERACOES[o].rotulo}</option>)}
            </select>
          </Campo>
          <Campo rotulo="Memo contém">
            <Input value={filtro.memo} onChange={(e) => f({ memo: e.target.value })} placeholder="ex.: OURIBANK" />
          </Campo>
          <Campo rotulo="Sinal">
            <select className={selectCls} value={filtro.sinal} onChange={(e) => f({ sinal: e.target.value })}>
              <option value="">Entradas e saídas</option>
              <option value="entrada">Só entradas</option>
              <option value="saida">Só saídas</option>
            </select>
          </Campo>
          <Campo rotulo="Valor (absoluto) de / até">
            <div className="flex gap-2">
              <Input inputMode="decimal" value={filtro.valorMin} onChange={(e) => f({ valorMin: e.target.value })} placeholder="mín." aria-label="Valor mínimo" />
              <Input inputMode="decimal" value={filtro.valorMax} onChange={(e) => f({ valorMax: e.target.value })} placeholder="máx." aria-label="Valor máximo" />
            </div>
          </Campo>
          <Campo rotulo="Data do extrato de / até">
            <div className="flex gap-2">
              <Input type="date" value={filtro.de} onChange={(e) => f({ de: e.target.value })} aria-label="Data inicial" />
              <Input type="date" value={filtro.ate} onChange={(e) => f({ ate: e.target.value })} aria-label="Data final" />
            </div>
          </Campo>
          <Campo rotulo="Competência de / até">
            <div className="flex gap-2">
              <Input type="month" value={filtro.compDe} onChange={(e) => f({ compDe: e.target.value })} aria-label="Competência inicial" />
              <Input type="month" value={filtro.compAte} onChange={(e) => f({ compAte: e.target.value })} aria-label="Competência final" />
            </div>
          </Campo>
        </div>
      </section>

      <section className="grid gap-3 rounded-xl border bg-card p-4 shadow-card">
        <h2 className="text-sm font-semibold">2. Para onde vão</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Campo rotulo="Operação">
            <select className={selectCls} value={destino.operacao} onChange={(e) => d({ operacao: e.target.value as Destino["operacao"], contaId: null })}>
              {GRUPOS.map((g) => (
                <optgroup key={g} label={g}>
                  {OPERACOES_LOTE.filter((o) => OPERACOES[o].grupo === g).map((o) => <option key={o} value={o}>{OPERACOES[o].rotulo}</option>)}
                </optgroup>
              ))}
              <option value="">Só a conta (sem operação)</option>
            </select>
          </Campo>
          {op !== "adiantamento" && (
            <Campo rotulo="Conta de destino" className="sm:col-span-2">
              <ContaSelect contas={contasDestino} value={destino.contaId} onChange={(id) => d({ contaId: id })}
                placeholder={contasDestino.length ? "Selecione a conta" : "Nenhuma conta desta operação no plano"} />
            </Campo>
          )}
          {direta && (
            <Campo rotulo="Competência">
              <Input type="month" value={destino.competencia} onChange={(e) => d({ competencia: e.target.value })} aria-describedby="comp-ajuda" />
            </Campo>
          )}
        </div>
        <p id="comp-ajuda" className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" />
          {op ? (typeof OPERACOES[op].explica === "string" ? OPERACOES[op].explica : `${OPERACOES[op].explica.entrada} ${OPERACOES[op].explica.saida}`) : "Mesma regra da reclassificação do painel: D Banco / C conta (entrada) ou D conta / C Banco (saída)."}
          {direta && " Competência em branco: o mês do extrato de cada transação."}
        </p>
        {clientes && (
          <label className="flex items-center gap-2 text-sm text-warning">
            <Checkbox checked={destino.confirmar} onCheckedChange={(c) => d({ confirmar: !!c })} />
            Sei o que estou fazendo: recebimento direto em Clientes sem título (decisão explícita).
          </label>
        )}
        <div>
          <Button onClick={verPrevia} disabled={pendente}>
            <Eye />
            {pendente && !confirmar ? "Calculando..." : "Ver prévia"}
          </Button>
        </div>
      </section>

      {previa && <Previa empresaId={empresaId} dados={previa.dados} contas={contas} onExecutar={() => setConfirmar(true)} enviar={aEnviar.length} />}
      {resultado && <Resultado r={resultado} onDesfazer={resultado.feitas ? () => setDesfazer({
        loteId: resultado.loteId, quando: new Date().toISOString(), motivo, email: null, usuarioId: null, estornados: resultado.feitas, novos: 0, tipo: "reclassificacao",
      }) : undefined} />}

      <Lotes lotes={lotes} onDesfazer={setDesfazer} />

      <Dialog open={confirmar} onOpenChange={setConfirmar}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reclassificar {previa?.dados.resumo.reclassificar ?? 0} transação(ões)?</DialogTitle>
            <DialogDescription>
              Cada uma vira estorno do lançamento atual + lançamento novo, numa transação do banco por item. Nada é editado no lugar; dá para
              desfazer o lote depois (de novo por estorno + novo).
              {!!previa?.dados.resumo.puladas && ` ${previa.dados.resumo.puladas} já no destino serão puladas.`}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="motivo">Motivo (vai para o histórico de cada lançamento)</Label>
            <Textarea id="motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={3}
              placeholder="ex.: recebimentos sem título creditados em Clientes; são receita de serviço do mês" />
          </div>
          <Button onClick={executar} disabled={pendente || motivo.trim().length < 5}>
            <Repeat2 />
            {pendente ? "Reclassificando..." : "Confirmar reclassificação"}
          </Button>
        </DialogContent>
      </Dialog>
      <DesfazerDialog empresaId={empresaId} lote={desfazer} onClose={() => setDesfazer(null)}
        onFeito={(r) => { setResultado({ ...r, titulo: "Desfazer lote" }); router.refresh(); }} />
    </div>
  );
}

function Campo({ rotulo, className, children }: { rotulo: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("grid content-start gap-1.5", className)}>
      <span className="text-xs font-medium text-muted-foreground">{rotulo}</span>
      {children}
    </div>
  );
}

function Previa({ empresaId, dados, contas, onExecutar, enviar }: { empresaId: string; dados: PreviaReclassificacao; contas: Conta[]; onExecutar: () => void; enviar: number }) {
  const { resumo, efeito, itens } = dados;
  const [ver, setVer] = useState<"todas" | "reclassificar" | "pulada" | "bloqueada">("todas");
  if (!itens.length)
    return <p className="rounded-xl border border-dashed bg-card px-4 py-8 text-center text-sm text-muted-foreground">Nenhuma transação conciliada com esse filtro.</p>;
  const lista = ver === "todas" ? itens : itens.filter((i) => i.tipo === ver);
  return (
    <section className="grid gap-4" aria-label="Prévia da reclassificação">
      <div className="grid grid-cols-3 gap-3">
        <Cartao icone={Repeat2} cor="text-info" n={resumo.reclassificar} rotulo={`a reclassificar · R$ ${fmtValor(resumo.total)}`} />
        <Cartao icone={SkipForward} cor="text-muted-foreground" n={resumo.puladas} rotulo="já no destino (puladas)" />
        <Cartao icone={CircleX} cor="text-danger" n={resumo.bloqueadas} rotulo="bloqueadas (motivo na lista)" />
      </div>

      {(resumo.mesesFechados.length > 0 || resumo.titulos > 0 || resumo.transferencias > 0 || resumo.adiantamentos > 0 || resumo.semPar > 0) && (
        <Alert className="border-warning/25 bg-warning-soft text-warning *:data-[slot=alert-description]:text-warning/90">
          <TriangleAlert />
          <AlertTitle>Avisos</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-4">
              {resumo.mesesFechados.length > 0 && (
                <li>Meses fechados: {resumo.mesesFechados.map(fmtCompetencia).join(", ")}. Reabra em Fechamento (do mais recente para o mais antigo) e feche de novo depois; exercício apurado exige reverter a apuração antes.</li>
              )}
              {resumo.titulos > 0 && <li>{resumo.titulos} baixou(aram) título: ficam de fora (desfaça a conciliação pelo painel).</li>}
              {resumo.adiantamentos > 0 && <li>{resumo.adiantamentos} adiantamento(s) registrado(s): ficam de fora (a compensação depende deles).</li>}
              {resumo.transferencias > 0 && <li>{resumo.transferencias} transferência(s) casada(s) com o par: ficam de fora (desfaça o par).</li>}
              {resumo.semPar > 0 && <li>{resumo.semPar} sai(em) da conta de transferências (sem par): o saldo da transitória muda.</li>}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {efeito.contas.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div>
            <h3 className="mb-2 text-sm font-semibold">Saldo das contas afetadas (todo o período)</h3>
            <TablePanel>
              <Table>
                <TableHeader><TableRow><TableHead>Conta</TableHead><TableHead className="text-right">Antes</TableHead><TableHead className="text-right">Depois</TableHead></TableRow></TableHeader>
                <TableBody>
                  {efeito.contas.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell><span className="mr-2 font-mono text-xs text-muted-foreground">{c.codigo}</span>{c.nome}</TableCell>
                      <TableCell className="text-right tabular-nums">{dc(c.antes)}</TableCell>
                      <TableCell className="text-right font-medium tabular-nums">{dc(c.depois)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TablePanel>
          </div>
          <div className="grid content-start gap-4">
            {efeito.anos.map((a) => (
              <div key={a.ano}>
                <h3 className="mb-2 text-sm font-semibold">Exercício {a.ano}</h3>
                <TablePanel>
                  <Table>
                    <TableHeader><TableRow><TableHead>DRE (competência)</TableHead><TableHead className="text-right">Antes</TableHead><TableHead className="text-right">Depois</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {a.dre.contas.map((c) => (
                        <TableRow key={c.id}>
                          <TableCell><span className="mr-2 font-mono text-xs text-muted-foreground">{c.codigo}</span>{c.nome}</TableCell>
                          <TableCell className="text-right"><Valor v={c.antes / 100} /></TableCell>
                          <TableCell className="text-right"><Valor v={c.depois / 100} className="font-medium" /></TableCell>
                        </TableRow>
                      ))}
                      <TableRow className="font-medium">
                        <TableCell>Resultado líquido</TableCell>
                        <TableCell className="text-right"><Valor v={a.dre.liquido.antes / 100} /></TableCell>
                        <TableCell className="text-right"><Valor v={a.dre.liquido.depois / 100} /></TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                  <Table>
                    <TableHeader><TableRow><TableHead>Balanço em 31/12/{a.ano}</TableHead><TableHead className="text-right">Antes</TableHead><TableHead className="text-right">Depois</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {a.balanco.contas.map((c) => (
                        <TableRow key={c.id}>
                          <TableCell><span className="mr-2 font-mono text-xs text-muted-foreground">{c.codigo}</span>{c.nome}</TableCell>
                          <TableCell className="text-right tabular-nums">{dc(c.antes)}</TableCell>
                          <TableCell className="text-right font-medium tabular-nums">{dc(c.depois)}</TableCell>
                        </TableRow>
                      ))}
                      <TableRow className="font-medium">
                        <TableCell>Ativo total</TableCell>
                        <TableCell className="text-right tabular-nums">{dc(a.balanco.ativo.antes)}</TableCell>
                        <TableCell className="text-right tabular-nums">{dc(a.balanco.ativo.depois)}</TableCell>
                      </TableRow>
                      <TableRow className="font-medium">
                        <TableCell>Passivo + PL (com o resultado)</TableCell>
                        <TableCell className="text-right tabular-nums">{dc(a.balanco.passivoPl.antes)}</TableCell>
                        <TableCell className="text-right tabular-nums">{dc(a.balanco.passivoPl.depois)}</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </TablePanel>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">Transações ({itens.length})</h3>
        <div className="inline-flex rounded-lg border bg-muted p-[3px] text-xs">
          {(["todas", "reclassificar", "pulada", "bloqueada"] as const).map((v) => (
            <button key={v} type="button" onClick={() => setVer(v)}
              className={cn("rounded-md px-2.5 py-1 font-medium text-muted-foreground", ver === v && "bg-card text-foreground shadow-xs")}>
              {v === "todas" ? "Todas" : SITUACAO[v].rotulo}
            </button>
          ))}
        </div>
        <Button className="ml-auto" onClick={onExecutar} disabled={!enviar}>
          <Repeat2 />
          {resumo.reclassificar ? `Reclassificar ${resumo.reclassificar}` : `Executar (${resumo.puladas} já no destino)`}
        </Button>
      </div>
      <ul className="divide-y overflow-hidden rounded-xl border bg-card shadow-card">
        {lista.map((i) => (
          <li key={i.transacaoId}>
            <details className="group">
              <summary className="grid cursor-pointer grid-cols-[6rem_1fr_auto] items-center gap-x-3 gap-y-0.5 px-4 py-2.5 text-sm hover:bg-muted/40 sm:grid-cols-[6rem_1fr_9rem_14rem_8rem]">
                <span className="tabular-nums">{fmtData(i.data)}</span>
                <span className="min-w-0 truncate" title={i.memo}>{i.memo || "(sem memo)"}</span>
                <Valor v={i.valor} className="text-right" />
                <span className="hidden min-w-0 truncate text-xs text-muted-foreground sm:block" title={i.atual}>nº {i.numero} · {i.atual}</span>
                <span className="hidden justify-end sm:flex"><Badge variant={SITUACAO[i.tipo].variant}>{SITUACAO[i.tipo].rotulo}</Badge></span>
              </summary>
              <div className="grid gap-2 border-t bg-muted/20 px-4 py-3">
                {i.motivo && (
                  <p className={cn("flex items-center gap-1.5 text-xs", i.tipo === "bloqueada" ? "text-danger" : "text-muted-foreground")}>
                    {i.tipo === "bloqueada" ? <CalendarX2 className="size-3.5" /> : <Info className="size-3.5" />}
                    {i.motivo}
                  </p>
                )}
                <Link href={`/e/${empresaId}/lancamentos/${i.lancamentoId}`} className="w-fit text-xs text-primary underline-offset-4 hover:underline">
                  Lançamento atual nº {i.numero} ({i.banco})
                </Link>
                {i.lancs.length > 0 && <PreviaLancamentos previa={i.lancs} contas={contas} />}
              </div>
            </details>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Cartao({ icone: Icone, cor, n, rotulo }: { icone: typeof Repeat2; cor: string; n: number; rotulo: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border bg-card p-4 shadow-card">
      <Icone className={cn("size-5 shrink-0", cor)} />
      <div>
        <p className="font-display text-2xl font-semibold tracking-[-0.02em] tabular-nums">{n}</p>
        <p className="text-xs text-muted-foreground">{rotulo}</p>
      </div>
    </div>
  );
}

function Resultado({ r, onDesfazer }: { r: ResultadoLote & { titulo: string }; onDesfazer?: () => void }) {
  return (
    <section className="grid gap-3 rounded-xl border bg-card p-4 shadow-card" aria-label="Resultado do lote">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold">{r.titulo}: resultado</h2>
        <span className="font-mono text-xs text-muted-foreground">lote {r.loteId.slice(0, 8)}</span>
        {onDesfazer && (
          <Button variant="outline" size="sm" className="ml-auto" onClick={onDesfazer}>
            <Undo2 />
            Desfazer este lote
          </Button>
        )}
      </div>
      <div className="flex flex-wrap gap-4 text-sm">
        <span className="flex items-center gap-1.5"><CircleCheck className="size-4 text-success" /> {r.feitas} feita(s)</span>
        <span className="flex items-center gap-1.5"><SkipForward className="size-4 text-muted-foreground" /> {r.puladas.length} pulada(s)</span>
        <span className="flex items-center gap-1.5"><CircleX className="size-4 text-danger" /> {r.erros.length} com erro</span>
      </div>
      {[["Puladas", r.puladas], ["Erros", r.erros]].map(([t, xs]) => (xs as ResultadoLote["erros"]).length > 0 && (
        <div key={t as string}>
          <p className="mb-1 text-xs font-medium text-muted-foreground">{t as string}</p>
          <ul className="grid gap-0.5 text-xs">
            {(xs as ResultadoLote["erros"]).map((x) => <li key={x.id}><span className="font-medium">{x.memo.slice(0, 60) || x.id.slice(0, 8)}</span>: {x.motivo}</li>)}
          </ul>
        </div>
      ))}
    </section>
  );
}

const TIPO_LOTE = { reclassificacao: "Reclassificação", desfazer: "Desfazer", correcao: "Correção de estorno" } as const;

function Lotes({ lotes, onDesfazer }: { lotes: Lote[]; onDesfazer: (l: Lote) => void }) {
  if (!lotes.length) return null;
  return (
    <section>
      <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold"><ListRestart className="size-4" /> Lotes recentes</h2>
      <TablePanel>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-40">Quando</TableHead>
              <TableHead className="w-40">Tipo</TableHead>
              <TableHead>Motivo</TableHead>
              <TableHead className="w-56">Usuário</TableHead>
              <TableHead className="w-24 text-right">Estornos</TableHead>
              <TableHead className="w-28" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {lotes.map((l) => (
              <TableRow key={l.loteId}>
                <TableCell className="text-muted-foreground">{new Date(l.quando).toLocaleString("pt-BR", { timeZone: TZ })}</TableCell>
                <TableCell><Badge variant={l.tipo === "reclassificacao" ? "info" : "muted"}>{TIPO_LOTE[l.tipo]}</Badge></TableCell>
                <TableCell className="whitespace-normal"><FileText className="mr-1 inline size-3.5 text-muted-foreground" />{l.motivo}</TableCell>
                <TableCell className="truncate">{l.email ?? l.usuarioId?.slice(0, 8) ?? "-"}</TableCell>
                <TableCell className="text-right tabular-nums">{l.estornados}</TableCell>
                <TableCell className="text-right">
                  {l.tipo === "reclassificacao" && (
                    <Button variant="outline" size="sm" onClick={() => onDesfazer(l)}>
                      <Undo2 />
                      Desfazer
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TablePanel>
    </section>
  );
}

function DesfazerDialog({ empresaId, lote, onClose, onFeito }: {
  empresaId: string; lote: Lote | null; onClose: () => void; onFeito: (r: ResultadoLote) => void;
}) {
  const [motivo, setMotivo] = useState("");
  const [pendente, iniciar] = useTransition();
  const enviar = () => iniciar(async () => {
    if (!lote) return;
    const r = await desfazerLoteAction(empresaId, lote.loteId, motivo);
    if ("erro" in r) return void toast.error(r.erro);
    toast.success(`Lote desfeito: ${r.feitas} feita(s), ${r.puladas.length} pulada(s), ${r.erros.length} com erro.`);
    setMotivo("");
    onClose();
    onFeito(r);
  });
  return (
    <Dialog open={!!lote} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Desfazer lote {lote?.loteId.slice(0, 8)}</DialogTitle>
          <DialogDescription>
            Estorna o que o lote lançou (títulos reconhecidos por ele são cancelados) e lança de novo a classificação anterior de cada
            transação, também por estorno + novo. Transação que mudou depois do lote é pulada. Os meses envolvidos precisam estar abertos.
          </DialogDescription>
        </DialogHeader>
        {lote?.motivo && <p className="text-xs text-muted-foreground">Motivo do lote: {lote.motivo}</p>}
        <div className="grid gap-2">
          <Label htmlFor="motivo-desfazer">Motivo para desfazer</Label>
          <Textarea id="motivo-desfazer" value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2} />
        </div>
        <Button variant="destructive" onClick={enviar} disabled={pendente || motivo.trim().length < 5}>
          <Undo2 />
          {pendente ? "Desfazendo..." : "Confirmar desfazer"}
        </Button>
      </DialogContent>
    </Dialog>
  );
}

