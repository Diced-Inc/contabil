"use client";

import { useState } from "react";
import Link from "next/link";
import { ExternalLink, TriangleAlert, Wand2 } from "lucide-react";
import { cn } from "cn";
import type { EstadoForm } from "@/actions/empresas";
import type { ContaOpcao } from "@/components/conta-select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cents, hoje, parseValorBR } from "@/lib/format";
import { aplicarModelo, MODELOS, TRIBUTOS_PROVISAO, type TributoProvisao } from "@/lib/modelos-lancamento";
import { FormLancamento, type LancamentoInicial } from "../form-lancamento";

const alertaCls = "border-warning/25 bg-warning-soft text-warning *:data-[slot=alert-description]:text-warning/90";
const selectCls =
  "h-9 cursor-pointer rounded-md border border-input bg-card px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";
const centavos = (s: string) => cents(parseValorBR(s) || 0) || 0;

/** Novo lançamento com modelos: o modelo escolhido preenche o formulário (que continua editável). */
export function NovoComModelo({ empresaId, contas, action, voltar }: {
  empresaId: string; contas: ContaOpcao[]; action: (prev: EstadoForm, form: FormData) => Promise<EstadoForm>; voltar: string;
}) {
  const [id, setId] = useState("");
  const [valor, setValor] = useState("");
  const [irrf, setIrrf] = useState("");
  const [tributo, setTributo] = useState<TributoProvisao>("simples");
  const [erro, setErro] = useState<string | null>(null);
  const [aplicado, setAplicado] = useState<{ n: number; inicial: LancamentoInicial; faltando: string[] } | null>(null);
  const m = MODELOS.find((x) => x.id === id);

  const preencher = () => {
    if (!m || !("montar" in m)) return;
    try {
      const r = aplicarModelo(m, { valor: centavos(valor), irrf: centavos(irrf), tributo }, contas);
      setAplicado((a) => ({
        n: (a?.n ?? 0) + 1, faltando: r.faltando,
        inicial: { data: hoje(), competencia: "", dataPagamento: null, historico: r.historico, documento: null, partidas: r.partidas },
      }));
      setErro(null);
    } catch (e) {
      setErro((e as Error).message);
    }
  };

  return (
    <div className="grid gap-5">
      <section className="grid max-w-5xl gap-3 rounded-xl border bg-card p-5 shadow-card">
        <div className="flex flex-wrap items-end gap-3">
          <div className="grid gap-2">
            <Label htmlFor="modelo">Modelo</Label>
            <select id="modelo" value={id} onChange={(e) => { setId(e.target.value); setErro(null); }} className={cn(selectCls, "w-72")}>
              <option value="">Sem modelo (em branco)</option>
              {MODELOS.map((x) => <option key={x.id} value={x.id}>{x.rotulo}</option>)}
            </select>
          </div>
          {m && "montar" in m && (
            <>
              {m.campos.tributo && (
                <div className="grid gap-2">
                  <Label htmlFor="modelo-tributo">Tributo</Label>
                  <select id="modelo-tributo" value={tributo} onChange={(e) => setTributo(e.target.value as TributoProvisao)} className={selectCls}>
                    {Object.entries(TRIBUTOS_PROVISAO).map(([k, t]) => <option key={k} value={k}>{t.rotulo}</option>)}
                  </select>
                </div>
              )}
              <div className="grid gap-2">
                <Label htmlFor="modelo-valor">{m.campos.valor}</Label>
                <Input id="modelo-valor" inputMode="decimal" placeholder="0,00" value={valor} onChange={(e) => setValor(e.target.value)} className="w-40 text-right tabular-nums" />
              </div>
              {m.campos.irrf && (
                <div className="grid gap-2">
                  <Label htmlFor="modelo-irrf">{m.campos.irrf}</Label>
                  <Input id="modelo-irrf" inputMode="decimal" placeholder="0,00" value={irrf} onChange={(e) => setIrrf(e.target.value)} className="w-40 text-right tabular-nums" />
                </div>
              )}
              <Button type="button" variant="outline" onClick={preencher}>
                <Wand2 />
                Preencher partidas
              </Button>
            </>
          )}
          {m && "link" in m && (
            <Link href={m.link(empresaId)} className={buttonVariants({ variant: "outline" })}>
              <ExternalLink />
              Abrir Parcelamentos
            </Link>
          )}
        </div>
        {m && <p className="text-xs text-muted-foreground">{m.descricao}</p>}
        {erro && <p className="text-sm text-danger">{erro}</p>}
        {aplicado && aplicado.faltando.length > 0 && (
          <Alert className={alertaCls}>
            <TriangleAlert />
            <AlertDescription>
              Conta não encontrada no plano: {aplicado.faltando.join(", ")}. Escolha outra conta na partida em branco ou crie-a em Plano de contas.
            </AlertDescription>
          </Alert>
        )}
      </section>
      <FormLancamento key={aplicado?.n ?? 0} action={action} contas={contas} inicial={aplicado?.inicial} voltar={voltar} />
    </div>
  );
}
