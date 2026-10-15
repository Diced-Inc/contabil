"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { toast } from "sonner";
import { classificarEmLote } from "@/actions/conciliacao";
import { ContaSelect, type ContaOpcao } from "@/components/conta-select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Valor } from "@/components/valor";
import { cents, fmtData, fromCents } from "@/lib/format";
import { padraoComum, SINAIS, TIPOS_MATCH, type Sinal, type TipoMatch } from "@/lib/classificacao/regras";
import type { TransacaoLinha } from "./queries";

const selectCls =
  "h-9 w-full cursor-pointer rounded-md border border-input bg-card px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

type Props = { empresaId: string; transacoes: TransacaoLinha[]; contas: ContaOpcao[]; open: boolean; onClose: () => void; onDone: () => void };

export function ClassificarLote({ open, onClose, ...rest }: Props) {
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full gap-0 overflow-y-auto data-[side=right]:sm:max-w-[520px]">
        {open && rest.transacoes.length > 0 && <Conteudo onClose={onClose} {...rest} />}
      </SheetContent>
    </Sheet>
  );
}

function Conteudo({ empresaId, transacoes: ts, contas, onClose, onDone }: Omit<Props, "open">) {
  const router = useRouter();
  const [pendente, iniciar] = useTransition();
  const entrada = cents(ts[0].valor) > 0;
  const soma = fromCents(ts.reduce((s, t) => s + cents(t.valor), 0));
  const sugeridas = new Set(ts.map((t) => (t.sugestaoOrigem && t.sugestaoOrigem !== "transferencia" ? t.sugestaoContaId : null)));
  const [contaId, setContaId] = useState<string | null>(sugeridas.size === 1 ? [...sugeridas][0] : null);
  const [historico, setHistorico] = useState("{memo}");
  const [documento, setDocumento] = useState("");
  const [porMes, setPorMes] = useState(true);
  const [competencia, setCompetencia] = useState(ts[0].data.slice(0, 7));
  const [criaRegra, setCriaRegra] = useState(false);
  const [regra, setRegra] = useState<{ nome: string; tipoMatch: TipoMatch; padrao: string; sinal: Sinal }>(() => {
    const padrao = padraoComum(ts.map((t) => t.memo));
    return { nome: padrao.slice(0, 60), tipoMatch: "memo_contem", padrao, sinal: entrada ? "entrada" : "saida" };
  });

  const enviar = () =>
    iniciar(async () => {
      const r = await classificarEmLote(empresaId, {
        transacaoIds: ts.map((t) => t.id), contaId: contaId ?? "", historicoTemplate: historico, documento,
        competencia: porMes ? null : competencia, criarRegra: criaRegra ? regra : undefined,
      });
      if (r.aprovadas) toast.success(`${r.aprovadas} classificada(s).`);
      if (r.erros.length) toast.warning(`${r.erros.length} com erro`, { description: r.erros.slice(0, 5).join("\n") });
      if (!r.aprovadas) return;
      onDone();
      onClose();
      router.refresh();
    });

  return (
    <>
      <SheetHeader className="gap-2 bg-muted/40 pr-12">
        <div className="flex items-center gap-2">
          <Badge variant={entrada ? "success" : "danger"}>{entrada ? "Entradas" : "Saídas"}</Badge>
          <span className="text-xs text-muted-foreground">{ts.length} transações</span>
        </div>
        <SheetTitle className="text-2xl">
          <span className="mr-1 text-base font-medium text-muted-foreground">R$</span>
          <Valor v={soma} className="font-semibold" />
        </SheetTitle>
        <SheetDescription>Classificar {ts.length} transações com a mesma contrapartida.</SheetDescription>
        <ul className="max-h-[200px] divide-y overflow-y-auto rounded-md border bg-card text-xs">
          {ts.map((t) => (
            <li key={t.id} className="flex items-center gap-2 px-2 py-1.5">
              <span className="tabular-nums text-muted-foreground">{fmtData(t.data)}</span>
              <span className="min-w-0 flex-1 truncate" title={t.memo}>{t.memo}</span>
              <Valor v={t.valor} />
            </li>
          ))}
        </ul>
      </SheetHeader>
      <form
        className="grid gap-3 px-6 py-5"
        onSubmit={(e) => {
          e.preventDefault();
          enviar();
        }}
      >
        <div className="grid gap-2">
          <Label>Contrapartida ({entrada ? "crédito" : "débito"})</Label>
          <ContaSelect contas={contas} value={contaId} onChange={setContaId} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="lote-historico">Histórico</Label>
          <Input id="lote-historico" value={historico} onChange={(e) => setHistorico(e.target.value)} />
          <p className="text-xs text-muted-foreground">use {"{memo}"}, {"{valor}"}, {"{data}"}</p>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="lote-documento">Documento (opcional)</Label>
          <Input id="lote-documento" value={documento} onChange={(e) => setDocumento(e.target.value)} />
        </div>
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-sm leading-none font-medium">Competência</legend>
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" name="lote-competencia" checked={porMes} onChange={() => setPorMes(true)} />
            Mês de cada transação
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" name="lote-competencia" checked={!porMes} onChange={() => setPorMes(false)} />
            Mesmo mês para todas
            <Input type="month" value={competencia} disabled={porMes} onChange={(e) => setCompetencia(e.target.value)}
              className="ml-auto w-44" aria-label="Competência" />
          </label>
        </fieldset>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={criaRegra} onCheckedChange={(c) => setCriaRegra(!!c)} />
          Criar regra com esta classificação
        </label>
        {criaRegra && (
          <div className="grid gap-3 rounded-lg border p-3">
            <div className="grid gap-2">
              <Label htmlFor="lote-regra-nome">Nome da regra</Label>
              <Input id="lote-regra-nome" value={regra.nome} onChange={(e) => setRegra({ ...regra, nome: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label htmlFor="lote-regra-tipo">Tipo</Label>
                <select id="lote-regra-tipo" className={selectCls} value={regra.tipoMatch}
                  onChange={(e) => setRegra({ ...regra, tipoMatch: e.target.value as TipoMatch })}>
                  {Object.entries(TIPOS_MATCH).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="lote-regra-sinal">Sinal</Label>
                <select id="lote-regra-sinal" className={selectCls} value={regra.sinal}
                  onChange={(e) => setRegra({ ...regra, sinal: e.target.value as Sinal })}>
                  {Object.entries(SINAIS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="lote-regra-padrao">Padrão</Label>
              <Input id="lote-regra-padrao" value={regra.padrao} onChange={(e) => setRegra({ ...regra, padrao: e.target.value })} />
            </div>
            <p className="text-xs text-muted-foreground">A regra usa a contrapartida e o histórico acima.</p>
          </div>
        )}
        <Button type="submit" disabled={pendente || !contaId}>
          <Check />
          {pendente ? "Aprovando..." : `Aprovar ${ts.length} classificações`}
        </Button>
      </form>
    </>
  );
}
