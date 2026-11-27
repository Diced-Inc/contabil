"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDownToLine, Ban, Landmark, Plus, Save } from "lucide-react";
import { toast } from "sonner";
import { cancelarParcelamentoAction, criarParcelamentoAction, transferirCurtoPrazoAction } from "@/actions/titulos";
import { ContaSelect, type ContaOpcao } from "@/components/conta-select";
import { EmptyState, TablePanel } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cents, fmtData, fmtValor, fromCents, hoje, parseValorBR, primeiroDiaDoMes, valorParaInput } from "@/lib/format";
import type { LancPrevia } from "@/lib/operacoes";
import type { MovimentoCurtoPrazo } from "@/lib/parcelamentos";
import { montarParcelamento, parcelaSugerida, PARCELAS_CP } from "@/lib/parcelamentos";
import { acharConta, norm } from "@/lib/tributos";
import { montarPrevia, PreviaLancamentos } from "../conciliacao/previa-lancamentos";
import type { ParcelamentoLinha } from "./queries";

const reais = (s: string) => fromCents(cents(parseValorBR(s) || 0));
const por = (contas: ContaOpcao[], prefixo: string, re: RegExp) => acharConta(contas, { prefixo, re })?.id ?? null;

/** Obrigação de imposto em aberto (título de guia) que um parcelamento pode consolidar. */
export type ObrigacaoAberta = { id: string; descricao: string; contaId: string | null; saldo: string; vencimento: string | null };

export function Parcelamentos({ empresaId, lista, contas, fechados, obrigacoes }: {
  empresaId: string; lista: ParcelamentoLinha[]; contas: ContaOpcao[]; fechados: string[]; obrigacoes: ObrigacaoAberta[];
}) {
  const acoes = (
    <div className="flex flex-wrap gap-2">
      <TransferirCurtoPrazo empresaId={empresaId} contas={contas} fechados={fechados} />
      <NovoParcelamento empresaId={empresaId} contas={contas} fechados={fechados} obrigacoes={obrigacoes} />
    </div>
  );
  if (!lista.length)
    return (
      <EmptyState icon={Landmark} title="Nenhum parcelamento"
        hint="Registre a dívida consolidada (principal, multa e juros): ela vai para Parcelamentos de Tributos no curto e no longo prazo, com um título por parcela."
        action={<NovoParcelamento empresaId={empresaId} contas={contas} fechados={fechados} obrigacoes={obrigacoes} />} />
    );
  return (
    <div className="grid gap-3">
      <div className="flex justify-end">{acoes}</div>
      <TablePanel>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Tributo/origem</TableHead>
              <TableHead>Início</TableHead>
              <TableHead className="text-right">Consolidado</TableHead>
              <TableHead>Parcelas</TableHead>
              <TableHead className="text-right">Curto prazo</TableHead>
              <TableHead className="text-right">Longo prazo</TableHead>
              <TableHead>Lançamento</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {lista.map((p) => (
              <TableRow key={p.id} className={p.status === "cancelado" ? "text-muted-foreground" : undefined}>
                <TableCell className="font-medium">
                  {p.descricao} {p.status === "cancelado" && <Badge variant="muted" className="ml-1 line-through">Cancelado</Badge>}
                </TableCell>
                <TableCell>{fmtData(p.data)}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtValor(Number(p.principal) + Number(p.multa) + Number(p.juros))}</TableCell>
                <TableCell className="text-sm">
                  {p.nParcelas}× {fmtValor(p.valorParcela)} desde {fmtData(p.primeiroVencimento)}
                  <span className="block text-xs text-muted-foreground">{p.abertas} em aberto</span>
                </TableCell>
                <TableCell className="text-right tabular-nums">{fmtValor(p.saldoCp)}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtValor(p.saldoLp)}</TableCell>
                <TableCell>
                  {p.reconhecimento && (
                    <Link href={`/e/${empresaId}/lancamentos/${p.reconhecimento.id}`} className="font-medium text-primary underline-offset-4 hover:underline">
                      nº {p.reconhecimento.numero}
                    </Link>
                  )}
                </TableCell>
                <TableCell>{p.status === "ativo" && p.baixadas === 0 && <CancelarParcelamento empresaId={empresaId} p={p} />}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TablePanel>
    </div>
  );
}

function NovoParcelamento({ empresaId, contas, fechados, obrigacoes }: { empresaId: string; contas: ContaOpcao[]; fechados: string[]; obrigacoes: ObrigacaoAberta[] }) {
  const [aberta, setAberta] = useState(false);
  const [chave, setChave] = useState(0);
  return (
    <Dialog open={aberta} onOpenChange={(a) => { setAberta(a); if (a) setChave((k) => k + 1); }}>
      <DialogTrigger render={<Button />}>
        <Plus />
        Novo parcelamento
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Novo parcelamento</DialogTitle>
          <DialogDescription>
            A dívida consolidada vai para Parcelamentos de Tributos: as próximas {PARCELAS_CP} parcelas no curto prazo e o resto no longo prazo.
          </DialogDescription>
        </DialogHeader>
        <FormParcelamento key={chave} empresaId={empresaId} contas={contas} fechados={fechados} obrigacoes={obrigacoes} onFeito={() => setAberta(false)} />
      </DialogContent>
    </Dialog>
  );
}

function FormParcelamento({ empresaId, contas, fechados, obrigacoes, onFeito }: {
  empresaId: string; contas: ContaOpcao[]; fechados: string[]; obrigacoes: ObrigacaoAberta[]; onFeito: () => void;
}) {
  const router = useRouter();
  const [pendente, iniciar] = useTransition();
  const [descricao, setDescricao] = useState("");
  const [principal, setPrincipal] = useState("");
  const [multa, setMulta] = useState("");
  const [juros, setJuros] = useState("");
  const [nParcelas, setNParcelas] = useState("60");
  const [valorParcela, setValorParcela] = useState("");
  const [primeiro, setPrimeiro] = useState("");
  const [data, setData] = useState(hoje());
  const [jaReconhecido, setJaReconhecido] = useState(true);
  const aRecolher = contas.filter((c) => /^2\.1\./.test(c.codigo) && !c.papel && /a recolher/.test(norm(c.nome)));
  const despesas = contas.filter((c) => /^3\./.test(c.codigo) && !c.papel);
  const [contaPrincipal, setContaPrincipal] = useState<string | null>(por(contas, "2.1", /^simples nacional a recolher$/));
  const [contaMulta, setContaMulta] = useState<string | null>(por(contas, "3.2", /^outras despesas financeiras$/));
  const [contaJuros, setContaJuros] = useState<string | null>(por(contas, "3.2", /^juros passivos$/));
  const [contaCp, setContaCp] = useState<string | null>(por(contas, "2.1", /^parcelamentos? de (tributos|impostos)$/));
  const [contaLp, setContaLp] = useState<string | null>(por(contas, "2.2", /^parcelamentos? de (tributos|impostos)( de)? longo prazo$/));
  const [consolidar, setConsolidar] = useState<string[]>([]);
  const naConta = jaReconhecido ? obrigacoes.filter((o) => o.contaId === contaPrincipal) : [];
  const selecionadas = naConta.filter((o) => consolidar.includes(o.id));
  const somaSel = selecionadas.reduce((x, o) => x + cents(o.saldo), 0);
  const marcar = (id: string, c: boolean) => {
    const ids = c ? [...consolidar, id] : consolidar.filter((x) => x !== id);
    setConsolidar(ids);
    const soma = naConta.filter((o) => ids.includes(o.id)).reduce((x, o) => x + cents(o.saldo), 0);
    if (soma) setPrincipal(valorParaInput(fromCents(soma)));
  };
  const total = cents(reais(principal)) + cents(reais(multa)) + cents(reais(juros));
  const n = Math.trunc(Number(nParcelas) || 0);
  const input = {
    descricao, principal: reais(principal), multa: reais(multa), juros: reais(juros), nParcelas: n,
    valorParcela: valorParcela.trim() ? reais(valorParcela) : fromCents(parcelaSugerida(total, n)),
    primeiroVencimento: primeiro, data, contaPrincipalId: contaPrincipal ?? "", contaMultaId: cents(reais(multa)) ? contaMulta : null,
    contaJurosId: cents(reais(juros)) ? contaJuros : null, contaCpId: contaCp ?? "", contaLpId: contaLp ?? "",
    titulosIds: selecionadas.map((o) => o.id),
  };
  const calc = (() => {
    try {
      if (!primeiro) throw new Error("Informe o 1º vencimento.");
      if (!contaPrincipal || !contaCp || !contaLp) throw new Error("Escolha as contas do principal e do parcelamento (curto e longo prazo).");
      if (selecionadas.length && somaSel !== cents(input.principal))
        throw new Error(`As obrigações marcadas somam R$ ${fmtValor(fromCents(somaSel))}; o principal precisa ser igual.`);
      const m = montarParcelamento(input);
      const ultima = m.parcelas.at(-1)!;
      const resumo = `${m.parcelas.length} parcelas: ${m.parcelas.length > 1 ? `${m.parcelas.length - 1} de R$ ${fmtValor(input.valorParcela)} e a última de ` : ""}R$ ${fmtValor(fromCents(ultima.valor))} (vence ${fmtData(ultima.vencimento)}). Curto prazo R$ ${fmtValor(fromCents(m.cp))}, longo prazo R$ ${fmtValor(fromCents(m.lp))}.`;
      return { resumo, previa: [{ data, competencia: primeiroDiaDoMes(data), historico: m.historico, partidas: m.partidas }] as LancPrevia[] };
    } catch (e) {
      return { resumo: "", previa: (e as Error).message };
    }
  })();
  const { resumo, previa } = calc;
  const enviar = () => iniciar(async () => {
    const r = await criarParcelamentoAction(empresaId, input);
    if (r.erro) return void toast.error(r.erro);
    toast.success("Parcelamento registrado: as parcelas estão em Títulos a pagar.");
    onFeito();
    router.refresh();
  });

  return (
    <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); enviar(); }}>
      <div className="grid gap-2">
        <Label htmlFor="pc-desc">Tributo/origem</Label>
        <Input id="pc-desc" value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Ex.: Simples Nacional 2025 (parcelamento ordinário)" required />
      </div>
      <div className="grid grid-cols-3 gap-3">
        {([["pc-principal", "Principal", principal, setPrincipal], ["pc-multa", "Multa", multa, setMulta], ["pc-juros", "Juros", juros, setJuros]] as const).map(([id, rotulo, v, set]) => (
          <div key={id} className="grid gap-2">
            <Label htmlFor={id}>{rotulo} (R$)</Label>
            <Input id={id} value={v} onChange={(e) => set(e.target.value)} inputMode="decimal" placeholder="0,00" />
          </div>
        ))}
      </div>
      <p className="-mt-2 text-sm text-muted-foreground tabular-nums">Dívida consolidada: R$ {fmtValor(fromCents(total))}</p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="grid gap-2">
          <Label htmlFor="pc-n">Parcelas</Label>
          <Input id="pc-n" type="number" min={1} max={240} value={nParcelas} onChange={(e) => setNParcelas(e.target.value)} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="pc-valor">Valor da parcela</Label>
          <Input id="pc-valor" value={valorParcela} onChange={(e) => setValorParcela(e.target.value)} inputMode="decimal"
            placeholder={total && n ? valorParaInput(fromCents(parcelaSugerida(total, n))) : "0,00"} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="pc-primeiro">1º vencimento</Label>
          <Input id="pc-primeiro" type="date" value={primeiro} onChange={(e) => setPrimeiro(e.target.value)} required />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="pc-data">Data do parcelamento</Label>
          <Input id="pc-data" type="date" value={data} onChange={(e) => setData(e.target.value)} required />
        </div>
      </div>
      <fieldset className="grid gap-2">
        <legend className="mb-2 text-sm font-medium">Principal</legend>
        <div className="inline-flex w-fit rounded-lg border bg-muted p-[3px] text-xs">
          {([[true, "Baixa a obrigação já reconhecida"], [false, "Reconhece a despesa do tributo"]] as const).map(([k, r]) => (
            <button key={String(k)} type="button"
              onClick={() => { setJaReconhecido(k); setContaPrincipal(k ? por(contas, "2.1", /^simples nacional a recolher$/) : por(contas, "3.1", /deduc/)); }}
              className={`rounded-md px-2.5 py-1 font-medium transition-colors ${jaReconhecido === k ? "bg-card text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"}`}>
              {r}
            </button>
          ))}
        </div>
        <ContaSelect contas={jaReconhecido ? aRecolher : despesas} value={contaPrincipal} onChange={setContaPrincipal}
          placeholder={jaReconhecido ? "Imposto a recolher original" : "Despesa do tributo"} />
        <p className="text-xs text-muted-foreground">
          {jaReconhecido
            ? "O débito tira a dívida da conta a recolher original (a obrigação já estava no razão)."
            : "Use quando o tributo nunca foi reconhecido na competência dele."}
        </p>
        {naConta.length > 0 && (
          <div className="grid gap-1 rounded-lg border p-2">
            <p className="text-xs font-medium">Obrigações em aberto nesta conta: marque as que o parcelamento substitui (ficam quitadas por ele)</p>
            {naConta.map((o) => (
              <label key={o.id} className="flex items-center gap-2 text-sm">
                <Checkbox checked={consolidar.includes(o.id)} onCheckedChange={(c) => marcar(o.id, !!c)} />
                <span className="min-w-0 flex-1 truncate">{o.descricao}{o.vencimento && <span className="text-muted-foreground"> · vence {fmtData(o.vencimento)}</span>}</span>
                <span className="tabular-nums">R$ {fmtValor(o.saldo)}</span>
              </label>
            ))}
          </div>
        )}
      </fieldset>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label>Multa (despesa)</Label>
          <ContaSelect contas={despesas} value={contaMulta} onChange={setContaMulta} />
        </div>
        <div className="grid gap-2">
          <Label>Juros (despesa)</Label>
          <ContaSelect contas={despesas} value={contaJuros} onChange={setContaJuros} />
        </div>
        <div className="grid gap-2">
          <Label>Parcelamento curto prazo</Label>
          <ContaSelect contas={contas.filter((c) => /^2\.1\./.test(c.codigo) && !c.papel)} value={contaCp} onChange={setContaCp} />
        </div>
        <div className="grid gap-2">
          <Label>Parcelamento longo prazo</Label>
          <ContaSelect contas={contas.filter((c) => /^2\.2\./.test(c.codigo) && !c.papel)} value={contaLp} onChange={setContaLp} />
        </div>
      </div>
      {resumo && <p className="text-sm text-muted-foreground">{resumo}</p>}
      <PreviaLancamentos previa={previa} contas={contas} fechados={fechados} />
      <Button type="submit" disabled={pendente || typeof previa === "string" || descricao.trim().length < 3}>
        <Save />
        {pendente ? "Registrando..." : "Registrar parcelamento"}
      </Button>
    </form>
  );
}

/** "Transferir para curto prazo": prévia das parcelas que passam a vencer em até 12 meses e um clique para mover. */
function TransferirCurtoPrazo({ empresaId, contas, fechados }: { empresaId: string; contas: ContaOpcao[]; fechados: string[] }) {
  const router = useRouter();
  const [aberta, setAberta] = useState(false);
  const [data, setData] = useState(hoje());
  const [movs, setMovs] = useState<MovimentoCurtoPrazo[] | null>(null);
  const [erro, setErro] = useState<string>();
  const [pendente, iniciar] = useTransition();
  const carregar = (d: string) => iniciar(async () => {
    setErro(undefined);
    const r = await transferirCurtoPrazoAction(empresaId, { data: d, aplicar: false });
    if (r.erro) { setMovs(null); return setErro(r.erro); }
    setMovs(r.movimentos ?? []);
  });
  const total = movs?.reduce((s, m) => s + m.valor, 0) ?? 0;
  const aplicar = () => iniciar(async () => {
    const r = await transferirCurtoPrazoAction(empresaId, { data, aplicar: true, esperado: total });
    if (r.erro) return setErro(r.erro);
    toast.success(`Transferido para o curto prazo: R$ ${fmtValor(fromCents(total))}.`);
    setAberta(false);
    router.refresh();
  });
  const previa = montarPrevia(() => {
    if (!movs?.length) throw new Error("Nenhuma parcela do longo prazo vence em até 12 meses desta data.");
    return movs.map((m) => ({
      data, competencia: primeiroDiaDoMes(data), historico: `Transferência para o curto prazo: ${m.descricao}`,
      partidas: [{ contaId: m.contaLpId, debito: fromCents(m.valor) }, { contaId: m.contaCpId, credito: fromCents(m.valor) }],
    }));
  });
  return (
    <Dialog open={aberta} onOpenChange={(a) => { setAberta(a); if (a) carregar(data); }}>
      <DialogTrigger render={<Button variant="outline" />}>
        <ArrowDownToLine />
        Transferir para curto prazo
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Transferir para o curto prazo</DialogTitle>
          <DialogDescription>Parcelas no longo prazo que vencem em até 12 meses da data passam para o curto prazo (D LP / C CP).</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2 sm:w-48">
          <Label htmlFor="cp-data">Data</Label>
          <Input id="cp-data" type="date" value={data} onChange={(e) => { setData(e.target.value); if (e.target.value) carregar(e.target.value); }} />
        </div>
        {movs && movs.length > 0 && (
          <ul className="grid gap-1 text-sm">
            {movs.map((m) => (
              <li key={m.parcelamentoId} className="flex justify-between gap-3">
                <span>{m.descricao}: parcela{m.parcelas.length > 1 ? "s" : ""} {m.parcelas.join(", ")}</span>
                <span className="tabular-nums">R$ {fmtValor(fromCents(m.valor))}</span>
              </li>
            ))}
          </ul>
        )}
        {erro && <p className="text-sm text-danger">{erro}</p>}
        <PreviaLancamentos previa={pendente && !movs ? "Calculando..." : previa} contas={contas} fechados={fechados} />
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancelar</DialogClose>
          <Button onClick={aplicar} disabled={pendente || typeof previa === "string"}>
            <ArrowDownToLine />
            {pendente ? "Aguarde..." : "Transferir"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CancelarParcelamento({ empresaId, p }: { empresaId: string; p: ParcelamentoLinha }) {
  const router = useRouter();
  const [aberta, setAberta] = useState(false);
  const [pendente, iniciar] = useTransition();
  const cancelar = () => iniciar(async () => {
    const r = await cancelarParcelamentoAction(empresaId, p.id);
    if (r.erro) return void toast.error(r.erro);
    toast.success("Parcelamento cancelado.");
    setAberta(false);
    router.refresh();
  });
  return (
    <Dialog open={aberta} onOpenChange={setAberta}>
      <DialogTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Cancelar parcelamento" title="Cancelar parcelamento" />}>
        <Ban />
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancelar o parcelamento {p.descricao}?</DialogTitle>
          <DialogDescription>
            O reconhecimento e as transferências para o curto prazo são estornados (no mês de cada um, se aberto; senão hoje) e as parcelas canceladas.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Voltar</DialogClose>
          <Button variant="destructive" disabled={pendente} onClick={cancelar}>
            <Ban />
            {pendente ? "Cancelando..." : "Cancelar parcelamento"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
