"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeftRight, Ban, Check, FilePlus2, HandCoins, Info, Plus, Trash2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import type { EstadoForm } from "@/actions/empresas";
import {
  aprovarClassificacao, baixarTitulosPelaTransacao, criarContaAIdentificar, ignorarTransacao, lancarDiretaAction, marcarTransferencia,
  reclassificar, reconhecerEBaixarAction, type ClassificacaoInput,
} from "@/actions/conciliacao";
import { ContaSelect, type ContaOpcao } from "@/components/conta-select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Valor } from "@/components/valor";
import { cents, fmtCompetencia, fmtData, fmtValor, fromCents, hoje, parseValorBR, primeiroDiaDoMes, valorParaInput } from "@/lib/format";
import { SINAIS, TIPOS_MATCH, type Sinal, type TipoMatch } from "@/lib/classificacao/regras";
import {
  competenciaSeparada, contaPadrao, contasDaOperacao, contasDiferencaPadrao, dataReconhecimento, distribuirBaixa, explicacao,
  historicoBaixa, historicoTitulo, lancamentosDireta, NOMES_A_IDENTIFICAR, OPERACOES, operacaoDaConta, operacoesPara,
  PAI_A_IDENTIFICAR, partidasBaixas, partidasClassificacao, partidasTitulo, rankearTitulos, type LancPrevia, type Operacao,
  type TipoTitulo,
} from "@/lib/operacoes";
import { avisosSemTitulo } from "@/lib/sem-titulo";
import { AvisoSemTitulo } from "./aviso-sem-titulo";
import { montarPrevia, PreviaLancamentos } from "./previa-lancamentos";
import type { ConciliadaLinha, TituloAberto, TransacaoLinha } from "./queries";

const selectCls =
  "h-9 w-full cursor-pointer rounded-md border border-input bg-card px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";
const centavos = (s: string) => cents(parseValorBR(s) || 0);
const reais = (s: string) => fromCents(centavos(s));
const alertaCls = "border-warning/25 bg-warning-soft text-warning *:data-[slot=alert-description]:text-warning/90";
/** Contraparte padrão do título: o memo sem o prefixo do tipo de operação bancária. */
const contraparteDoMemo = (memo: string) =>
  memo.replace(/^((pix|ted|doc|tev|boleto|pagto|pagamento|pag|transf\w*|recebid[oa]|enviad[oa]|rec|env)\b[\s:-]*)+/gi, "").trim().slice(0, 80) || memo.slice(0, 80);

/** Dados da empresa que o painel usa: contas, títulos, meses fechados e saldo das contas de imposto. */
export type ContextoPainel = {
  contas: ContaOpcao[]; titulos: TituloAberto[]; fechados: string[]; saldosImpostos: Record<string, string>;
};

type Props = {
  empresaId: string;
  transacao: TransacaoLinha | null;
  onClose: () => void;
  todas: TransacaoLinha[];
  ctx: ContextoPainel;
};

export function PainelTransacao({ transacao: t, onClose, ...rest }: Props) {
  return (
    <Sheet open={!!t} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full gap-0 overflow-y-auto data-[side=right]:sm:max-w-[560px]">
        {t && <Conteudo t={t} onClose={onClose} {...rest} />}
      </SheetContent>
    </Sheet>
  );
}

/** Só a classificação, preenchida com o lançamento atual; ao enviar estorna e reclassifica. */
export function PainelReclassificar({ empresaId, transacao: c, contas, fechados, onClose }: {
  empresaId: string; transacao: ConciliadaLinha | null; contas: ContaOpcao[]; fechados: string[]; onClose: () => void;
}) {
  return (
    <Sheet open={!!c} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full gap-0 overflow-y-auto data-[side=right]:sm:max-w-[560px]">
        {c && <Reclassificar c={c} empresaId={empresaId} contas={contas} fechados={fechados} onClose={onClose} />}
      </SheetContent>
    </Sheet>
  );
}

function useExecutar(onClose: () => void) {
  const router = useRouter();
  const [pendente, iniciar] = useTransition();
  const executar = (acao: () => Promise<EstadoForm & { aviso?: string }>, sucesso: string) =>
    iniciar(async () => {
      const r = await acao();
      if (r.erro) return void toast.error(r.erro);
      if (r.aviso) toast.success(sucesso, { description: r.aviso });
      else toast.success(sucesso);
      onClose();
      router.refresh();
    });
  return [pendente, executar] as const;
}

function Reclassificar({ c, empresaId, contas, fechados, onClose }: {
  c: ConciliadaLinha; empresaId: string; contas: ContaOpcao[]; fechados: string[]; onClose: () => void;
}) {
  const [pendente, executar] = useExecutar(onClose);
  const t = { ...c, id: c.transacaoId };
  // mesma regra do servidor (dataNoMesAberto): mês do extrato fechado → hoje
  const data = fechados.includes(primeiroDiaDoMes(t.data)) ? hoje() : t.data;
  return (
    <>
      <Cabecalho t={t} />
      <div className="px-6 py-5">
        <p className="mb-3 text-xs text-muted-foreground">
          O lançamento {c.numero} é estornado e um novo é criado com a classificação abaixo, na data do extrato enquanto o mês estiver aberto; com o mês fechado, vão para hoje (se o mês atual também estiver fechado, reabra-o em Fechamento).
        </p>
        <Classificar t={t} contas={contas} todasContas={contas} fechados={fechados} pendente={pendente} dataLancamento={data}
          inicial={{
            linhas: c.contras.map((x) => ({ contaId: x.contaId, valor: valorParaInput(x.valor) })),
            historico: c.historico, documento: c.documento ?? "", competencia: c.competencia.slice(0, 7),
          }}
          enviar={(input) => executar(() => reclassificar(empresaId, input), "Transação reclassificada.")} />
      </div>
    </>
  );
}

type TransacaoBase = Pick<TransacaoLinha, "id" | "data" | "valor" | "memo" | "contaBancariaNome" | "contaContabilId">
  & Partial<Pick<TransacaoLinha, "sugestaoOrigem" | "sugestaoContaId" | "sugestaoHistorico" | "sugestaoJustificativa">>;

function Cabecalho({ t }: { t: TransacaoBase }) {
  const entrada = cents(t.valor) > 0;
  return (
    <SheetHeader className="gap-2 bg-muted/40 pr-12">
      <div className="flex items-center gap-2">
        <Badge variant={entrada ? "success" : "danger"}>{entrada ? "Entrada" : "Saída"}</Badge>
        <span className="text-xs text-muted-foreground">{fmtData(t.data)} · {t.contaBancariaNome}</span>
      </div>
      <SheetTitle className="font-display text-2xl tracking-[-0.02em]">
        <span className="mr-1 text-base font-medium text-muted-foreground">R$</span>
        <Valor v={t.valor} className="font-semibold" />
      </SheetTitle>
      <SheetDescription className="break-words">{t.memo || "(sem memo)"}</SheetDescription>
    </SheetHeader>
  );
}

type Escolha = Operacao | "ignorar";
const GRUPOS = ["Resultado", "Títulos", "Movimentos", "Outros"] as const;

/**
 * Operação inicial: título em aberto com o saldo exato (a IA não vê títulos), a da IA (já validada no servidor), a
 * derivada da conta sugerida ou receita/despesa direta.
 */
function operacaoInicial(t: TransacaoLinha, ctx: ContextoPainel, entrada: boolean): Operacao {
  if (t.sugestaoOrigem === "transferencia") return "transferencia";
  const v = Math.abs(cents(t.valor));
  if (ctx.titulos.some((x) => x.tipo === (entrada ? "receber" : "pagar") && cents(x.saldo) === v)) return entrada ? "baixa_receber" : "baixa_pagar";
  const contas = ctx.contas;
  if (t.sugestaoOperacao && operacoesPara(entrada).includes(t.sugestaoOperacao)) return t.sugestaoOperacao;
  return operacaoDaConta(contas.find((c) => c.id === t.sugestaoContaId), entrada) ?? (entrada ? "receita_direta" : "despesa_direta");
}

function Conteudo({ t, empresaId, onClose, todas, ctx }: Omit<Props, "transacao"> & { t: TransacaoLinha }) {
  const [pendente, executar] = useExecutar(onClose);
  const entrada = cents(t.valor) > 0;
  const [contas, setContas] = useState(ctx.contas);
  const [op, setOp] = useState<Escolha>(() => operacaoInicial(t, ctx, entrada));
  const tipo: TipoTitulo = entrada ? "receber" : "pagar";
  const papelId = contas.find((c) => c.papel === (entrada ? "clientes" : "fornecedores"))?.id ?? null;
  const sugerida = t.sugestaoOrigem && t.sugestaoOrigem !== "transferencia" ? t.sugestaoContaId : null;
  const ops = operacoesPara(entrada);
  const classificar = (input: ClassificacaoInput, operacao: Operacao) =>
    executar(() => aprovarClassificacao(empresaId, { ...input, operacao }), "Transação classificada.");
  const comuns = { t, todasContas: contas, fechados: ctx.fechados, pendente };

  const corpo = () => {
    if (op === "ignorar")
      return <Ignorar pendente={pendente} enviar={(motivo) => executar(() => ignorarTransacao(empresaId, t.id, motivo), "Transação ignorada.")} />;
    if (op === "transferencia")
      return (
        <Transferencia {...comuns} contas={contasDaOperacao("transferencia", contas, entrada)}
          candidatas={todas.filter((o) => o.contaBancariaId !== t.contaBancariaId && cents(o.valor) === -cents(t.valor))}
          parar={(parId) => executar(() => marcarTransferencia(empresaId, { transacaoId: t.id, parId }), "Transferência registrada.")}
          semPar={(input) => classificar(input, "transferencia")} />
      );
    if (op === "baixa_receber" || op === "baixa_pagar")
      return (
        <BaixaTitulos {...comuns} tipo={tipo} contas={contas} papelId={papelId} empresaId={empresaId} executar={executar}
          titulos={ctx.titulos.filter((x) => x.tipo === tipo)}
          direto={op === "baixa_pagar" ? (input) => classificar(input, "baixa_pagar") : undefined} />
      );
    const doGrupo = contasDaOperacao(op, contas, entrada);
    if (op === "a_identificar" && !doGrupo.length)
      return <CriarAIdentificar empresaId={empresaId} entrada={entrada} onCriada={(c) => setContas((cs) => [...cs, c])} />;
    const direta = op === "receita_direta" || op === "despesa_direta";
    return (
      <Classificar key={op} {...comuns} contas={doGrupo} operacao={op} contaInicial={contaPadrao(op, contas, entrada, sugerida)}
        papelId={direta ? papelId : undefined}
        saldosImpostos={op === "baixa_imposto" ? ctx.saldosImpostos : undefined}
        onBaixarTitulo={ctx.titulos.some((x) => x.tipo === tipo) ? () => setOp(entrada ? "baixa_receber" : "baixa_pagar") : undefined}
        enviar={(input, separada) =>
          separada
            ? executar(() => lancarDiretaAction(empresaId, {
              transacaoId: t.id, partidas: input.partidas, historico: input.historico, documento: input.documento ?? "",
              competencia: input.competencia ?? t.data.slice(0, 7), contraparte: input.contraparte ?? t.memo,
            }), "Reconhecido e baixado.")
            : classificar(input, op)} />
    );
  };

  return (
    <>
      <Cabecalho t={t} />
      <div className="grid gap-4 px-6 py-5">
        <div className="grid gap-1.5">
          <Label htmlFor="operacao">Operação</Label>
          <select id="operacao" className={selectCls} value={op} onChange={(e) => setOp(e.target.value as Escolha)}>
            {GRUPOS.map((g) => (
              <optgroup key={g} label={g}>
                {ops.filter((o) => OPERACOES[o].grupo === g).map((o) => <option key={o} value={o}>{OPERACOES[o].rotulo}</option>)}
                {g === "Outros" && <option value="ignorar">Ignorar (não gera lançamento)</option>}
              </optgroup>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">
            {op === "ignorar" ? "Linha que não é movimento (saldo do dia, duplicada). Pode ser reativada na aba Ignoradas." : explicacao(op, entrada)}
          </p>
          {t.sugestaoOrigem === "ia" && t.sugestaoJustificativa && (
            <p className="text-xs text-muted-foreground">IA: {t.sugestaoJustificativa}</p>
          )}
        </div>
        {corpo()}
      </div>
    </>
  );
}

type Linha = { contaId: string | null; valor: string };
type EnvioClassificacao = ClassificacaoInput & { contraparte?: string };

function Classificar({ t, contas, todasContas, fechados, pendente, enviar, inicial, onBaixarTitulo, operacao, contaInicial, papelId,
  saldosImpostos, dataLancamento, historicoInicial }: {
  t: TransacaoBase; contas: ContaOpcao[]; todasContas: ContaOpcao[]; fechados: string[]; pendente: boolean;
  /** `separada`: receita/despesa direta com competência em outro mês (reconhece + baixa). */
  enviar: (input: EnvioClassificacao, separada: boolean) => void;
  /** Há título aberto compatível: o aviso de Clientes oferece a baixa. */
  onBaixarTitulo?: () => void;
  /** Reclassificação: valores do lançamento atual; sem "criar regra". */
  inicial?: { linhas: Linha[]; historico: string; documento: string; competencia: string };
  operacao?: Operacao; contaInicial?: string | null;
  /** Receita/despesa direta: conta de papel Clientes/Fornecedores para o reconhecimento em outro mês. */
  papelId?: string | null;
  /** Baixa de imposto: saldo (D − C) de cada conta a recolher. */
  saldosImpostos?: Record<string, string>;
  /** Reclassificação com o mês fechado: o novo lançamento vai para hoje. */
  dataLancamento?: string;
  historicoInicial?: string;
}) {
  const total = Math.abs(cents(t.valor));
  const entrada = cents(t.valor) > 0;
  const [linhas, setLinhas] = useState<Linha[]>(inicial?.linhas ?? [{ contaId: contaInicial ?? null, valor: valorParaInput(fromCents(total)) }]);
  const [historico, setHistorico] = useState(inicial?.historico ?? historicoInicial ?? (t.sugestaoHistorico || t.memo));
  const [documento, setDocumento] = useState(inicial?.documento ?? "");
  const [competencia, setCompetencia] = useState(inicial?.competencia ?? t.data.slice(0, 7));
  const [contraparte, setContraparte] = useState(() => contraparteDoMemo(t.memo));
  const [criaRegra, setCriaRegra] = useState(false);
  const [regra, setRegra] = useState<{ nome: string; tipoMatch: TipoMatch; padrao: string; sinal: Sinal }>({
    nome: t.memo.slice(0, 60), tipoMatch: "memo_contem", padrao: t.memo, sinal: entrada ? "entrada" : "saida",
  });
  const [ciente, setCiente] = useState(false);
  const soma = linhas.reduce((s, l) => s + centavos(l.valor), 0);
  const dif = total - soma;
  const direta = papelId !== undefined;
  const separada = direta && !!competencia && competenciaSeparada(`${competencia}-01`, t.data);
  const avisos = avisosSemTitulo(linhas.map((l) => todasContas.find((c) => c.id === l.contaId)))
    .filter((a) => !(saldosImpostos && a === "impostos"));
  const travado = avisos.includes("clientes") && !ciente;
  const set = (i: number, p: Partial<Linha>) => setLinhas((ls) => ls.map((l, k) => (k === i ? { ...l, ...p } : l)));
  const contras = linhas.map((l) => ({ contaId: l.contaId ?? "", valor: reais(l.valor) }));
  const comp = `${competencia || t.data.slice(0, 7)}-01`;

  const previa = montarPrevia(() => {
    if (linhas.some((l) => !l.contaId)) throw new Error("Escolha a conta em todas as linhas para ver as partidas.");
    if (direta)
      return lancamentosDireta({
        valorTx: t.valor, dataBanco: t.data, contaBancoId: t.contaContabilId, contaPapelId: papelId ?? null, contras,
        competencia: comp, historico, contraparte: contraparte || t.memo,
      });
    return [{ data: dataLancamento ?? t.data, competencia: comp, historico, partidas: partidasClassificacao(t.valor, t.contaContabilId, contras) }];
  });
  const saldoImposto = saldosImpostos && linhas.length === 1 && linhas[0].contaId ? saldosImpostos[linhas[0].contaId] : undefined;

  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        enviar({
          transacaoId: t.id,
          partidas: linhas.map((l) => ({ contaId: l.contaId ?? "", valor: l.valor })),
          historico, documento, competencia,
          criarRegra: criaRegra && !separada ? regra : undefined,
          confirmarSemTitulo: avisos.includes("clientes") && ciente,
          contraparte,
        }, separada);
      }}
    >
      <div className="grid gap-2">
        <Label>Contrapartida{linhas.length > 1 && "s"} ({entrada ? "crédito" : "débito"})</Label>
        {linhas.map((l, i) => (
          <div key={i} className="flex gap-2">
            <ContaSelect contas={contas} value={l.contaId} onChange={(contaId) => set(i, { contaId })} className="min-w-0 flex-1"
              placeholder={contas.length ? "Selecione a conta" : "Nenhuma conta deste grupo no plano"} />
            <Input value={l.valor} onChange={(e) => set(i, { valor: e.target.value })} inputMode="decimal" className="w-32 text-right tabular-nums" aria-label="Valor" />
            <Button type="button" variant="ghost" size="icon-sm" aria-label="Remover linha" disabled={linhas.length === 1}
              onClick={() => setLinhas((ls) => ls.filter((_, k) => k !== i))}>
              <Trash2 />
            </Button>
          </div>
        ))}
        <div className="flex items-center justify-between text-xs">
          <Button type="button" variant="ghost" size="sm"
            onClick={() => setLinhas((ls) => [...ls, { contaId: null, valor: dif > 0 ? valorParaInput(fromCents(dif)) : "" }])}>
            <Plus />
            Dividir
          </Button>
          <span className="tabular-nums text-muted-foreground">
            Soma {fmtValor(fromCents(soma))} · Diferença{" "}
            <span className={cn(dif !== 0 && "font-medium text-danger")}>{fmtValor(fromCents(dif))}</span>
          </span>
        </div>
      </div>
      {saldoImposto !== undefined && <AvisoImposto saldo={saldoImposto} pago={soma} />}
      <AvisoSemTitulo tipos={avisos} ciente={ciente} onCiente={setCiente} onBaixarTitulo={onBaixarTitulo} />
      <div className="grid gap-2">
        <Label htmlFor="historico">Histórico</Label>
        <Input id="historico" value={historico} onChange={(e) => setHistorico(e.target.value)} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-2">
          <Label htmlFor="documento">Documento</Label>
          <Input id="documento" value={documento} onChange={(e) => setDocumento(e.target.value)} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="competencia">Competência</Label>
          <Input id="competencia" type="month" value={competencia} onChange={(e) => setCompetencia(e.target.value)} />
        </div>
      </div>
      {separada && (
        <div className="grid gap-2 rounded-lg border border-info/25 bg-info-soft/50 p-3">
          <p className="text-xs text-info">
            Competência {fmtCompetencia(comp)} ≠ mês do extrato: reconhece em {fmtCompetencia(comp)} (título
            {entrada ? " a receber" : " a pagar"}) e baixa em {fmtData(t.data)}.
          </p>
          <Label htmlFor="contraparte">{entrada ? "Cliente" : "Fornecedor"}</Label>
          <Input id="contraparte" value={contraparte} onChange={(e) => setContraparte(e.target.value)} />
        </div>
      )}
      {!inicial && !separada && (
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={criaRegra} onCheckedChange={(c) => setCriaRegra(!!c)} />
          Criar regra com esta classificação
        </label>
      )}
      {criaRegra && !separada && (
        <div className="grid gap-3 rounded-lg border p-3">
          <div className="grid gap-2">
            <Label htmlFor="regra-nome">Nome da regra</Label>
            <Input id="regra-nome" value={regra.nome} onChange={(e) => setRegra({ ...regra, nome: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="regra-tipo">Tipo</Label>
              <select id="regra-tipo" className={selectCls} value={regra.tipoMatch}
                onChange={(e) => setRegra({ ...regra, tipoMatch: e.target.value as TipoMatch })}>
                {Object.entries(TIPOS_MATCH).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="regra-sinal">Sinal</Label>
              <select id="regra-sinal" className={selectCls} value={regra.sinal}
                onChange={(e) => setRegra({ ...regra, sinal: e.target.value as Sinal })}>
                {Object.entries(SINAIS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="regra-padrao">Padrão</Label>
            <Input id="regra-padrao" value={regra.padrao} onChange={(e) => setRegra({ ...regra, padrao: e.target.value })} />
          </div>
          <p className="text-xs text-muted-foreground">A regra usa a conta da primeira linha e o histórico acima.</p>
        </div>
      )}
      <PreviaLancamentos previa={previa} contas={todasContas} fechados={fechados} />
      <Button type="submit" disabled={pendente || dif !== 0 || travado || typeof previa === "string" || (operacao && !contas.length)}>
        <Check />
        {inicial
          ? (pendente ? "Reclassificando..." : "Reclassificar")
          : pendente ? "Aprovando..." : separada ? "Reconhecer e baixar" : "Aprovar"}
      </Button>
    </form>
  );
}

/** Baixa de imposto: compara o pagamento com o saldo credor (obrigação registrada) da conta. */
function AvisoImposto({ saldo, pago }: { saldo: string; pago: number }) {
  const aberto = -cents(saldo); // credor = obrigação a pagar
  if (aberto >= pago && aberto > 0)
    return (
      <p className="flex gap-1.5 text-xs text-muted-foreground">
        <Info className="mt-0.5 size-3.5 shrink-0" />
        Obrigação registrada de R$ {fmtValor(fromCents(aberto))}; após a baixa ficam R$ {fmtValor(fromCents(aberto - pago))}.
      </p>
    );
  return (
    <Alert className={alertaCls}>
      <TriangleAlert />
      <AlertTitle>Pagamento maior que a obrigação registrada</AlertTitle>
      <AlertDescription>
        A conta tem R$ {fmtValor(fromCents(Math.max(aberto, 0)))} a recolher: a baixa a deixa devedora. Registre a provisão do imposto
        na competência (lançamento manual) ou classifique como Despesa direta (ex.: Impostos e Taxas).
      </AlertDescription>
    </Alert>
  );
}

function CriarAIdentificar({ empresaId, entrada, onCriada }: { empresaId: string; entrada: boolean; onCriada: (c: ContaOpcao) => void }) {
  const [pendente, iniciar] = useTransition();
  const lado = entrada ? "entrada" : "saida";
  return (
    <div className="grid gap-2 rounded-lg border border-dashed p-3 text-sm">
      <p className="text-muted-foreground">
        A empresa ainda não tem a conta “{NOMES_A_IDENTIFICAR[lado]}”. Ela fica em {PAI_A_IDENTIFICAR[lado].codigo}
        {entrada ? " (passivo circulante)" : " (ativo circulante)"} até a origem ser identificada.
      </p>
      <Button type="button" variant="outline" className="w-fit" disabled={pendente}
        onClick={() => iniciar(async () => {
          const r = await criarContaAIdentificar(empresaId, entrada);
          if (r.erro || !r.conta) return void toast.error(r.erro ?? "Erro ao criar a conta.");
          onCriada(r.conta);
        })}>
        <Plus />
        Criar “{NOMES_A_IDENTIFICAR[lado]}”
      </Button>
    </div>
  );
}

type Sel = { id: string; valor: string; juros: string; desconto: string };

function BaixaTitulos({ t, tipo, titulos, contas, todasContas, fechados, papelId, pendente, empresaId, executar, direto }: {
  t: TransacaoLinha; tipo: TipoTitulo; titulos: TituloAberto[]; contas: ContaOpcao[]; todasContas: ContaOpcao[];
  fechados: string[]; papelId: string | null; pendente: boolean; empresaId: string;
  executar: (acao: () => Promise<EstadoForm & { aviso?: string }>, sucesso: string) => void;
  direto?: (input: ClassificacaoInput) => void;
}) {
  const total = Math.abs(cents(t.valor));
  const ranking = rankearTitulos(titulos, { valor: t.valor, data: t.data, memo: t.memo });
  const [sel, setSel] = useState<Sel[]>(() =>
    ranking[0]?.exato ? [{ id: ranking[0].id, valor: valorParaInput(ranking[0].saldo), juros: "", desconto: "" }] : []);
  // sugestão direto em Fornecedores (boleto/PIX a PF) sem título parecido: abre em "Sem título"
  const relevante = ranking.some((r) => r.exato || r.nomeParecido);
  const [modo, setModo] = useState<"titulos" | "reconhecer" | "direto">(
    relevante ? "titulos" : direto && papelId && t.sugestaoContaId === papelId ? "direto" : ranking.length ? "titulos" : "reconhecer");
  const padrao = contasDiferencaPadrao(contas, tipo);
  const [contaJuros, setContaJuros] = useState<string | null>(padrao.juros);
  const [contaDesconto, setContaDesconto] = useState<string | null>(padrao.desconto);
  const porId = new Map(ranking.map((r) => [r.id, r]));

  const marcar = (id: string, marcado: boolean) =>
    setSel((s) => {
      const ids = marcado ? [...s.map((x) => x.id), id] : s.map((x) => x.id).filter((x) => x !== id);
      // redistribui o valor da transação pelos marcados, na ordem em que foram marcados
      const dist = distribuirBaixa(ids.map((x) => cents(porId.get(x)!.saldo)), total);
      return ids.map((x, i) => ({ id: x, valor: valorParaInput(fromCents(dist[i].valor)), juros: dist[i].juros ? valorParaInput(fromCents(dist[i].juros)) : "", desconto: "" }));
    });
  const setItem = (id: string, p: Partial<Sel>) => setSel((s) => s.map((x) => (x.id === id ? { ...x, ...p } : x)));
  const itens = sel.map((s) => ({ tituloId: s.id, valor: reais(s.valor), juros: reais(s.juros), desconto: reais(s.desconto) }));
  const somaBanco = sel.reduce((x, s) => x + centavos(s.valor) + centavos(s.juros) - centavos(s.desconto), 0);
  const dif = total - somaBanco;
  const temJuros = sel.some((s) => centavos(s.juros) > 0);
  const temDesconto = sel.some((s) => centavos(s.desconto) > 0);
  const passa = sel.find((s) => centavos(s.valor) > cents(porId.get(s.id)?.saldo ?? 0));

  const previa = montarPrevia(() => {
    if (!sel.length) throw new Error("Marque o(s) título(s) que esta transação paga.");
    if (!papelId) throw new Error(`Marque a conta de papel ${tipo === "receber" ? "Clientes" : "Fornecedores"} no plano de contas.`);
    if (passa) throw new Error(`O valor a abater de ${porId.get(passa.id)?.contraparte} passa do saldo em aberto.`);
    if (dif !== 0) throw new Error(`A baixa soma ${fmtValor(fromCents(somaBanco))}; a transação é ${fmtValor(fromCents(total))}. Ajuste o abatimento, os juros ou o desconto.`);
    return [{
      data: t.data, competencia: primeiroDiaDoMes(t.data),
      historico: historicoBaixa(tipo, sel.map((s) => porId.get(s.id)!)),
      partidas: partidasBaixas({
        tipo, contaBancoId: t.contaContabilId, contaPapelId: papelId, itens,
        contaJurosId: temJuros ? contaJuros : null, contaDescontoId: temDesconto ? contaDesconto : null,
      }),
    }];
  });

  return (
    <div className="grid gap-3">
      <div className="inline-flex w-fit rounded-lg border bg-muted p-[3px] text-xs">
        {([["titulos", `Títulos em aberto (${ranking.length})`], ["reconhecer", "Reconhecer agora"], ...(direto ? [["direto", "Sem título"]] : [])] as const)
          .map(([k, r]) => (
            <button key={k} type="button" onClick={() => setModo(k as typeof modo)}
              className={cn("rounded-md px-2.5 py-1 font-medium text-muted-foreground transition-colors hover:text-foreground", modo === k && "bg-card text-foreground shadow-xs")}>
              {r}
            </button>
          ))}
      </div>

      {modo === "titulos" && (ranking.length === 0 ? (
        <Alert className={alertaCls}>
          <TriangleAlert />
          <AlertTitle>Nenhum título {tipo === "receber" ? "a receber" : "a pagar"} em aberto</AlertTitle>
          <AlertDescription className="grid gap-2">
            <p>Reconheça o {tipo === "receber" ? "direito" : "obrigação"} agora, na competência, e baixe com esta transação.</p>
            <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => setModo("reconhecer")}>
              <FilePlus2 />
              Reconhecer agora
            </Button>
          </AlertDescription>
        </Alert>
      ) : (
        <>
          <div className="grid max-h-80 gap-1 overflow-y-auto">
            {ranking.map((x) => {
              const s = sel.find((y) => y.id === x.id);
              return (
                <div key={x.id} className={cn("rounded-md border text-sm transition-colors", s ? "border-primary bg-accent/60" : "hover:bg-muted/50")}>
                  <label className="flex cursor-pointer items-center gap-2 px-3 py-2">
                    <Checkbox checked={!!s} onCheckedChange={(c) => marcar(x.id, !!c)} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">
                        <span className="font-medium">{x.contraparte}</span> · {x.descricao}
                        {x.documento && <span className="text-muted-foreground"> · {x.documento}</span>}
                      </span>
                      <span className="flex flex-wrap gap-1.5 pt-0.5 text-xs text-muted-foreground">
                        {x.vencimento ? `vence ${fmtData(x.vencimento)}` : `competência ${fmtCompetencia(x.competencia)}`}
                        {x.exato && <Badge variant="success">Valor exato</Badge>}
                        {x.nomeParecido && <Badge variant="info">Nome no memo</Badge>}
                        {x.status === "parcial" && <Badge variant="muted">Parcial, de {fmtValor(x.valor)}</Badge>}
                      </span>
                    </span>
                    <span className="tabular-nums">{fmtValor(x.saldo)}</span>
                  </label>
                  {s && (
                    <div className="grid grid-cols-3 gap-2 border-t px-3 py-2">
                      {(["valor", "juros", "desconto"] as const).map((k) => (
                        <label key={k} className="grid gap-1 text-xs text-muted-foreground">
                          {k === "valor" ? "Abater" : k === "juros" ? "Juros/multa" : "Desconto"}
                          <Input value={s[k]} onChange={(e) => setItem(x.id, { [k]: e.target.value })} inputMode="decimal"
                            className="h-8 text-right tabular-nums" placeholder="0,00" />
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <p className="text-right text-xs tabular-nums text-muted-foreground">
            Baixa {fmtValor(fromCents(somaBanco))} · Diferença <span className={cn(dif !== 0 && "font-medium text-danger")}>{fmtValor(fromCents(dif))}</span>
            {sel.some((s) => centavos(s.valor) < cents(porId.get(s.id)?.saldo ?? 0)) && " · baixa parcial: o título continua em aberto pelo restante"}
          </p>
          {temJuros && (
            <div className="grid gap-2">
              <Label>Conta dos juros/multa</Label>
              <ContaSelect contas={contas} value={contaJuros} onChange={setContaJuros} placeholder={tipo === "receber" ? "Juros ativos" : "Juros passivos"} />
            </div>
          )}
          {temDesconto && (
            <div className="grid gap-2">
              <Label>Conta do desconto</Label>
              <ContaSelect contas={contas} value={contaDesconto} onChange={setContaDesconto} placeholder={tipo === "receber" ? "Descontos concedidos" : "Descontos obtidos"} />
            </div>
          )}
          <PreviaLancamentos previa={previa} contas={todasContas} fechados={fechados} />
          <Button disabled={pendente || typeof previa === "string"}
            onClick={() => executar(() => baixarTitulosPelaTransacao(empresaId, {
              transacaoId: t.id, itens: sel.map((s) => ({ tituloId: s.id, valor: s.valor, juros: s.juros, desconto: s.desconto })),
              contaJurosId: temJuros ? contaJuros : null, contaDescontoId: temDesconto ? contaDesconto : null,
            }), sel.length > 1 ? `${sel.length} títulos baixados.` : "Título baixado.")}>
            <HandCoins />
            {pendente ? "Baixando..." : sel.length > 1 ? `Baixar ${sel.length} títulos` : "Baixar título"}
          </Button>
        </>
      ))}

      {modo === "reconhecer" && (
        <Reconhecer t={t} tipo={tipo} contas={contas} fechados={fechados} papelId={papelId} pendente={pendente}
          enviar={(input) => executar(() => reconhecerEBaixarAction(empresaId, input), "Título reconhecido e baixado.")} />
      )}

      {modo === "direto" && direto && (
        <Classificar t={t} contas={contasDaOperacao("baixa_pagar", contas, false)} todasContas={todasContas} fechados={fechados}
          pendente={pendente} operacao="baixa_pagar" contaInicial={papelId} enviar={(input) => direto(input)} />
      )}
    </div>
  );
}

/** "Reconhecer agora": cria o título na competência (D Clientes / C receita ou D despesa / C Fornecedores) e baixa já. */
function Reconhecer({ t, tipo, contas, fechados, papelId, pendente, enviar }: {
  t: TransacaoLinha; tipo: TipoTitulo; contas: ContaOpcao[]; fechados: string[]; papelId: string | null; pendente: boolean;
  enviar: (input: Parameters<typeof reconhecerEBaixarAction>[1]) => void;
}) {
  const valor = fromCents(Math.abs(cents(t.valor)));
  const doGrupo = contasDaOperacao(tipo === "receber" ? "receita_direta" : "despesa_direta", contas, tipo === "receber");
  const sugerida = doGrupo.some((c) => c.id === t.sugestaoContaId) ? t.sugestaoContaId : null;
  const [contraparte, setContraparte] = useState(() => contraparteDoMemo(t.memo));
  const [descricao, setDescricao] = useState(t.sugestaoHistorico || t.memo);
  const [documento, setDocumento] = useState("");
  const [competencia, setCompetencia] = useState(t.data.slice(0, 7));
  const [vencimento, setVencimento] = useState("");
  const [contaId, setContaId] = useState<string | null>(sugerida);
  const comp = `${competencia || t.data.slice(0, 7)}-01`;

  const previa = montarPrevia((): LancPrevia[] => {
    if (!contaId) throw new Error(`Escolha a conta de ${tipo === "receber" ? "receita" : "custo ou despesa"} do título.`);
    if (!papelId) throw new Error(`Marque a conta de papel ${tipo === "receber" ? "Clientes" : "Fornecedores"} no plano de contas.`);
    return [
      {
        data: dataReconhecimento(comp, t.data), competencia: comp, historico: historicoTitulo(tipo, contraparte, descricao),
        partidas: partidasTitulo(tipo, papelId, contaId, valor),
      },
      {
        data: t.data, competencia: primeiroDiaDoMes(t.data), historico: historicoBaixa(tipo, [{ contraparte, descricao }]),
        partidas: partidasBaixas({ tipo, contaBancoId: t.contaContabilId, contaPapelId: papelId, itens: [{ valor }] }),
      },
    ];
  });

  return (
    <form className="grid gap-3" onSubmit={(e) => {
      e.preventDefault();
      if (contaId) enviar({ transacaoId: t.id, contraparte, descricao, documento, competencia, vencimento, linhas: [{ contaId, valor }] });
    }}>
      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-2">
          <Label htmlFor="rec-contraparte">{tipo === "receber" ? "Cliente" : "Fornecedor"}</Label>
          <Input id="rec-contraparte" value={contraparte} onChange={(e) => setContraparte(e.target.value)} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="rec-documento">Documento</Label>
          <Input id="rec-documento" value={documento} onChange={(e) => setDocumento(e.target.value)} placeholder="Nº da nota" />
        </div>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="rec-descricao">Descrição</Label>
        <Input id="rec-descricao" value={descricao} onChange={(e) => setDescricao(e.target.value)} />
      </div>
      <div className="grid gap-2">
        <Label>{tipo === "receber" ? "Conta de receita" : "Conta de custo ou despesa"}</Label>
        <ContaSelect contas={doGrupo} value={contaId} onChange={setContaId} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-2">
          <Label htmlFor="rec-competencia">Competência</Label>
          <Input id="rec-competencia" type="month" value={competencia} onChange={(e) => setCompetencia(e.target.value)} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="rec-vencimento">Vencimento</Label>
          <Input id="rec-vencimento" type="date" value={vencimento} onChange={(e) => setVencimento(e.target.value)} />
        </div>
      </div>
      <PreviaLancamentos previa={previa} contas={contas} fechados={fechados} />
      <Button type="submit" disabled={pendente || typeof previa === "string" || contraparte.trim().length === 0 || descricao.trim().length < 3}>
        <FilePlus2 />
        {pendente ? "Lançando..." : "Reconhecer e baixar"}
      </Button>
    </form>
  );
}

function Transferencia({ t, candidatas, contas, todasContas, fechados, pendente, parar, semPar }: {
  t: TransacaoLinha; candidatas: TransacaoLinha[]; contas: ContaOpcao[]; todasContas: ContaOpcao[]; fechados: string[];
  pendente: boolean; parar: (parId: string) => void; semPar: (input: ClassificacaoInput) => void;
}) {
  const [parId, setParId] = useState(candidatas.some((c) => c.id === t.transferenciaParId) ? t.transferenciaParId! : (candidatas.length === 1 ? candidatas[0].id : ""));
  const [modo, setModo] = useState<"par" | "sem">(candidatas.length ? "par" : "sem");
  const par = candidatas.find((c) => c.id === parId);
  const [origem, destino] = cents(t.valor) < 0 ? [t, par] : [par, t];
  const previa = montarPrevia((): LancPrevia[] => {
    if (!par || !origem || !destino) throw new Error("Escolha a transação par.");
    const v = fromCents(Math.abs(cents(t.valor)));
    return [{
      data: origem.data, competencia: primeiroDiaDoMes(origem.data), historico: "Transferência entre contas",
      partidas: [{ contaId: destino.contaContabilId, debito: v }, { contaId: origem.contaContabilId, credito: v }],
    }];
  });
  return (
    <div className="grid gap-3">
      <div className="inline-flex w-fit rounded-lg border bg-muted p-[3px] text-xs">
        {([["par", `Com o par (${candidatas.length})`], ["sem", "Sem par"]] as const).map(([k, r]) => (
          <button key={k} type="button" onClick={() => setModo(k)}
            className={cn("rounded-md px-2.5 py-1 font-medium text-muted-foreground transition-colors hover:text-foreground", modo === k && "bg-card text-foreground shadow-xs")}>
            {r}
          </button>
        ))}
      </div>
      {modo === "par" ? (
        candidatas.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma transação pendente de outra conta com valor oposto. Use “Sem par” para lançar na conta de transferências.</p>
        ) : (
          <>
            <div className="grid gap-2">
              <Label htmlFor="par">Transação par</Label>
              <select id="par" className={selectCls} value={parId} onChange={(e) => setParId(e.target.value)}>
                <option value="">Selecione</option>
                {candidatas.map((c) => (
                  <option key={c.id} value={c.id}>
                    {fmtData(c.data)} · {c.contaBancariaNome} · {fmtValor(c.valor)} · {c.memo.slice(0, 50)}
                  </option>
                ))}
              </select>
            </div>
            <PreviaLancamentos previa={previa} contas={todasContas} fechados={fechados} />
            <Button disabled={pendente || !parId} onClick={() => parar(parId)}>
              <ArrowLeftRight />
              {pendente ? "Registrando..." : "Marcar transferência"}
            </Button>
          </>
        )
      ) : (
        <Classificar t={t} contas={contas} todasContas={todasContas} fechados={fechados} pendente={pendente} operacao="transferencia"
          contaInicial={contas[0]?.id} historicoInicial="Transferência entre contas (sem par)" enviar={(input) => semPar(input)} />
      )}
    </div>
  );
}

function Ignorar({ pendente, enviar }: { pendente: boolean; enviar: (motivo: string) => void }) {
  const [motivo, setMotivo] = useState("");
  return (
    <div className="grid gap-3">
      <div className="grid gap-2">
        <Label htmlFor="motivo">Motivo (opcional)</Label>
        <Input id="motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex.: lançamento duplicado no extrato" />
      </div>
      <Button variant="outline" disabled={pendente} onClick={() => enviar(motivo)}>
        <Ban />
        Ignorar transação
      </Button>
    </div>
  );
}
