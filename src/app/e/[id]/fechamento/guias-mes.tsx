"use client";

import { useRef, useState, useTransition } from "react";
import {
  BadgeCheck, CircleCheck, CircleDashed, FileCheck2, FileQuestion, LoaderCircle, Mail, Paperclip, Pencil, Plus, Send, Trash2, TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import {
  descartarGuiaEnviada, enviarGuias, lerGuiaEnviada, marcarGuiaPaga, prepararGuia, removerGuia, salvarGuia, type ResultadoEnvio,
} from "@/actions/ciclo";
import { Erro } from "@/app/login/senha-forms";
import { Baixar } from "@/components/baixar";
import { VerEmail } from "@/components/ver-email";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { nomeCompetencia, tituloCompetencia } from "@/lib/ciclo";
import type { Guia as GuiaLida } from "@/lib/das";
import { fmtData, fmtValor, parseValorBR } from "@/lib/format";
import {
  guiasFaltando, listaTipos, nomeTipoGuia, resumoGuias, rotuloGuia, situacaoGuia, textoSituacao, TIPOS_GUIA, type TipoGuia,
} from "@/lib/guias";
import { createClient } from "@/supabase/client";
import { ContaSelect, type ContaOpcao } from "@/components/conta-select";
import { fimDoMes } from "@/lib/format";
import { partidasTitulo } from "@/lib/operacoes";
import { acharConta, contasDaGuia, norm } from "@/lib/tributos";
import { montarPrevia, PreviaLancamentos } from "../conciliacao/previa-lancamentos";
import type { ObrigacaoGuia } from "./queries";

export type GuiaView = {
  id: string;
  tipo: TipoGuia;
  descricao: string | null;
  valor: string;
  vencimento: string;
  codigoReceita: string | null;
  enviadoEm: Date | null;
  pagoEm: Date | null;
  /** Título (obrigação) da guia, se já registrado. */
  obrigacao: ObrigacaoGuia | null;
};

/** contas: analíticas ativas (para as contas da obrigação); mesFechado: competência fechada (o título não é registrado). */
type Base = { empresaId: string; competencia: string; hoje: string; contas: ContaOpcao[]; mesFechado: boolean };

const SELECT =
  "h-9 w-full cursor-pointer rounded-md border border-input bg-card px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";
const listaEmails = (xs: string[]) => (xs.length <= 2 ? xs.join(" e ") : `${xs.slice(0, 2).join(", ")} e mais ${xs.length - 2}`);
const diaSP = (d: Date) => d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });

/** Valor digitado ("1.234,56") validado como no servidor; null quando inválido. */
function lerValor(s: string) {
  const v = parseValorBR(s);
  return /^\d+(\.\d{1,2})?$/.test(v) && Number(v) > 0 ? v : null;
}

function Ajuda({ id, erro, children }: { id: string; erro?: string; children?: React.ReactNode }) {
  return (
    <p id={id} className={cn("text-sm", erro ? "text-danger" : "text-muted-foreground")}>
      {erro ?? children}
    </p>
  );
}

function Aviso({ children }: { children: React.ReactNode }) {
  return (
    <Alert className="border-warning/25 bg-warning-soft text-warning *:data-[slot=alert-description]:text-warning/90">
      <TriangleAlert />
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  );
}

type Leitura =
  | { estado: "lendo" }
  | { estado: "lida"; guia: GuiaLida; fonte: "texto" | "ia" | null; avisos: string[] }
  | { estado: "falhou"; erro: string };

/** "2026-10" → "Outubro/2026" (como impresso na guia). */
const periodoGuia = (p: string) => tituloCompetencia(`${p}-01`).replace(" de ", "/");

/** O que foi lido do PDF, logo abaixo do arquivo: resumo, avisos (amarelo) ou o pedido para digitar. */
function ResumoLeitura({ leitura }: { leitura: Leitura }) {
  if (leitura.estado === "lendo") {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
        <LoaderCircle className="size-4 animate-spin text-primary" />
        Lendo a guia...
      </p>
    );
  }
  if (leitura.estado === "falhou") return <p className="text-sm text-danger">{leitura.erro}</p>;
  const { guia, fonte, avisos } = leitura;
  const partes = [
    guia.valor && `R$ ${fmtValor(guia.valor)}`,
    guia.vencimento && `vence ${fmtData(guia.vencimento)}`,
    guia.periodo && periodoGuia(guia.periodo),
    guia.codigoReceita && `código ${guia.codigoReceita}`,
  ].filter(Boolean);
  return (
    <div className="grid gap-2" role="status">
      {partes.length ? (
        <p className="flex gap-2.5 rounded-lg border border-success/20 bg-success-soft px-3 py-2.5 text-sm text-foreground">
          <FileCheck2 className="mt-0.5 size-4 shrink-0 text-success" />
          <span>
            <span className="font-medium">Lemos o documento:</span> <span className="tabular-nums">{partes.join(" · ")}</span>
            <span className="block text-muted-foreground">{fonte === "ia" ? "Lido pela IA. " : ""}Confira os campos abaixo; dá para corrigir.</span>
          </span>
        </p>
      ) : (
        <p className="flex gap-2.5 rounded-lg border bg-muted/40 px-3 py-2.5 text-sm text-muted-foreground">
          <FileQuestion className="mt-0.5 size-4 shrink-0" />
          Não conseguimos ler o valor e o vencimento desta guia. Preencha abaixo.
        </p>
      )}
      {avisos.map((a) => (
        <Aviso key={a}>{a}</Aviso>
      ))}
    </div>
  );
}

type Erros = Partial<Record<"guia" | "valor" | "vencimento", string>>;

/**
 * Formulário de uma guia. Anexar (`slot` = tipo esperado, ou null para "Outra guia"): o PDF vai ao Storage ao ser escolhido
 * e o servidor lê valor, vencimento, tipo e código. Editar (`guia`): só os campos.
 */
function GuiaForm({ empresaId, competencia, hoje, contas, mesFechado, slot, guia, vencimentoSugerido, onPath, onSalvo }: Base & {
  slot: TipoGuia | null;
  guia?: GuiaView;
  vencimentoSugerido: string;
  /** Path do PDF já enviado e ainda não salvo (o diálogo descarta se fechar sem salvar). */
  onPath: (p: string | null) => void;
  onSalvo: () => void;
}) {
  const [tipo, setTipo] = useState<TipoGuia>(guia?.tipo ?? slot ?? "outra");
  const [descricao, setDescricao] = useState(guia?.descricao ?? "");
  const [valor, setValor] = useState(guia ? fmtValor(guia.valor) : "");
  const [vencimento, setVencimento] = useState(guia?.vencimento ?? vencimentoSugerido);
  const [codigo, setCodigo] = useState(guia?.codigoReceita ?? "");
  const [path, setPath] = useState<string | null>(null);
  const [leitura, setLeitura] = useState<Leitura | null>(null);
  const [detectado, setDetectado] = useState<TipoGuia | null>(null);
  const [erro, setErro] = useState<string>();
  const [erros, setErros] = useState<Erros>({});
  const [pendente, iniciar] = useTransition();
  const escolha = useRef(0); // ignora a leitura de um arquivo que já foi trocado
  // contas da obrigação: as do título (edição), as escolhidas, ou as do mapa do tributo (mudam com tipo/código)
  const [contasEscolhidas, setContasEscolhidas] = useState<{ obrigacaoId: string | null; despesaId: string | null } | null>(
    guia?.obrigacao ? { obrigacaoId: guia.obrigacao.obrigacaoId, despesaId: guia.obrigacao.despesaId } : null);
  const mapa = contasDaGuia(tipo, codigo);
  const padrao = {
    obrigacaoId: acharConta(contas, mapa?.obrigacao)?.id ?? null,
    despesaId: mapa?.modo === "despesa" ? acharConta(contas, mapa.despesa)?.id ?? null : null,
  };
  const efetivas = contasEscolhidas ?? padrao;
  // conta que o servidor cria sob demanda (ex.: PIS/COFINS/CSLL retidos): ainda sem id aqui
  const criaObrigacao = !efetivas.obrigacaoId && !contasEscolhidas && !!mapa?.obrigacao.criar;
  const valorOk = lerValor(valor);
  const lendo = leitura?.estado === "lendo";
  const id = (c: string) => `guia-${guia?.id ?? slot ?? "outra"}-${c}`;

  async function escolher(pdf: File | undefined) {
    const vez = ++escolha.current;
    setPath(null);
    onPath(null);
    setLeitura(null);
    setDetectado(null);
    setErros((x) => ({ ...x, guia: undefined }));
    if (!pdf) return;
    if (!pdf.name.toLowerCase().endsWith(".pdf")) return setErros((x) => ({ ...x, guia: "A guia precisa ser um arquivo PDF." }));
    if (pdf.size > 10 * 1024 * 1024) return setErros((x) => ({ ...x, guia: "O PDF passa de 10 MB." }));
    setLeitura({ estado: "lendo" });
    try {
      const p = await prepararGuia(empresaId, competencia);
      if ("erro" in p) throw new Error(p.erro);
      const [envio] = p.envios;
      const up = await createClient()
        .storage.from("documentos")
        .uploadToSignedUrl(envio.path, envio.token, new File([pdf], pdf.name, { type: "application/pdf" }));
      if (up.error) throw new Error(`Não foi possível enviar o PDF: ${up.error.message}`);
      if (vez !== escolha.current) return void descartarGuiaEnviada(empresaId, competencia, envio.path); // arquivo já trocado
      onPath(envio.path);
      setPath(envio.path);
      const r = await lerGuiaEnviada(empresaId, competencia, envio.path);
      if (vez !== escolha.current) return;
      if ("erro" in r) return setLeitura({ estado: "lida", guia: { tipo: null }, fonte: null, avisos: [] });
      setLeitura({ estado: "lida", guia: r.guia, fonte: r.fonte, avisos: r.avisos });
      setDetectado(r.tipo);
      if (!slot && r.tipo) setTipo(r.tipo); // "Outra guia": assume o tipo lido
      if (r.guia.valor) setValor(fmtValor(r.guia.valor));
      if (r.guia.vencimento) setVencimento(r.guia.vencimento);
      if (r.guia.codigoReceita) setCodigo(r.guia.codigoReceita);
      setErros((x) => ({ ...x, valor: r.guia.valor ? undefined : x.valor, vencimento: r.guia.vencimento ? undefined : x.vencimento }));
    } catch (e) {
      if (vez === escolha.current) setLeitura({ estado: "falhou", erro: e instanceof Error ? e.message : "Não foi possível enviar o PDF." });
    }
  }

  const salvar = () =>
    iniciar(async () => {
      setErro(undefined);
      const e: Erros = {};
      if (!guia && !path) e.guia = erros.guia ?? (leitura?.estado === "falhou" ? "Escolha o PDF de novo." : "Escolha o PDF da guia.");
      if (!valor.trim()) e.valor = "Informe o valor da guia.";
      else if (!valorOk) e.valor = "Valor inválido. Use o formato 1.234,56.";
      if (!vencimento) e.vencimento = "Informe a data de vencimento.";
      setErros(e);
      if (Object.keys(e).length || !valorOk) return;
      if (!mesFechado && !efetivas.obrigacaoId && !criaObrigacao) return setErro("Escolha a conta da obrigação (imposto a recolher) desta guia.");
      const r = await salvarGuia(empresaId, competencia, guia ? { guiaId: guia.id } : { path: path! }, {
        tipo, descricao, valor: valorOk, vencimento, codigoReceita: codigo,
      }, efetivas.obrigacaoId && !mesFechado ? { obrigacaoId: efetivas.obrigacaoId, despesaId: efetivas.despesaId } : null);
      if ("erro" in r) return setErro(r.erro);
      const nome = rotuloGuia({ tipo, descricao: descricao.trim() || null });
      if (r.aviso) toast.warning(guia ? "Guia atualizada." : `${nome} anexado.`, { description: r.aviso });
      else toast.success(guia ? "Guia atualizada." : `${nome} anexado.`, { description: mesFechado ? undefined : "Obrigação registrada em Títulos a pagar." });
      onSalvo();
    });

  // Slot de um tipo esperado, mas o PDF parece ser de outro tipo: avisa (não troca sozinho).
  const outroTipo = slot && detectado && detectado !== tipo;

  return (
    <div className="grid gap-4">
      <Erro>{erro}</Erro>
      {!guia && (
        <div className="grid gap-2">
          <Label htmlFor={id("pdf")}>PDF da guia</Label>
          <Input
            id={id("pdf")}
            type="file"
            accept=".pdf,application/pdf"
            aria-invalid={!!erros.guia}
            aria-describedby={id("pdf-ajuda")}
            disabled={pendente}
            onChange={(e) => escolher(e.target.files?.[0])}
          />
          <div id={id("pdf-ajuda")}>
            {erros.guia ? (
              <Ajuda id={id("pdf-erro")} erro={erros.guia} />
            ) : leitura ? (
              <ResumoLeitura leitura={leitura} />
            ) : (
              <Ajuda id={id("pdf-dica")}>Ao anexar, lemos o valor, o vencimento e o tipo da guia.</Ajuda>
            )}
          </div>
          {outroTipo && (
            <Aviso>
              Este PDF parece ser {nomeTipoGuia(detectado)}, não {nomeTipoGuia(tipo)}. Confira o arquivo ou troque o tipo abaixo.
            </Aviso>
          )}
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div className="grid content-start gap-2">
          <Label htmlFor={id("tipo")}>Tipo</Label>
          <select id={id("tipo")} value={tipo} onChange={(e) => setTipo(e.target.value as TipoGuia)} className={SELECT} disabled={pendente}>
            {TIPOS_GUIA.map((t) => (
              <option key={t} value={t}>{nomeTipoGuia(t)}</option>
            ))}
          </select>
        </div>
        <div className="grid content-start gap-2">
          <Label htmlFor={id("codigo")}>
            Código da receita <span className="font-normal text-muted-foreground">(opcional)</span>
          </Label>
          <Input id={id("codigo")} value={codigo} onChange={(e) => setCodigo(e.target.value)} maxLength={20} inputMode="numeric" disabled={pendente} />
        </div>
      </div>
      {tipo === "outra" && (
        <div className="grid gap-2">
          <Label htmlFor={id("descricao")}>Nome da guia</Label>
          <Input
            id={id("descricao")}
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            maxLength={120}
            placeholder="Ex.: Parcelamento do Simples"
            disabled={pendente}
          />
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div className="grid content-start gap-2">
          <Label htmlFor={id("valor")}>Valor (R$)</Label>
          <Input
            id={id("valor")}
            inputMode="decimal"
            placeholder="0,00"
            autoComplete="off"
            value={valor}
            aria-invalid={!!erros.valor}
            aria-describedby={id("valor-ajuda")}
            disabled={pendente}
            onChange={(e) => {
              setValor(e.target.value);
              setErros((x) => ({ ...x, valor: undefined }));
            }}
          />
          <Ajuda id={id("valor-ajuda")} erro={erros.valor}>
            {valorOk ? <>O cliente vê <b className="font-medium text-foreground">R$ {fmtValor(valorOk)}</b></> : "Como está na guia."}
          </Ajuda>
        </div>
        <div className="grid content-start gap-2">
          <Label htmlFor={id("vencimento")}>Vencimento</Label>
          <Input
            id={id("vencimento")}
            type="date"
            value={vencimento}
            aria-invalid={!!erros.vencimento}
            aria-describedby={id("vencimento-ajuda")}
            disabled={pendente}
            onChange={(e) => {
              setVencimento(e.target.value);
              setErros((x) => ({ ...x, vencimento: undefined }));
            }}
          />
          {!erros.vencimento && vencimento && vencimento < hoje ? (
            <p id={id("vencimento-ajuda")} className="text-sm text-warning">Essa data já passou. Confira na guia.</p>
          ) : (
            <Ajuda id={id("vencimento-ajuda")} erro={erros.vencimento}>Como está na guia.</Ajuda>
          )}
        </div>
      </div>
      <Obrigacao contas={contas} competencia={competencia} valor={valorOk} mesFechado={mesFechado} tributo={mapa?.tributo}
        nota={mapa?.nota} efetivas={efetivas} criaObrigacao={criaObrigacao ? mapa?.obrigacao.criar?.nome : undefined}
        baixada={!!guia?.obrigacao?.baixada} onChange={setContasEscolhidas} />
      <DialogFooter>
        <DialogClose render={<Button variant="outline" type="button" />} disabled={pendente}>
          Cancelar
        </DialogClose>
        <Button onClick={salvar} disabled={pendente || lendo}>
          {guia ? <Pencil /> : <Paperclip />}
          {pendente ? "Salvando..." : lendo ? "Lendo a guia..." : guia ? "Salvar" : "Anexar guia"}
        </Button>
      </DialogFooter>
    </div>
  );
}

/**
 * Obrigação da guia (título a pagar na competência): conta a recolher, despesa (ou obrigação já registrada, sem
 * lançamento) e a prévia D/C. Tributo desconhecido pelo código: o contador escolhe.
 */
function Obrigacao({ contas, competencia, valor, mesFechado, tributo, nota, efetivas, criaObrigacao, baixada, onChange }: {
  contas: ContaOpcao[]; competencia: string; valor: string | null; mesFechado: boolean; tributo?: string; nota?: string;
  efetivas: { obrigacaoId: string | null; despesaId: string | null }; criaObrigacao?: string; baixada: boolean;
  onChange: (c: { obrigacaoId: string | null; despesaId: string | null }) => void;
}) {
  const passivo = contas.filter((c) => /^2\.[12]\./.test(c.codigo) && !c.papel);
  const despesas = contas.filter((c) => /^[13]\./.test(c.codigo) && !c.papel && !c.codigo.startsWith("1.1.1"));
  const jaRegistrada = !efetivas.despesaId;
  const previa = montarPrevia(() => {
    if (!valor) throw new Error("Informe o valor da guia para ver o lançamento.");
    if (!efetivas.obrigacaoId) throw new Error(criaObrigacao ? `A conta “${criaObrigacao}” será criada ao salvar.` : "Escolha a conta da obrigação.");
    if (jaRegistrada) throw new Error("Obrigação já registrada: só o título, sem lançamento (a baixa debita a conta a recolher).");
    return [{ data: fimDoMes(competencia), competencia, historico: `Título a pagar: ${tributo ?? "guia"}`, partidas: partidasTitulo("pagar", efetivas.obrigacaoId, efetivas.despesaId!, valor) }];
  });
  if (mesFechado)
    return <p className="rounded-lg border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">Mês fechado: a guia entra, mas a obrigação não é registrada em Títulos.</p>;
  return (
    <fieldset className="grid gap-3 rounded-lg border p-3">
      <legend className="px-1 text-sm font-medium">Obrigação em Títulos{tributo ? `: ${tributo}` : ""}</legend>
      {!tributo && <Aviso>Tributo não reconhecido pelo tipo/código: escolha a conta a recolher e a despesa.</Aviso>}
      {baixada && <Aviso>Esta obrigação já foi baixada na conciliação: valor e contas não mudam sem desfazer a baixa.</Aviso>}
      {nota && <p className="text-xs text-muted-foreground">{nota}</p>}
      <div className="grid gap-2">
        <Label>Obrigação (crédito)</Label>
        <ContaSelect contas={passivo} value={efetivas.obrigacaoId} onChange={(id) => onChange({ ...efetivas, obrigacaoId: id })}
          placeholder={criaObrigacao ? `${criaObrigacao} (será criada)` : "Imposto a recolher"} />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox checked={jaRegistrada} onCheckedChange={(c) => onChange({ ...efetivas, despesaId: c ? null : acharConta(contas, { prefixo: "3.2", re: /^impostos e taxas$/ })?.id ?? despesas.find((d) => /^3\.2/.test(d.codigo) && /impost/.test(norm(d.nome)))?.id ?? null })} />
        Obrigação já registrada (retenção na nota/folha): sem despesa
      </label>
      {!jaRegistrada && (
        <div className="grid gap-2">
          <Label>Despesa (débito)</Label>
          <ContaSelect contas={despesas} value={efetivas.despesaId} onChange={(id) => onChange({ ...efetivas, despesaId: id })} />
        </div>
      )}
      <PreviaLancamentos previa={previa} contas={contas} />
    </fieldset>
  );
}

/** Diálogo de anexar/editar; fechar sem salvar apaga o PDF já enviado. */
function GuiaDialog({ trigger, children, titulo, ...props }: Base & {
  slot: TipoGuia | null; guia?: GuiaView; vencimentoSugerido: string; titulo: string;
  /** Botão que abre (render do DialogTrigger); `children` é o conteúdo dele. */
  trigger: React.ReactElement; children: React.ReactNode;
}) {
  const [aberta, setAberta] = useState(false);
  const [chave, setChave] = useState(0); // formulário limpo a cada abertura
  const solto = useRef<string | null>(null);
  /** Troca o PDF solto; o anterior (arquivo trocado ou diálogo fechado) é apagado se nenhuma guia o usa. */
  const soltar = (p: string | null) => {
    if (solto.current && solto.current !== p) void descartarGuiaEnviada(props.empresaId, props.competencia, solto.current);
    solto.current = p;
  };
  return (
    <Dialog
      open={aberta}
      onOpenChange={(a) => {
        setAberta(a);
        if (a) setChave((k) => k + 1);
        else soltar(null);
      }}
    >
      <DialogTrigger render={trigger}>{children}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{titulo}</DialogTitle>
          <DialogDescription>
            {props.guia
              ? "Corrija os dados da guia. Para trocar o PDF, remova a guia e anexe de novo (antes do envio)."
              : `Competência de ${nomeCompetencia(props.competencia)}. A guia fica guardada aqui até você enviar ao cliente.`}
          </DialogDescription>
        </DialogHeader>
        <GuiaForm
          key={chave}
          {...props}
          onPath={soltar}
          onSalvo={() => {
            solto.current = null;
            setAberta(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

/** Badge e frase da guia na lista do contador. */
function Situacao({ g, hoje }: { g: GuiaView; hoje: string }) {
  if (!g.enviadoEm) return <Badge variant="muted">Não enviada</Badge>;
  const s = situacaoGuia(g, hoje);
  if (s.tipo === "paga") return <Badge variant="success">Paga em {diaSP(g.pagoEm!)}</Badge>;
  return <Badge variant={s.tipo === "vencida" ? "danger" : "brand"}>Enviada · {textoSituacao(s)}</Badge>;
}

function AcaoGuia({ empresaId, g, acao }: { empresaId: string; g: GuiaView; acao: "pagar" | "remover" }) {
  const [aberta, setAberta] = useState(false);
  const [pendente, iniciar] = useTransition();
  const nome = rotuloGuia(g);
  const confirmar = () =>
    iniciar(async () => {
      const r = acao === "pagar" ? await marcarGuiaPaga(empresaId, g.id) : await removerGuia(empresaId, g.id);
      if ("erro" in r) return void toast.error(r.erro);
      toast.success(acao === "remover" ? `${nome} removido.` : "todasPagas" in r && r.todasPagas ? "Guia paga. Todas as guias do mês estão pagas." : `${nome} marcado como pago.`);
      setAberta(false);
    });
  return (
    <Dialog open={aberta} onOpenChange={(a) => !pendente && setAberta(a)}>
      <DialogTrigger
        render={
          acao === "pagar" ? (
            <Button variant="outline" size="sm" title='Use quando o cliente pagou mas não clicou em "Já paguei".' />
          ) : (
            <Button variant="ghost" size="icon-sm" aria-label={`Remover ${nome}`} title="Remover" />
          )
        }
      >
        {acao === "pagar" ? <><BadgeCheck />Marcar como paga</> : <Trash2 />}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{acao === "pagar" ? `Marcar ${nome} como pago?` : `Remover ${nome}?`}</DialogTitle>
          <DialogDescription>
            {acao === "pagar"
              ? "Os lembretes desta guia param. O cliente vê a guia como paga no portal."
              : "A guia e o PDF são apagados e a obrigação dela em Títulos é cancelada (estorno). O cliente ainda não tinha recebido esta guia."}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />} disabled={pendente}>
            Cancelar
          </DialogClose>
          <Button variant={acao === "remover" ? "destructive" : "default"} onClick={confirmar} disabled={pendente}>
            {acao === "pagar" ? <BadgeCheck /> : <Trash2 />}
            {pendente ? "Salvando..." : acao === "pagar" ? "Marcar como paga" : "Remover"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Resultado do envio: para quem foi ou por que não saiu. */
function Resultado({ r, clientes, competencia }: { r: ResultadoEnvio; clientes: string[]; competencia: string }) {
  const { emails } = r;
  const ok = emails.total > 0 && !emails.naoConfigurado && emails.enviados === emails.total;
  const feito = r.qtd === 0 ? `${tituloCompetencia(competencia)} concluído` : r.qtd === 1 ? "Guia enviada" : `${r.qtd} guias enviadas`;
  const [titulo, texto] =
    r.qtd === 0
      ? [feito, "Não havia guia nova para enviar, então nenhum e-mail saiu."]
      : ok
        ? [`Enviado para ${listaEmails(clientes)}`, "O cliente recebeu o e-mail com os valores e vencimentos, e as guias já estão no portal. Depois de pagar, ele clica em \"Já paguei\" em cada uma."]
        : emails.total === 0
          ? [feito, "Ninguém da empresa tem acesso ao portal, então nenhum e-mail saiu. Avise o cliente por outro canal."]
          : emails.naoConfigurado
            ? [feito, "O envio de e-mail não está configurado no sistema. As guias estão no portal, mas avise o cliente por outro canal."]
            : [feito, `${emails.total - emails.enviados} de ${emails.total} e-mails falharam. Avise o cliente por outro canal.`];
  const Icone = ok || r.qtd === 0 ? CircleCheck : TriangleAlert;
  return (
    <>
      <div className="flex flex-col items-center gap-3 py-2 text-center" role="status">
        <span
          className={cn(
            "flex size-12 items-center justify-center rounded-lg",
            ok || r.qtd === 0 ? "bg-success-soft text-success" : "bg-warning-soft text-warning",
          )}
        >
          <Icone className="size-6" />
        </span>
        <p className="text-base font-semibold break-all text-foreground">{titulo}</p>
        <p className="max-w-sm text-sm text-muted-foreground">{texto}</p>
      </div>
      <DialogFooter>
        <DialogClose render={<Button />}>Concluído</DialogClose>
      </DialogFooter>
    </>
  );
}

/** "Concluir mês e enviar guias": confirma (listando o que falta, se faltar), envia e mostra para quem o e-mail foi. */
function EnviarGuias({ empresaId, competencia, rascunhos, faltando, clientes, extra, mostrar }: {
  empresaId: string; competencia: string; rascunhos: GuiaView[]; faltando: TipoGuia[]; clientes: string[]; extra: boolean;
  /** Botão visível. O componente fica montado enquanto o diálogo está aberto, para mostrar o resultado depois do envio. */
  mostrar: boolean;
}) {
  const [aberta, setAberta] = useState(false);
  const [resultado, setResultado] = useState<ResultadoEnvio | null>(null);
  const [erro, setErro] = useState<string>();
  const [pendente, iniciar] = useTransition();
  const enviar = () =>
    iniciar(async () => {
      setErro(undefined);
      const r = await enviarGuias(empresaId, competencia);
      if ("erro" in r) return setErro(r.erro);
      setResultado(r);
    });
  const n = rascunhos.length;
  // Mês reaberto sem guia nova (as enviadas estão todas pagas): só conclui de novo, sem e-mail.
  const soConcluir = n === 0;
  const rotulo = soConcluir ? "Concluir mês" : extra ? (n === 1 ? "Enviar a guia nova" : `Enviar as ${n} guias novas`) : "Concluir mês e enviar guias";
  if (!mostrar && !aberta) return null;
  return (
    <Dialog
      open={aberta}
      onOpenChange={(a) => {
        if (pendente) return;
        setAberta(a);
        if (a) {
          setResultado(null);
          setErro(undefined);
        }
      }}
    >
      <DialogTrigger render={<Button title={extra ? "O cliente recebe um e-mail só com a guia nova." : "Conclui o mês: o cliente recebe o e-mail com as guias e passa a vê-las no portal."} />}>
        <Send />
        {rotulo}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          {/* Depois do envio as props já vêm sem rascunhos: o cabeçalho passa a falar do resultado. */}
          <DialogTitle>
            {resultado
              ? `Guias de ${nomeCompetencia(competencia)}`
              : soConcluir ? `Concluir ${nomeCompetencia(competencia)}` : extra ? "Enviar guia nova" : `Concluir ${nomeCompetencia(competencia)} e enviar as guias`}
          </DialogTitle>
          <DialogDescription className={cn(resultado && "sr-only")}>
            {soConcluir
              ? "Não há guia nova: as guias já enviadas continuam como estão. Nenhum e-mail sai."
              : extra
                ? "O cliente recebe um e-mail só com esta guia."
                : "O mês fica concluído e o cliente passa a ver as guias no portal."}
          </DialogDescription>
        </DialogHeader>
        {resultado ? (
          <Resultado r={resultado} clientes={clientes} competencia={competencia} />
        ) : soConcluir ? (
          <>
            <Erro>{erro}</Erro>
            <DialogFooter>
              <DialogClose render={<Button variant="outline" />} disabled={pendente}>
                Cancelar
              </DialogClose>
              <Button onClick={enviar} disabled={pendente}>
                <CircleCheck />
                {pendente ? "Concluindo..." : "Concluir mês"}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <Erro>{erro}</Erro>
            {faltando.length > 0 && (
              <Aviso>
                <b className="font-semibold">Falta anexar: {listaTipos(faltando)}.</b> Esta empresa paga {faltando.length === 1 ? "essa guia" : "essas guias"} todo mês.
                Se não houver neste mês, pode enviar assim mesmo.
              </Aviso>
            )}
            <ul className="grid gap-1.5 rounded-lg border bg-muted/30 p-3 text-sm">
              {rascunhos.map((g) => (
                <li key={g.id} className="flex items-center justify-between gap-3">
                  <span className="font-medium">{rotuloGuia(g)}</span>
                  <span className="text-muted-foreground tabular-nums">R$ {fmtValor(g.valor)} · vence {fmtData(g.vencimento)}</span>
                </li>
              ))}
            </ul>
            {clientes.length > 0 ? (
              <p className="flex gap-3 text-sm leading-relaxed text-foreground/90">
                <Mail className="mt-0.5 size-4 shrink-0 text-primary" />
                <span>
                  Vamos mandar um e-mail para <b className="font-semibold break-all text-foreground">{listaEmails(clientes)}</b> com{" "}
                  {n === 1 ? "o valor e o vencimento" : "os valores, os vencimentos e o total"} e o link para baixar no portal.
                </span>
              </p>
            ) : (
              <Aviso>Ninguém da empresa tem acesso ao portal ainda. As guias ficam no portal, mas nenhum e-mail sai: avise o cliente por outro canal.</Aviso>
            )}
            <DialogFooter className="items-center sm:justify-between">
              <VerEmail empresaId={empresaId} tipo="guias_disponiveis" dados={{ competencia }} para={clientes.length ? listaEmails(clientes) : undefined} />
              <div className="flex flex-col-reverse gap-2 sm:flex-row">
                <DialogClose render={<Button variant="outline" />} disabled={pendente}>
                  Cancelar
                </DialogClose>
                <Button onClick={enviar} disabled={pendente}>
                  <Send />
                  {pendente ? "Enviando..." : faltando.length ? "Enviar mesmo assim" : clientes.length ? "Enviar" : "Concluir mês"}
                </Button>
              </div>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * "Guias do mês" no fechamento: checklist das guias que a empresa paga (anexada / faltando), as demais guias anexadas,
 * e o envio ao cliente. Depois do envio dá para anexar mais uma guia (sai num e-mail próprio) e marcar como paga.
 */
export function GuiasDoMes({ empresaId, competencia, hoje, status, esperadas, guias, clientes, vencimentoSugerido, contas, mesFechado }: Base & {
  status: string;
  esperadas: TipoGuia[];
  guias: GuiaView[];
  clientes: string[];
  vencimentoSugerido: string;
}) {
  const encerrado = status === "encerrado";
  const enviado = status === "das_enviado" || status === "das_pago";
  const rascunhos = guias.filter((g) => !g.enviadoEm);
  const faltando = guiasFaltando(esperadas, guias);
  const anexadas = esperadas.filter((t) => !faltando.includes(t)).length;
  const total = resumoGuias(guias, hoje).total;
  const base = { empresaId, competencia, hoje, vencimentoSugerido, contas, mesFechado };
  const extras = guias.filter((g) => !esperadas.includes(g.tipo));

  const linhaGuia = (g: GuiaView) => (
    <li key={g.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-success-soft text-success">
        <CircleCheck className="size-4" aria-label="Anexada" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-foreground">{rotuloGuia(g)}</span>
          <Situacao g={g} hoje={hoje} />
        </span>
        <span className="block text-sm text-muted-foreground tabular-nums">
          R$ {fmtValor(g.valor)} · vence {fmtData(g.vencimento)}
          {g.codigoReceita && <> · código {g.codigoReceita}</>}
        </span>
      </span>
      <span className="flex items-center gap-1">
        {g.enviadoEm && !g.pagoEm && status === "das_enviado" && <AcaoGuia empresaId={empresaId} g={g} acao="pagar" />}
        <Baixar empresaId={empresaId} guiaId={g.id} rotulo={`Baixar ${rotuloGuia(g)}`} size="icon-sm" variant="ghost" />
        {!encerrado && !g.pagoEm && (
          <GuiaDialog
            {...base}
            slot={g.tipo}
            guia={g}
            titulo={`Editar ${rotuloGuia(g)}`}
            trigger={<Button variant="ghost" size="icon-sm" aria-label={`Editar ${rotuloGuia(g)}`} title="Editar" />}
          >
            <Pencil />
          </GuiaDialog>
        )}
        {!encerrado && !g.enviadoEm && <AcaoGuia empresaId={empresaId} g={g} acao="remover" />}
      </span>
    </li>
  );

  return (
    <section aria-labelledby="guias-do-mes" className="grid gap-3 border-t px-6 pt-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id="guias-do-mes" className="scroll-mt-24 text-sm font-semibold">Guias do mês</h3>
        <span className="text-sm text-muted-foreground tabular-nums">
          {esperadas.length > 0 && <>{anexadas} de {esperadas.length} esperadas anexadas</>}
          {guias.length > 0 && <> · total R$ {fmtValor(total)}</>}
        </span>
      </div>
      <ul className="divide-y rounded-lg border bg-card">
        {esperadas.map((t) => {
          const doTipo = guias.filter((g) => g.tipo === t);
          if (doTipo.length) return doTipo.map(linhaGuia);
          return (
            <li key={t} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-dashed text-muted-foreground">
                <CircleDashed className="size-4" aria-label="Faltando" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-foreground">{nomeTipoGuia(t)}</span>
                <span className="block text-sm text-warning">Faltando</span>
              </span>
              {!encerrado && (
                <GuiaDialog
                  {...base}
                  slot={t}
                  titulo={`Anexar ${nomeTipoGuia(t)}`}
                  trigger={<Button variant="outline" size="sm" />}
                >
                  <Paperclip />
                  Anexar guia
                </GuiaDialog>
              )}
            </li>
          );
        })}
        {extras.map(linhaGuia)}
        {esperadas.length === 0 && guias.length === 0 && (
          <li className="px-4 py-3 text-sm text-muted-foreground">Nenhuma guia anexada.</li>
        )}
      </ul>
      {!encerrado && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <GuiaDialog
            {...base}
            slot={null}
            titulo="Anexar outra guia"
            trigger={<Button variant="ghost" size="sm" />}
          >
            <Plus />
            Outra guia
          </GuiaDialog>
          <EnviarGuias
            empresaId={empresaId}
            competencia={competencia}
            rascunhos={rascunhos}
            faltando={faltando}
            clientes={clientes}
            extra={enviado}
            mostrar={rascunhos.length > 0 || (!enviado && guias.some((g) => g.enviadoEm))}
          />
        </div>
      )}
    </section>
  );
}
