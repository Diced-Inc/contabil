"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { CircleAlert, CircleCheck, FlaskConical, Info, Plus, RotateCcw, Save, Send, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import { salvarAvisos, type EstadoAvisos } from "@/actions/avisos";
import { Erro } from "@/app/login/senha-forms";
import { VerEmail } from "@/components/ver-email";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ANTES_DAS, DIA_PEDIDO, etapasAvisos, LEMBRETE_EXTRATO, PADRAO_AVISOS, type ConfigAvisos, type TipoAviso } from "@/lib/avisos";
import { nomeCompetencia } from "@/lib/ciclo";

type Simulacao = { hoje?: string; avisos: { tipo: TipoAviso; competencia: string; para: string; status: string }[]; erro?: string };

/** Frase do aviso para a simulação: "o pedido dos extratos de outubro de 2026". */
const FRASE: Record<TipoAviso, (c: string) => string> = {
  pedido_extrato: (c) => `Pedido dos extratos de ${nomeCompetencia(c)}`,
  lembrete_extrato: (c) => `Lembrete dos extratos de ${nomeCompetencia(c)}`,
  lembrete_das: (c) => `Lembrete do DAS de ${nomeCompetencia(c)}`,
};

/** Lista de dias editável em chips (valores enviados como campos repetidos `name`). */
function Dias({ id, name, valores, onChange, faixa, rotulo }: {
  id: string; name: string; valores: number[]; onChange: (v: number[]) => void; faixa: { min: number; max: number }; rotulo: (d: number) => string;
}) {
  const [novo, setNovo] = useState("");
  const n = Number(novo);
  const valido = novo !== "" && Number.isInteger(n) && n >= faixa.min && n <= faixa.max && !valores.includes(n) && valores.length < 5;
  const adicionar = () => {
    if (!valido) return;
    onChange([...valores, n].sort((a, b) => a - b));
    setNovo("");
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      {valores.map((d) => (
        <span key={d} className="inline-flex h-8 items-center gap-1 rounded-md border bg-muted pr-1 pl-2.5 text-sm">
          <input type="hidden" name={name} value={d} />
          {rotulo(d)}
          <Button type="button" variant="ghost" size="icon-xs" aria-label={`Remover ${rotulo(d)}`} onClick={() => onChange(valores.filter((v) => v !== d))}>
            <X />
          </Button>
        </span>
      ))}
      <div className="flex items-center gap-1">
        <Input
          id={id}
          type="number"
          inputMode="numeric"
          min={faixa.min}
          max={faixa.max}
          value={novo}
          onChange={(e) => setNovo(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              adicionar();
            }
          }}
          className="h-8 w-20"
          placeholder={`${faixa.min}-${faixa.max}`}
          aria-label="Novo dia"
        />
        <Button type="button" variant="outline" size="sm" disabled={!valido} onClick={adicionar}>
          <Plus />
          Adicionar
        </Button>
      </div>
    </div>
  );
}

function Situacao({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  const Icone = ok ? CircleCheck : CircleAlert;
  return (
    <p className="flex items-start gap-2 text-sm text-muted-foreground">
      <Icone className={`mt-0.5 size-4 shrink-0 ${ok ? "text-success" : "text-warning"}`} />
      <span>{children}</span>
    </p>
  );
}

const ordem = (xs: number[]) => [...xs].sort((a, b) => a - b);
/** Mesmos dias, em qualquer ordem (o servidor grava ordenado). */
const iguais = (a: number[], b: number[]) => a.length === b.length && ordem(a).every((x, i) => x === ordem(b)[i]);
const dataCurta = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

export function AvisosForm({ empresaId, config, hoje, emailOk, clientesAtivos }: {
  empresaId: string; config: ConfigAvisos; hoje: string; emailOk: boolean; clientesAtivos: number;
}) {
  const [ativo, setAtivo] = useState(config.avisosAtivos);
  const [dia, setDia] = useState(String(config.diaPedidoExtrato));
  const [lembretes, setLembretes] = useState(config.lembretesExtratoDias);
  const [antes, setAntes] = useState(config.diasAntesVencimentoDas);
  const [estado, enviar, salvando] = useActionState<EstadoAvisos, FormData>(salvarAvisos.bind(null, empresaId), {});
  const [simulando, iniciar] = useTransition();
  const [simulacao, setSimulacao] = useState<Simulacao | null>(null);
  useEffect(() => {
    if (estado.ok) toast.success("Avisos salvos.");
  }, [estado]);
  // Link do Resumo (#avisos): o card só tem a altura final depois do streaming, então rola de novo ao montar.
  useEffect(() => {
    if (location.hash === "#avisos") document.getElementById("avisos")?.scrollIntoView({ block: "start" });
  }, []);

  const diaNum = Math.min(Math.max(Number(dia) || DIA_PEDIDO.min, DIA_PEDIDO.min), DIA_PEDIDO.max);
  const etapas = etapasAvisos({ diaPedidoExtrato: diaNum, lembretesExtratoDias: lembretes, diasAntesVencimentoDas: antes }, hoje);
  const padrao =
    diaNum === PADRAO_AVISOS.diaPedidoExtrato && iguais(lembretes, PADRAO_AVISOS.lembretesExtratoDias) && iguais(antes, PADRAO_AVISOS.diasAntesVencimentoDas);
  const alterado =
    ativo !== config.avisosAtivos || diaNum !== config.diaPedidoExtrato || !iguais(lembretes, config.lembretesExtratoDias) || !iguais(antes, config.diasAntesVencimentoDas);
  // Sem cliente ativo não há para quem mandar: não deixa ligar (desligar continua possível).
  const bloqueado = clientesAtivos === 0 && !ativo;

  const restaurar = () => {
    setDia(String(PADRAO_AVISOS.diaPedidoExtrato));
    setLembretes(PADRAO_AVISOS.lembretesExtratoDias);
    setAntes(PADRAO_AVISOS.diasAntesVencimentoDas);
  };

  const simular = () =>
    iniciar(async () => {
      const r = await fetch(`/api/cron/avisos?empresa=${empresaId}&simular=1`, { method: "POST" }).catch(() => null);
      const j = r?.ok ? await r.json() : null;
      setSimulacao(
        j?.empresas?.[0]
          ? { hoje: j.hoje, avisos: j.empresas[0].avisos, erro: j.empresas[0].erro && "Não foi possível simular agora. Tente de novo." }
          : { avisos: [], erro: "Não foi possível simular agora. Tente de novo." },
      );
    });

  return (
    <form action={enviar} className="grid gap-6">
      <Erro>{estado.erro}</Erro>
      <div className="flex items-start justify-between gap-4">
        <div className="grid gap-1">
          <Label htmlFor="avisos-ativos" className={cn(bloqueado && "text-muted-foreground")}>Enviar avisos automáticos</Label>
          {bloqueado ? (
            <p className="text-sm text-muted-foreground">
              Disponível quando alguém da empresa aceitar o convite do portal.{" "}
              <Link href={`/e/${empresaId}/clientes`} className="font-medium text-primary underline-offset-4 hover:underline">
                Convidar em Clientes
              </Link>
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              {ativo ? "Ligado: os e-mails abaixo saem sozinhos, às 8h." : "Desligado: nenhum pedido ou lembrete sai automaticamente."}
            </p>
          )}
        </div>
        <Switch id="avisos-ativos" checked={ativo} onCheckedChange={setAtivo} disabled={bloqueado} className="mt-0.5" />
        {ativo && <input type="hidden" name="avisosAtivos" value="on" />}
      </div>

      <section aria-labelledby="linha-do-tempo" className="rounded-xl border bg-muted/30 p-4">
        <h3 id="linha-do-tempo" className="mb-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Como fica o mês do cliente</h3>
        <ol className="grid">
          {etapas.map((e, i) => (
            <li key={e.tipo} className="relative flex gap-3 pb-4 last:pb-0">
              {i < etapas.length - 1 && <span aria-hidden className="absolute top-6 bottom-0 left-[11px] w-px bg-border" />}
              <span className="z-10 flex size-6 shrink-0 items-center justify-center rounded-full border bg-card text-xs font-semibold text-primary tabular-nums">
                {i + 1}
              </span>
              <div className="flex min-w-0 flex-1 items-start justify-between gap-4 pt-0.5">
                <p className="min-w-0 text-sm">
                  <b className="font-semibold text-foreground">{e.quando}:</b> <span className="text-foreground/80">{e.texto}</span>
                </p>
                <VerEmail empresaId={empresaId} tipo={e.tipo} className="shrink-0" />
              </div>
            </li>
          ))}
        </ol>
        <div className="mt-4 flex items-start justify-between gap-4 border-t pt-3">
          <p className="flex min-w-0 items-start gap-2 text-sm text-muted-foreground">
            <Send className="mt-0.5 size-4 shrink-0 text-primary" />
            <span>
              <b className="font-semibold text-foreground">Ao concluir o mês:</b> o cliente recebe a guia do DAS por e-mail. Esse sai sempre, mesmo com os
              avisos desligados.
            </span>
          </p>
          <VerEmail empresaId={empresaId} tipo="das_disponivel" className="shrink-0" />
        </div>
      </section>

      <fieldset className="grid gap-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <legend className="text-sm font-semibold text-foreground">Ajustar os dias</legend>
          {padrao ? (
            <span className="text-xs text-muted-foreground">Usando o padrão recomendado</span>
          ) : (
            <Button type="button" variant="ghost" size="sm" onClick={restaurar}>
              <RotateCcw />
              Voltar ao padrão
            </Button>
          )}
        </div>

        <div className="grid gap-2">
          <Label htmlFor="dia-pedido">Dia do mês para pedir os extratos</Label>
          <div className="flex items-center gap-2">
            <Input
              id="dia-pedido"
              name="diaPedidoExtrato"
              type="number"
              inputMode="numeric"
              min={DIA_PEDIDO.min}
              max={DIA_PEDIDO.max}
              value={dia}
              onChange={(e) => setDia(e.target.value)}
              className="w-20"
            />
            <span className="text-sm text-muted-foreground">de 1 a 28. Padrão: dia 1.</span>
          </div>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="lembretes-extrato">Lembrar dos extratos quantos dias depois do pedido</Label>
          <Dias
            id="lembretes-extrato"
            name="lembretesExtratoDias"
            valores={lembretes}
            onChange={setLembretes}
            faixa={LEMBRETE_EXTRATO}
            rotulo={(d) => `${d} ${d === 1 ? "dia" : "dias"} depois`}
          />
          <p className="text-sm text-muted-foreground">Param assim que o cliente envia os arquivos. Padrão: 4 e 9 dias depois.</p>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="antes-das">Lembrar do DAS quantos dias antes do vencimento</Label>
          <Dias
            id="antes-das"
            name="diasAntesVencimentoDas"
            valores={antes}
            onChange={setAntes}
            faixa={ANTES_DAS}
            rotulo={(d) => (d === 0 ? "No dia" : `${d} ${d === 1 ? "dia" : "dias"} antes`)}
          />
          <p className="text-sm text-muted-foreground">
            Use 0 para o dia do vencimento. Param quando o DAS é marcado como pago. Padrão: 3 dias antes e no dia.
          </p>
        </div>
      </fieldset>

      <div className="grid gap-1.5">
        {!emailOk && (
          <Situacao ok={false}>O envio de e-mail não está configurado no sistema. Até isso ser resolvido, os avisos ficam registrados sem sair.</Situacao>
        )}
        <Situacao ok={clientesAtivos > 0}>
          {clientesAtivos === 0
            ? "Ninguém da empresa aceitou o convite do portal ainda, então não há para quem mandar."
            : clientesAtivos === 1
              ? "1 pessoa da empresa recebe os avisos."
              : `${clientesAtivos} pessoas da empresa recebem os avisos.`}
        </Situacao>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={salvando || !alterado}>
          <Save />
          {salvando ? "Salvando..." : "Salvar"}
        </Button>
        <Button type="button" variant="outline" disabled={simulando} onClick={simular}>
          <FlaskConical />
          {simulando ? "Simulando..." : "O que sairia hoje?"}
        </Button>
        {alterado && <span className="text-sm text-warning">Alterações não salvas</span>}
      </div>

      {simulacao && (
        <div className="grid gap-2 rounded-xl border p-4 text-sm" role="status">
          <p className="flex items-center gap-2 font-medium text-foreground">
            <Info className="size-4 text-info" />
            Simulação: nada foi enviado
          </p>
          {simulacao.erro ? (
            <p className="text-danger">{simulacao.erro}</p>
          ) : simulacao.avisos.length === 0 ? (
            <p className="text-muted-foreground">
              Hoje{simulacao.hoje && ` (${dataCurta(simulacao.hoje)})`} nenhum e-mail sairia para esta empresa.{" "}
              {clientesAtivos === 0
                ? "Os avisos só vão para quem já aceitou o convite do portal."
                : "Os próximos envios estão na linha do tempo acima."}
            </p>
          ) : (
            <>
              <p className="text-muted-foreground">
                {config.avisosAtivos ? "Hoje às 8h" : "Se os avisos estivessem ligados, hoje"}
                {simulacao.hoje && ` (${dataCurta(simulacao.hoje)})`} {simulacao.avisos.length === 1 ? "sairia este e-mail:" : "sairiam estes e-mails:"}
              </p>
              <ul className="grid gap-1.5">
                {simulacao.avisos.map((a) => (
                  <li key={`${a.tipo}-${a.competencia}-${a.para}`} className="flex flex-wrap items-baseline gap-x-1.5">
                    <span className="font-medium text-foreground">{FRASE[a.tipo](a.competencia)}</span>
                    <span className="text-muted-foreground">para {a.para}</span>
                    {a.status === "ja_enviado" && <span className="text-muted-foreground">(já enviado, não repete)</span>}
                  </li>
                ))}
              </ul>
            </>
          )}
          {alterado && <p className="text-xs text-muted-foreground">A simulação usa a configuração salva. Salve para simular as alterações.</p>}
        </div>
      )}
    </form>
  );
}
