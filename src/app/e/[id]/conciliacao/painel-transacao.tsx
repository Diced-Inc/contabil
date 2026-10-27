"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeftRight, Ban, Check, HandCoins, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import type { EstadoForm } from "@/actions/empresas";
import {
  aprovarClassificacao, baixarTituloPelaTransacao, ignorarTransacao, marcarTransferencia, reclassificar, type ClassificacaoInput,
} from "@/actions/conciliacao";
import { ContaSelect, type ContaOpcao } from "@/components/conta-select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Valor } from "@/components/valor";
import { cents, fmtData, fmtValor, fromCents, parseValorBR, valorParaInput } from "@/lib/format";
import { SINAIS, TIPOS_MATCH, type Sinal, type TipoMatch } from "@/lib/classificacao/regras";
import type { ConciliadaLinha, TituloAberto, TransacaoLinha } from "./queries";

const selectCls =
  "h-9 w-full cursor-pointer rounded-md border border-input bg-card px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";
const centavos = (s: string) => cents(parseValorBR(s) || 0);

type Props = {
  empresaId: string;
  transacao: TransacaoLinha | null;
  onClose: () => void;
  todas: TransacaoLinha[];
  contas: ContaOpcao[];
  titulos: TituloAberto[];
};

export function PainelTransacao({ transacao: t, onClose, ...rest }: Props) {
  return (
    <Sheet open={!!t} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full gap-0 overflow-y-auto data-[side=right]:sm:max-w-[520px]">
        {t && <Conteudo t={t} onClose={onClose} {...rest} />}
      </SheetContent>
    </Sheet>
  );
}

/** Só a aba Classificar, preenchida com o lançamento atual; ao enviar estorna e reclassifica. */
export function PainelReclassificar({ empresaId, transacao: c, contas, onClose }: {
  empresaId: string; transacao: ConciliadaLinha | null; contas: ContaOpcao[]; onClose: () => void;
}) {
  return (
    <Sheet open={!!c} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full gap-0 overflow-y-auto data-[side=right]:sm:max-w-[520px]">
        {c && <Reclassificar c={c} empresaId={empresaId} contas={contas} onClose={onClose} />}
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
      if (r.aviso) toast.warning(r.aviso);
      else toast.success(sucesso);
      onClose();
      router.refresh();
    });
  return [pendente, executar] as const;
}

function Reclassificar({ c, empresaId, contas, onClose }: { c: ConciliadaLinha; empresaId: string; contas: ContaOpcao[]; onClose: () => void }) {
  const [pendente, executar] = useExecutar(onClose);
  const t = { ...c, id: c.transacaoId };
  const total = Math.abs(cents(t.valor));
  return (
    <>
      <Cabecalho t={t} />
      <div className="px-6 py-5">
        <p className="mb-3 text-xs text-muted-foreground">
          O lançamento {c.numero} é estornado com a data de hoje e um novo é criado com a classificação abaixo.
        </p>
        <Classificar t={t} total={total} entrada={cents(t.valor) > 0} contas={contas} pendente={pendente}
          inicial={{
            linhas: c.contras.map((x) => ({ contaId: x.contaId, valor: valorParaInput(x.valor) })),
            historico: c.historico, documento: c.documento ?? "", competencia: c.competencia.slice(0, 7),
          }}
          enviar={(input) => executar(() => reclassificar(empresaId, input), "Transação reclassificada.")} />
      </div>
    </>
  );
}

type TransacaoBase = Pick<TransacaoLinha, "id" | "data" | "valor" | "memo" | "contaBancariaNome">
  & Partial<Pick<TransacaoLinha, "sugestaoOrigem" | "sugestaoContaId" | "sugestaoHistorico" | "sugestaoJustificativa">>;

function Cabecalho({ t }: { t: TransacaoBase }) {
  const entrada = cents(t.valor) > 0;
  return (
    <SheetHeader className="gap-2 bg-muted/40 pr-12">
      <div className="flex items-center gap-2">
        <Badge variant={entrada ? "success" : "danger"}>{entrada ? "Entrada" : "Saída"}</Badge>
        <span className="text-xs text-muted-foreground">{fmtData(t.data)} · {t.contaBancariaNome}</span>
      </div>
      <SheetTitle className="text-2xl">
        <span className="mr-1 text-base font-medium text-muted-foreground">R$</span>
        <Valor v={t.valor} className="font-semibold" />
      </SheetTitle>
      <SheetDescription className="break-words">{t.memo || "(sem memo)"}</SheetDescription>
    </SheetHeader>
  );
}

function Conteudo({ t, empresaId, onClose, todas, contas, titulos }: Omit<Props, "transacao"> & { t: TransacaoLinha }) {
  const [pendente, executar] = useExecutar(onClose);
  const total = Math.abs(cents(t.valor));
  const entrada = cents(t.valor) > 0;

  return (
    <>
      <Cabecalho t={t} />
      <Tabs defaultValue={t.sugestaoOrigem === "transferencia" ? "transferencia" : "classificar"} className="gap-3 px-6 py-5">
        <TabsList className="w-full">
          <TabsTrigger value="classificar">Classificar</TabsTrigger>
          <TabsTrigger value="titulo">Baixar título</TabsTrigger>
          <TabsTrigger value="transferencia">Transferência</TabsTrigger>
          <TabsTrigger value="ignorar">Ignorar</TabsTrigger>
        </TabsList>
        <TabsContent value="classificar" className="pt-3">
          <Classificar t={t} total={total} entrada={entrada} contas={contas} pendente={pendente}
            enviar={(input) => executar(() => aprovarClassificacao(empresaId, input), "Transação classificada.")} />
        </TabsContent>
        <TabsContent value="titulo" className="pt-3">
          <BaixarTitulo total={total} contas={contas} pendente={pendente}
            titulos={titulos.filter((x) => x.tipo === (entrada ? "receber" : "pagar"))}
            enviar={(tituloId, contaDiferencaId) =>
              executar(() => baixarTituloPelaTransacao(empresaId, { transacaoId: t.id, tituloId, contaDiferencaId }), "Título baixado.")} />
        </TabsContent>
        <TabsContent value="transferencia" className="pt-3">
          <Transferencia t={t} pendente={pendente}
            candidatas={todas.filter((o) => o.contaBancariaId !== t.contaBancariaId && cents(o.valor) === -cents(t.valor))}
            enviar={(parId) => executar(() => marcarTransferencia(empresaId, { transacaoId: t.id, parId }), "Transferência registrada.")} />
        </TabsContent>
        <TabsContent value="ignorar" className="pt-3">
          <Ignorar pendente={pendente}
            enviar={(motivo) => executar(() => ignorarTransacao(empresaId, t.id, motivo), "Transação ignorada.")} />
        </TabsContent>
      </Tabs>
    </>
  );
}

type Linha = { contaId: string | null; valor: string };

function Classificar({ t, total, entrada, contas, pendente, enviar, inicial }: {
  t: TransacaoBase; total: number; entrada: boolean; contas: ContaOpcao[]; pendente: boolean;
  enviar: (input: ClassificacaoInput) => void;
  /** Reclassificação: valores do lançamento atual; sem "criar regra". */
  inicial?: { linhas: Linha[]; historico: string; documento: string; competencia: string };
}) {
  const sugerida = t.sugestaoOrigem && t.sugestaoOrigem !== "transferencia" ? (t.sugestaoContaId ?? null) : null;
  const [linhas, setLinhas] = useState<Linha[]>(inicial?.linhas ?? [{ contaId: sugerida, valor: valorParaInput(fromCents(total)) }]);
  const [historico, setHistorico] = useState(inicial?.historico ?? (t.sugestaoHistorico || t.memo));
  const [documento, setDocumento] = useState(inicial?.documento ?? "");
  const [competencia, setCompetencia] = useState(inicial?.competencia ?? t.data.slice(0, 7));
  const [criaRegra, setCriaRegra] = useState(false);
  const [regra, setRegra] = useState<{ nome: string; tipoMatch: TipoMatch; padrao: string; sinal: Sinal }>({
    nome: t.memo.slice(0, 60), tipoMatch: "memo_contem", padrao: t.memo, sinal: entrada ? "entrada" : "saida",
  });
  const soma = linhas.reduce((s, l) => s + centavos(l.valor), 0);
  const dif = total - soma;
  const set = (i: number, p: Partial<Linha>) => setLinhas((ls) => ls.map((l, k) => (k === i ? { ...l, ...p } : l)));

  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        enviar({
          transacaoId: t.id,
          partidas: linhas.map((l) => ({ contaId: l.contaId ?? "", valor: l.valor })),
          historico, documento, competencia,
          criarRegra: criaRegra ? regra : undefined,
        });
      }}
    >
      <div className="grid gap-2">
        <Label>Contrapartida{linhas.length > 1 && "s"} ({entrada ? "crédito" : "débito"})</Label>
        {linhas.map((l, i) => (
          <div key={i} className="flex gap-2">
            <ContaSelect contas={contas} value={l.contaId} onChange={(contaId) => set(i, { contaId })} className="min-w-0 flex-1" />
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
      {t.sugestaoOrigem === "ia" && t.sugestaoJustificativa && (
        <p className="text-xs text-muted-foreground">IA: {t.sugestaoJustificativa}</p>
      )}
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
      {!inicial && (
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={criaRegra} onCheckedChange={(c) => setCriaRegra(!!c)} />
          Criar regra com esta classificação
        </label>
      )}
      {criaRegra && (
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
      <Button type="submit" disabled={pendente || dif !== 0}>
        <Check />
        {inicial ? (pendente ? "Reclassificando..." : "Reclassificar") : pendente ? "Aprovando..." : "Aprovar classificação"}
      </Button>
    </form>
  );
}

function BaixarTitulo({ total, titulos, contas, pendente, enviar }: {
  total: number; titulos: TituloAberto[]; contas: ContaOpcao[]; pendente: boolean;
  enviar: (tituloId: string, contaDiferencaId: string | null) => void;
}) {
  const [tituloId, setTituloId] = useState<string | null>(null);
  const [contaDif, setContaDif] = useState<string | null>(null);
  const sel = titulos.find((x) => x.id === tituloId);
  const dif = sel ? total - cents(sel.valor) : 0;
  if (!titulos.length) return <p className="text-sm text-muted-foreground">Nenhum título aberto compatível.</p>;
  return (
    <div className="grid gap-3">
      <div className="grid max-h-80 gap-1 overflow-y-auto">
        {titulos.map((x) => (
          <label key={x.id} className={cn("flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors hover:bg-muted/50", x.id === tituloId && "border-primary bg-accent")}>
            <input type="radio" name="titulo" checked={x.id === tituloId} onChange={() => setTituloId(x.id)} />
            <span className="min-w-0 flex-1 truncate">
              <span className="font-medium">{x.contraparte}</span> · {x.descricao}
              {x.documento && <span className="text-muted-foreground"> · {x.documento}</span>}
            </span>
            {x.vencimento && <span className="text-xs tabular-nums text-muted-foreground">{fmtData(x.vencimento)}</span>}
            <span className={cn("tabular-nums", cents(x.valor) === total && "font-medium text-success")}>{fmtValor(x.valor)}</span>
          </label>
        ))}
      </div>
      {sel && dif !== 0 && (
        <div className="grid gap-2">
          <Label>Conta da diferença ({fmtValor(fromCents(Math.abs(dif)))}, {dif > 0 ? "pago a maior" : "pago a menor"})</Label>
          <ContaSelect contas={contas} value={contaDif} onChange={setContaDif} placeholder="Juros, multa ou desconto" />
        </div>
      )}
      <Button disabled={pendente || !sel || (dif !== 0 && !contaDif)} onClick={() => sel && enviar(sel.id, dif !== 0 ? contaDif : null)}>
        <HandCoins />
        {pendente ? "Baixando..." : "Baixar título"}
      </Button>
    </div>
  );
}

function Transferencia({ t, candidatas, pendente, enviar }: {
  t: TransacaoLinha; candidatas: TransacaoLinha[]; pendente: boolean; enviar: (parId: string) => void;
}) {
  const [parId, setParId] = useState(candidatas.some((c) => c.id === t.transferenciaParId) ? t.transferenciaParId! : "");
  if (!candidatas.length)
    return <p className="text-sm text-muted-foreground">Nenhuma transação pendente de outra conta com valor oposto.</p>;
  return (
    <div className="grid gap-3">
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
      <p className="text-xs text-muted-foreground">Gera um lançamento D banco de destino / C banco de origem ligado às duas transações.</p>
      <Button disabled={pendente || !parId} onClick={() => enviar(parId)}>
        <ArrowLeftRight />
        {pendente ? "Registrando..." : "Marcar transferência"}
      </Button>
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
      <p className="text-xs text-muted-foreground">Não gera lançamento. Pode ser reativada na aba Ignoradas.</p>
      <Button variant="outline" disabled={pendente} onClick={() => enviar(motivo)}>
        <Ban />
        Ignorar transação
      </Button>
    </div>
  );
}
