"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { CircleAlert, CircleCheck, FlaskConical, Plus, Save, X } from "lucide-react";
import { toast } from "sonner";
import { salvarAvisos, type EstadoAvisos } from "@/actions/avisos";
import { Erro } from "@/app/login/senha-forms";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ANTES_DAS, DIA_PEDIDO, LEMBRETE_EXTRATO, ROTULO_NOTIFICACAO, textoAvisos, type ConfigAvisos } from "@/lib/avisos";
import { nomeCompetencia } from "@/lib/ciclo";

type Simulacao = { avisos: { tipo: keyof typeof ROTULO_NOTIFICACAO; competencia: string; para: string; status: string }[]; erro?: string };

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

  const diaNum = Math.min(Math.max(Number(dia) || DIA_PEDIDO.min, DIA_PEDIDO.min), DIA_PEDIDO.max);
  const resumo = textoAvisos({ diaPedidoExtrato: diaNum, lembretesExtratoDias: lembretes, diasAntesVencimentoDas: antes }, hoje);

  const simular = () =>
    iniciar(async () => {
      const r = await fetch(`/api/cron/avisos?empresa=${empresaId}&simular=1`, { method: "POST" });
      const j = r.ok ? await r.json() : null;
      setSimulacao(j?.empresas?.[0] ? { avisos: j.empresas[0].avisos, erro: j.empresas[0].erro } : { avisos: [], erro: "Não foi possível simular." });
    });

  return (
    <form action={enviar} className="grid gap-6">
      <Erro>{estado.erro}</Erro>
      <div className="flex items-center justify-between gap-4">
        <div className="grid gap-1">
          <Label htmlFor="avisos-ativos">Enviar avisos por e-mail</Label>
          <p className="text-xs text-muted-foreground">Desligado, nada sai automaticamente. O DAS disponível continua sendo avisado ao concluir o mês.</p>
        </div>
        <Switch id="avisos-ativos" checked={ativo} onCheckedChange={setAtivo} />
        {ativo && <input type="hidden" name="avisosAtivos" value="on" />}
      </div>

      <div className="grid gap-2">
        <Label htmlFor="dia-pedido">Dia do pedido dos extratos</Label>
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
          <span className="text-sm text-muted-foreground">de cada mês (1 a 28), pedindo os extratos do mês anterior</span>
        </div>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="lembretes-extrato">Lembretes do extrato (dias depois do pedido)</Label>
        <Dias
          id="lembretes-extrato"
          name="lembretesExtratoDias"
          valores={lembretes}
          onChange={setLembretes}
          faixa={LEMBRETE_EXTRATO}
          rotulo={(d) => `+${d} ${d === 1 ? "dia" : "dias"}`}
        />
        <p className="text-xs text-muted-foreground">Param assim que o cliente envia os arquivos.</p>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="antes-das">Lembretes do DAS (dias antes do vencimento)</Label>
        <Dias
          id="antes-das"
          name="diasAntesVencimentoDas"
          valores={antes}
          onChange={setAntes}
          faixa={ANTES_DAS}
          rotulo={(d) => (d === 0 ? "No dia" : `${d} ${d === 1 ? "dia" : "dias"} antes`)}
        />
        <p className="text-xs text-muted-foreground">Param quando o DAS é marcado como pago. Se vencer em aberto, sai mais um aviso no dia seguinte.</p>
      </div>

      <div className="rounded-lg border bg-muted/40 p-4 text-sm leading-relaxed">{resumo}.</div>

      <div className="grid gap-1.5">
        <Situacao ok={emailOk}>
          {emailOk ? "E-mail configurado (Resend)." : "E-mail não configurado: defina RESEND_API_KEY e EMAIL_FROM. Até lá os avisos ficam registrados sem sair."}
        </Situacao>
        <Situacao ok={clientesAtivos > 0}>
          {clientesAtivos === 0
            ? "Nenhum cliente ativo nesta empresa: convide alguém em Clientes."
            : clientesAtivos === 1
              ? "1 cliente ativo recebe os avisos."
              : `${clientesAtivos} clientes ativos recebem os avisos.`}
        </Situacao>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={salvando}>
          <Save />
          Salvar
        </Button>
        <Button type="button" variant="outline" disabled={simulando} onClick={simular}>
          <FlaskConical />
          Simular avisos de hoje
        </Button>
      </div>

      {simulacao && (
        <div className="grid gap-2 rounded-lg border p-4 text-sm">
          <p className="font-medium">Simulação com a configuração salva (nada foi enviado)</p>
          {simulacao.erro ? (
            <p className="text-danger">{simulacao.erro}</p>
          ) : simulacao.avisos.length === 0 ? (
            <p className="text-muted-foreground">Nenhum aviso sairia hoje.</p>
          ) : (
            <ul className="grid gap-1 text-muted-foreground">
              {simulacao.avisos.map((a) => (
                <li key={`${a.tipo}-${a.competencia}-${a.para}`}>
                  <span className="text-foreground">{ROTULO_NOTIFICACAO[a.tipo]}</span> de {nomeCompetencia(a.competencia)} para {a.para}
                  {a.status === "ja_enviado" && " (já enviado, não repete)"}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </form>
  );
}
