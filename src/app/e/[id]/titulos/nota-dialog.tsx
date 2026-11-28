"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileText, Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import { registrarNotas } from "@/actions/titulos";
import { ContaSelect, type ContaOpcao } from "@/components/conta-select";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cents, fmtValor, fromCents, parseValorBR, somarMeses } from "@/lib/format";
import { parcelasIguais, rotuloNota } from "@/lib/notas";
import { contasDeContrapartida, type TipoTitulo } from "@/lib/operacoes";
import { acharConta, NOMES_RETENCAO, TIPOS_RETENCAO, type TipoRetencao } from "@/lib/tributos";
import { PreviaLancamentos } from "../conciliacao/previa-lancamentos";
import { previaNota } from "./previa-nota";

const selectCls =
  "h-9 w-full cursor-pointer rounded-md border border-input bg-card px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";
const reais = (s: string) => fromCents(cents(parseValorBR(s) || 0));

type Ret = { tipo: TipoRetencao; valor: string; contaId: string | null };

/** Cadastro manual de nota fiscal (sem XML): gera os mesmos títulos e lançamentos da importação. */
export function NotaDialog({ empresaId, cnpj, contas, fechados, lembradas, tipoInicial }: {
  empresaId: string; cnpj: string; contas: ContaOpcao[]; fechados: string[];
  lembradas: Record<TipoTitulo, string | null>; tipoInicial: TipoTitulo;
}) {
  const [aberta, setAberta] = useState(false);
  const [chave, setChave] = useState(0);
  return (
    <Dialog open={aberta} onOpenChange={(a) => { setAberta(a); if (a) setChave((k) => k + 1); }}>
      <DialogTrigger render={<Button variant="outline" />}>
        <FileText />
        Nota fiscal manual
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Cadastrar nota fiscal</DialogTitle>
          <DialogDescription>Para notas sem o XML. Gera o título (um por parcela) e o reconhecimento na competência.</DialogDescription>
        </DialogHeader>
        <Form key={chave} empresaId={empresaId} cnpj={cnpj} contas={contas} fechados={fechados} lembradas={lembradas}
          tipoInicial={tipoInicial} onFeito={() => setAberta(false)} />
      </DialogContent>
    </Dialog>
  );
}

function Form({ empresaId, cnpj, contas, fechados, lembradas, tipoInicial, onFeito }: {
  empresaId: string; cnpj: string; contas: ContaOpcao[]; fechados: string[]; lembradas: Record<TipoTitulo, string | null>;
  tipoInicial: TipoTitulo; onFeito: () => void;
}) {
  const router = useRouter();
  const [pendente, iniciar] = useTransition();
  const [tipo, setTipo] = useState<TipoTitulo>(tipoInicial);
  const [numero, setNumero] = useState("");
  const [serie, setSerie] = useState("");
  const [servico, setServico] = useState(true);
  const [emissao, setEmissao] = useState("");
  const [competencia, setCompetencia] = useState("");
  const [nome, setNome] = useState("");
  const [doc, setDoc] = useState("");
  const [bruto, setBruto] = useState("");
  const [rets, setRets] = useState<Ret[]>([]);
  /** Sem nota anterior: receita de serviço (a maioria das empresas) ou de mercadoria; a pagar, o contador escolhe. */
  const padrao = (t: TipoTitulo, servicoNota = true) => lembradas[t]
    ?? (t === "receber" ? acharConta(contas, { prefixo: "3.1", re: servicoNota ? /^venda de servicos$/ : /^venda de mercadorias$/ })?.id ?? null : null);
  const [contaId, setContaId] = useState<string | null>(() => padrao(tipoInicial));
  const [vencimento, setVencimento] = useState("");
  const [nParcelas, setNParcelas] = useState("1");
  const [descricao, setDescricao] = useState("");

  const comp = competencia || emissao.slice(0, 7);
  const somaRet = rets.reduce((s, r) => s + cents(reais(r.valor)), 0);
  const liquido = cents(reais(bruto)) - somaRet;
  const n = Math.max(1, Math.trunc(Number(nParcelas) || 1));
  const rotulo = rotuloNota(servico ? "nfse" : "nfe", numero || "?", serie || null);
  const opcoes = contasDeContrapartida(contas, tipo);
  const parcelas = () => parcelasIguais(fromCents(liquido), n, vencimento || null, somarMeses);
  const { previa: montado, novas } = (() => {
    try {
      if (!(cents(reais(bruto)) > 0)) throw new Error("Informe o valor bruto da nota.");
      if (!(liquido > 0)) throw new Error("Retenções passam do valor bruto.");
      return previaNota({
        tipo, contas, contaResultadoId: contaId, emissao, competencia: comp ? `${comp}-01` : "", contraparte: nome || "?", rotulo,
        retencoes: rets.map((x) => ({ ...x, valor: reais(x.valor) })), parcelas: parcelas(),
      });
    } catch (e) {
      return { previa: (e as Error).message, novas: [] as ContaOpcao[] };
    }
  })();
  const setRet = (i: number, p: Partial<Ret>) => setRets((rs) => rs.map((r, k) => (k === i ? { ...r, ...p } : r)));

  const enviar = () => iniciar(async () => {
    const empresa = { documento: cnpj, nome: "" };
    const outra = { documento: doc, nome };
    const [res] = await registrarNotas(empresaId, [{
      origem: "manual", numero, serie, emissao, competencia: comp,
      emitente: tipo === "receber" ? empresa : outra, destinatario: tipo === "receber" ? outra : empresa,
      bruto: reais(bruto), retencoes: rets.map((r) => ({ tipo: r.tipo, valor: reais(r.valor), contaId: r.contaId })),
      contaResultadoId: contaId ?? "", parcelas: parcelas(), descricao: descricao || rotulo,
    }]);
    if ("erro" in res) return void toast.error(res.erro);
    if ("duplicada" in res) return void toast.error("Esta nota já está registrada (mesmo emitente, série e número).");
    toast.success(res.titulos > 1 ? `Nota registrada: ${res.titulos} títulos.` : "Nota registrada.", { description: res.adiantamento ? "Há adiantamento em aberto desta contraparte: use Compensar na linha do título." : undefined });
    onFeito();
    router.refresh();
  });

  return (
    <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); enviar(); }}>
      <div className="inline-flex w-fit rounded-lg border bg-muted p-[3px] text-sm">
        {([["receber", "Emitida pela empresa (a receber)"], ["pagar", "Recebida de fornecedor (a pagar)"]] as const).map(([k, r]) => (
          <button key={k} type="button" onClick={() => { setTipo(k); setContaId(padrao(k, servico)); setRets((rs) => rs.map((x) => ({ ...x, contaId: null }))); }}
            className={cn("rounded-md px-3 py-1 font-medium text-muted-foreground transition-colors hover:text-foreground", tipo === k && "bg-card text-foreground shadow-xs")}>
            {r}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="grid gap-2">
          <Label htmlFor="nf-modelo">Tipo</Label>
          <select id="nf-modelo" className={selectCls} value={servico ? "nfse" : "nfe"} onChange={(e) => setServico(e.target.value === "nfse")}>
            <option value="nfse">NFS-e (serviço)</option>
            <option value="nfe">NF-e (mercadoria)</option>
          </select>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="nf-numero">Número</Label>
          <Input id="nf-numero" value={numero} onChange={(e) => setNumero(e.target.value)} required />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="nf-serie">Série <span className="font-normal text-muted-foreground">(opcional)</span></Label>
          <Input id="nf-serie" value={serie} onChange={(e) => setSerie(e.target.value)} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="nf-emissao">Emissão</Label>
          <Input id="nf-emissao" type="date" value={emissao} onChange={(e) => setEmissao(e.target.value)} required />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_12rem_9rem]">
        <div className="grid gap-2">
          <Label htmlFor="nf-nome">{tipo === "receber" ? "Cliente (tomador)" : "Fornecedor (emitente)"}</Label>
          <Input id="nf-nome" value={nome} onChange={(e) => setNome(e.target.value)} required />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="nf-doc">CNPJ/CPF</Label>
          <Input id="nf-doc" value={doc} onChange={(e) => setDoc(e.target.value)} inputMode="numeric" />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="nf-comp">Competência</Label>
          <Input id="nf-comp" type="month" value={comp} onChange={(e) => setCompetencia(e.target.value)} />
        </div>
      </div>
      <div className="grid gap-2 sm:w-48">
        <Label htmlFor="nf-bruto">Valor bruto (R$)</Label>
        <Input id="nf-bruto" value={bruto} onChange={(e) => setBruto(e.target.value)} inputMode="decimal" placeholder="0,00" required />
      </div>
      <div className="grid gap-2">
        <Label>Retenções</Label>
        {rets.map((r, i) => (
          <div key={i} className="flex flex-wrap gap-2">
            <select aria-label="Tipo da retenção" className={cn(selectCls, "w-52")} value={r.tipo} onChange={(e) => setRet(i, { tipo: e.target.value as TipoRetencao, contaId: null })}>
              {TIPOS_RETENCAO.map((t) => <option key={t} value={t}>{NOMES_RETENCAO[t]}</option>)}
            </select>
            <Input aria-label="Valor da retenção" value={r.valor} onChange={(e) => setRet(i, { valor: e.target.value })} inputMode="decimal" placeholder="0,00" className="w-32 text-right tabular-nums" />
            {r.tipo === "outras" && (
              <ContaSelect contas={contas} value={r.contaId} onChange={(id) => setRet(i, { contaId: id })} className="min-w-0 flex-1" placeholder="Conta da retenção" />
            )}
            <Button type="button" variant="ghost" size="icon-sm" aria-label="Remover retenção" onClick={() => setRets((rs) => rs.filter((_, k) => k !== i))}>
              <Trash2 />
            </Button>
          </div>
        ))}
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <Button type="button" variant="ghost" size="sm" onClick={() => setRets((rs) => [...rs, { tipo: "iss", valor: "", contaId: null }])}>
            <Plus />
            Retenção
          </Button>
          <span className="tabular-nums text-muted-foreground">
            Líquido <b className={cn("font-semibold text-foreground", liquido <= 0 && "text-danger")}>R$ {fmtValor(fromCents(liquido))}</b>
          </span>
        </div>
      </div>
      <div className="grid gap-2">
        <Label>{tipo === "receber" ? "Conta de receita" : "Conta de custo, despesa ou ativo"}</Label>
        <ContaSelect contas={opcoes} value={contaId} onChange={setContaId} />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="grid gap-2">
          <Label htmlFor="nf-venc">{n > 1 ? "1º vencimento" : "Vencimento"}</Label>
          <Input id="nf-venc" type="date" value={vencimento} onChange={(e) => setVencimento(e.target.value)} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="nf-parcelas">Parcelas</Label>
          <Input id="nf-parcelas" type="number" min={1} max={120} value={nParcelas} onChange={(e) => setNParcelas(e.target.value)} />
        </div>
        <div className="col-span-2 grid gap-2 sm:col-span-1">
          <Label htmlFor="nf-desc">Descrição <span className="font-normal text-muted-foreground">(opcional)</span></Label>
          <Input id="nf-desc" value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder={rotulo} />
        </div>
      </div>
      <PreviaLancamentos previa={montado} contas={[...contas, ...novas]} fechados={fechados} />
      <Button type="submit" disabled={pendente || typeof montado === "string" || !numero.trim() || !nome.trim()}>
        <Save />
        {pendente ? "Registrando..." : n > 1 ? `Registrar nota (${n} títulos)` : "Registrar nota"}
      </Button>
    </form>
  );
}
