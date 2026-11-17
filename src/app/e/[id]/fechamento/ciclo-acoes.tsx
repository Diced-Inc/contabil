"use client";

import { useRef, useState, useTransition } from "react";
import { BadgeCheck, CalendarCheck2, CircleCheck, FileCheck2, FileQuestion, LoaderCircle, Mail, RotateCcw, Send, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import { concluirCiclo, encerrarCiclo, lerGuiaEnviada, marcarDasPago, prepararDas, reabrirCiclo } from "@/actions/ciclo";
import { Erro } from "@/app/login/senha-forms";
import { VerEmail } from "@/components/ver-email";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MOTIVOS_ENCERRAMENTO, nomeCompetencia, tituloCompetencia, type MotivoEncerramento } from "@/lib/ciclo";
import type { Guia } from "@/lib/das";
import { fmtData, fmtValor, parseValorBR } from "@/lib/format";
import { createClient } from "@/supabase/client";

type Emails = { enviados: number; total: number; naoConfigurado: boolean };
const listaEmails = (xs: string[]) => (xs.length <= 2 ? xs.join(" e ") : `${xs.slice(0, 2).join(", ")} e mais ${xs.length - 2}`);

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

/** Resultado do envio: para quem foi ou por que não saiu. */
function Resultado({ emails, clientes, competencia }: { emails: Emails; clientes: string[]; competencia: string }) {
  const ok = emails.total > 0 && !emails.naoConfigurado && emails.enviados === emails.total;
  const concluido = `${tituloCompetencia(competencia)} concluído`;
  const [titulo, texto] = ok
    ? [`Enviado para ${listaEmails(clientes)}`, "O cliente recebeu o e-mail com o valor e o vencimento, e a guia já está no portal. Depois de pagar, ele clica em \"Já paguei\"."]
    : emails.total === 0
      ? [concluido, "Ninguém da empresa tem acesso ao portal, então nenhum e-mail saiu. Avise o cliente por outro canal."]
      : emails.naoConfigurado
        ? [concluido, "O envio de e-mail não está configurado no sistema. A guia está no portal, mas avise o cliente por outro canal."]
        : [concluido, `${emails.total - emails.enviados} de ${emails.total} e-mails falharam. Avise o cliente por outro canal.`];
  const Icone = ok ? CircleCheck : TriangleAlert;
  return (
    <>
      <div className="flex flex-col items-center gap-3 py-2 text-center" role="status">
        <span
          className={cn(
            "flex size-12 items-center justify-center rounded-full ring-8",
            ok ? "bg-success-soft text-success ring-success-soft/40" : "bg-warning-soft text-warning ring-warning-soft/40",
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

type Erros = Partial<Record<"guia" | "valor" | "vencimento", string>>;
type Props = {
  empresaId: string;
  competencia: string;
  vencimentoSugerido: string;
  /** E-mails dos clientes ativos (quem recebe o aviso). */
  clientes: string[];
  hoje: string;
};

type Leitura =
  | { estado: "lendo" }
  | { estado: "lida"; guia: Guia; fonte: "texto" | "ia" | null; avisos: string[] }
  | { estado: "falhou"; erro: string };

/** "2026-10" → "Outubro/2026" (como impresso no DAS). */
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
  ].filter(Boolean);
  return (
    <div className="grid gap-2" role="status">
      {partes.length ? (
        <p className="flex gap-2.5 rounded-lg border border-success/20 bg-success-soft px-3 py-2.5 text-sm text-foreground">
          <FileCheck2 className="mt-0.5 size-4 shrink-0 text-success" />
          <span>
            <span className="font-medium">Lemos o documento:</span> <span className="tabular-nums">{partes.join(" · ")}</span>
            <span className="block text-muted-foreground">
              {fonte === "ia" ? "Lido pela IA. " : ""}Confira os campos abaixo; dá para corrigir.
            </span>
          </span>
        </p>
      ) : (
        <p className="flex gap-2.5 rounded-lg border bg-muted/40 px-3 py-2.5 text-sm text-muted-foreground">
          <FileQuestion className="mt-0.5 size-4 shrink-0" />
          Não conseguimos ler o valor e o vencimento desta guia. Preencha abaixo.
        </p>
      )}
      {avisos.map((a) => (
        <Alert key={a} className="border-warning/25 bg-warning-soft text-warning *:data-[slot=alert-description]:text-warning/90">
          <TriangleAlert />
          <AlertDescription>{a}</AlertDescription>
        </Alert>
      ))}
    </div>
  );
}

function ConcluirForm({ empresaId, competencia, vencimentoSugerido, clientes, hoje, setPendente }: Props & { setPendente: (p: boolean) => void }) {
  const [erro, setErro] = useState<string>();
  const [erros, setErros] = useState<Erros>({});
  const [valor, setValor] = useState("");
  const [vencimento, setVencimento] = useState(vencimentoSugerido);
  const [emails, setEmails] = useState<Emails | null>(null);
  /** Guia já no Storage (enviada ao escolher o arquivo). */
  const [guiaPath, setGuiaPath] = useState<string | null>(null);
  const [leitura, setLeitura] = useState<Leitura | null>(null);
  const escolha = useRef(0); // ignora a leitura de um arquivo que já foi trocado
  const [pendente, iniciar] = useTransition();
  const valorOk = lerValor(valor);
  const lendo = leitura?.estado === "lendo";

  /** Ao escolher o PDF: envia direto ao Storage e lê no servidor para preencher valor e vencimento. */
  async function escolherGuia(pdf: File | undefined) {
    const vez = ++escolha.current;
    setGuiaPath(null);
    setLeitura(null);
    setErros((x) => ({ ...x, guia: undefined }));
    if (!pdf) return;
    if (!pdf.name.toLowerCase().endsWith(".pdf")) return setErros((x) => ({ ...x, guia: "A guia precisa ser um arquivo PDF." }));
    if (pdf.size > 10 * 1024 * 1024) return setErros((x) => ({ ...x, guia: "O PDF passa de 10 MB." }));
    setLeitura({ estado: "lendo" });
    try {
      const p = await prepararDas(empresaId, competencia);
      if ("erro" in p) throw new Error(p.erro);
      const [envio] = p.envios;
      const up = await createClient()
        .storage.from("documentos")
        .uploadToSignedUrl(envio.path, envio.token, new File([pdf], pdf.name, { type: "application/pdf" }));
      if (up.error) throw new Error(`Não foi possível enviar o PDF: ${up.error.message}`);
      if (vez !== escolha.current) return;
      setGuiaPath(envio.path);
      const r = await lerGuiaEnviada(empresaId, competencia, envio.path);
      if (vez !== escolha.current) return;
      if ("erro" in r) return setLeitura({ estado: "lida", guia: { tipo: null }, fonte: null, avisos: [] });
      setLeitura({ estado: "lida", guia: r.guia, fonte: r.fonte, avisos: r.avisos });
      if (r.guia.valor) setValor(fmtValor(r.guia.valor));
      if (r.guia.vencimento) setVencimento(r.guia.vencimento);
      setErros((x) => ({ ...x, valor: r.guia.valor ? undefined : x.valor, vencimento: r.guia.vencimento ? undefined : x.vencimento }));
    } catch (e) {
      if (vez === escolha.current) setLeitura({ estado: "falhou", erro: e instanceof Error ? e.message : "Não foi possível enviar o PDF." });
    }
  }

  const enviar = (form: FormData) =>
    iniciar(async () => {
      setErro(undefined);
      const e: Erros = {};
      if (!guiaPath) e.guia = erros.guia ?? (leitura?.estado === "falhou" ? "Escolha o PDF de novo." : "Escolha o PDF da guia do DAS.");
      if (!valor.trim()) e.valor = "Informe o valor do DAS.";
      else if (!valorOk) e.valor = "Valor inválido. Use o formato 1.234,56.";
      if (!vencimento) e.vencimento = "Informe a data de vencimento.";
      setErros(e);
      if (Object.keys(e).length || !guiaPath || !valorOk) return;

      setPendente(true);
      try {
        const r = await concluirCiclo(empresaId, competencia, {
          path: guiaPath,
          valor: valorOk,
          vencimento,
          observacao: String(form.get("observacao") ?? ""),
        });
        if ("erro" in r) return setErro(r.erro);
        setEmails(r.emails);
      } finally {
        setPendente(false);
      }
    });

  if (emails) return <Resultado emails={emails} clientes={clientes} competencia={competencia} />;

  return (
    <form action={enviar} noValidate className="grid gap-4">
      {clientes.length > 0 ? (
        <div className="flex gap-3 rounded-lg border bg-muted/40 p-4 text-sm leading-relaxed text-foreground/90">
          <Mail className="mt-0.5 size-4 shrink-0 text-primary" />
          <p>
            Vamos mandar um e-mail para <b className="font-semibold break-all text-foreground">{listaEmails(clientes)}</b> com o valor, o vencimento e
            o link para baixar a guia no portal.
          </p>
        </div>
      ) : (
        <Alert className="border-warning/25 bg-warning-soft text-warning *:data-[slot=alert-description]:text-warning/90">
          <TriangleAlert />
          <AlertDescription>
            Ninguém da empresa tem acesso ao portal ainda. O mês será concluído, mas nenhum e-mail sai: avise o cliente por outro canal.
          </AlertDescription>
        </Alert>
      )}
      <Erro>{erro}</Erro>
      <div className="grid gap-2">
        <Label htmlFor="das-guia">PDF da guia (PGDAS)</Label>
        <Input
          id="das-guia"
          name="guia"
          type="file"
          accept=".pdf,application/pdf"
          aria-invalid={!!erros.guia}
          aria-describedby={erros.guia ? "das-guia-erro" : "das-guia-ajuda"}
          disabled={pendente}
          onChange={(e) => escolherGuia(e.target.files?.[0])}
        />
        {erros.guia ? (
          <Ajuda id="das-guia-erro" erro={erros.guia} />
        ) : leitura ? (
          <div id="das-guia-ajuda">
            <ResumoLeitura leitura={leitura} />
          </div>
        ) : (
          <Ajuda id="das-guia-ajuda">Ao anexar, lemos o valor, o vencimento e o período da guia.</Ajuda>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="grid content-start gap-2">
          <Label htmlFor="das-valor">Valor (R$)</Label>
          <Input
            id="das-valor"
            name="valor"
            inputMode="decimal"
            placeholder="0,00"
            autoComplete="off"
            value={valor}
            aria-invalid={!!erros.valor}
            aria-describedby="das-valor-ajuda"
            onChange={(e) => {
              setValor(e.target.value);
              setErros((x) => ({ ...x, valor: undefined }));
            }}
          />
          <Ajuda id="das-valor-ajuda" erro={erros.valor}>
            {valorOk ? <>O cliente vê <b className="font-medium text-foreground">R$ {fmtValor(valorOk)}</b></> : "Como está na guia."}
          </Ajuda>
        </div>
        <div className="grid content-start gap-2">
          <Label htmlFor="das-vencimento">Vencimento</Label>
          <Input
            id="das-vencimento"
            name="vencimento"
            type="date"
            value={vencimento}
            aria-invalid={!!erros.vencimento}
            aria-describedby="das-vencimento-ajuda"
            onChange={(e) => {
              setVencimento(e.target.value);
              setErros((x) => ({ ...x, vencimento: undefined }));
            }}
          />
          {!erros.vencimento && vencimento && vencimento < hoje ? (
            <p id="das-vencimento-ajuda" className="text-sm text-warning">Essa data já passou. Confira na guia.</p>
          ) : (
            <Ajuda id="das-vencimento-ajuda" erro={erros.vencimento}>Em geral, dia 20.</Ajuda>
          )}
        </div>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="das-obs">
          Anotação interna <span className="font-normal text-muted-foreground">(opcional, o cliente não vê)</span>
        </Label>
        <Textarea id="das-obs" name="observacao" maxLength={1000} rows={2} />
      </div>
      <DialogFooter className="items-center sm:justify-between">
        <VerEmail
          empresaId={empresaId}
          tipo="das_disponivel"
          dados={{ competencia, valor: valorOk ?? undefined, vencimento: vencimento || undefined }}
          para={clientes.length ? listaEmails(clientes) : undefined}
        />
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          <DialogClose render={<Button variant="outline" type="button" />} disabled={pendente}>
            Cancelar
          </DialogClose>
          <Button type="submit" disabled={pendente || lendo}>
            <Send />
            {pendente ? "Enviando..." : lendo ? "Lendo a guia..." : clientes.length ? "Concluir e enviar" : "Concluir mês"}
          </Button>
        </div>
      </DialogFooter>
    </form>
  );
}

/** "Concluir mês e enviar DAS": envia o PDF da guia direto ao Storage, conclui o ciclo e mostra para quem o e-mail foi. */
export function ConcluirDasDialog(props: Props) {
  const [aberta, setAberta] = useState(false);
  const [pendente, setPendente] = useState(false);
  // key nova a cada abertura: formulário limpo depois de um envio
  const [chave, setChave] = useState(0);
  return (
    <Dialog
      open={aberta}
      onOpenChange={(a) => {
        if (pendente) return;
        setAberta(a);
        if (a) setChave((k) => k + 1);
      }}
    >
      <DialogTrigger render={<Button />}>
        <Send />
        Concluir mês e enviar DAS
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Concluir {nomeCompetencia(props.competencia)}</DialogTitle>
          <DialogDescription>Anexe a guia do DAS. O cliente passa a ver a guia no portal, com valor e vencimento.</DialogDescription>
        </DialogHeader>
        <ConcluirForm key={chave} {...props} setPendente={setPendente} />
      </DialogContent>
    </Dialog>
  );
}

export function CicloBotao({ empresaId, competencia, acao }: { empresaId: string; competencia: string; acao: "reabrir" | "pago" }) {
  const [pendente, iniciar] = useTransition();
  const executar = () =>
    iniciar(async () => {
      const r = await (acao === "reabrir" ? reabrirCiclo : marcarDasPago)(empresaId, competencia);
      if ("erro" in r) toast.error(r.erro);
      else toast.success(acao === "reabrir" ? "Mês reaberto. Conclua de novo para enviar outra guia." : "DAS marcado como pago.");
    });
  return (
    <Button
      variant="outline"
      onClick={executar}
      disabled={pendente}
      title={acao === "reabrir" ? "Volta o mês para em processamento, para corrigir e enviar outra guia." : "Use quando o cliente pagou mas não clicou em \"Já paguei\"."}
    >
      {acao === "reabrir" ? <RotateCcw /> : <BadgeCheck />}
      {acao === "reabrir" ? "Reabrir" : "Marcar DAS como pago"}
    </Button>
  );
}

/** "Encerrar mês sem DAS": motivo + anotação interna. Não manda e-mail; o mês sai das pendências e os lembretes param. */
export function EncerrarDialog({ empresaId, competencia }: { empresaId: string; competencia: string }) {
  const [aberta, setAberta] = useState(false);
  const [motivo, setMotivo] = useState<MotivoEncerramento | null>(null);
  const [observacao, setObservacao] = useState("");
  const [erro, setErro] = useState<string>();
  const [pendente, iniciar] = useTransition();
  const confirmar = () =>
    iniciar(async () => {
      if (!motivo) return setErro("Escolha o motivo.");
      const r = await encerrarCiclo(empresaId, competencia, { motivo, observacao });
      if ("erro" in r) return setErro(r.erro);
      toast.success(`${tituloCompetencia(competencia)} encerrado.`);
      setAberta(false);
    });
  return (
    <Dialog
      open={aberta}
      onOpenChange={(a) => {
        if (pendente) return;
        setAberta(a);
        if (a) {
          setMotivo(null);
          setObservacao("");
          setErro(undefined);
        }
      }}
    >
      <DialogTrigger render={<Button variant="outline" />}>
        <CalendarCheck2 />
        Encerrar mês sem DAS
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Encerrar {nomeCompetencia(competencia)} sem DAS</DialogTitle>
          <DialogDescription>O mês sai das pendências e o cliente para de receber lembretes. Nenhum e-mail é enviado.</DialogDescription>
        </DialogHeader>
        <Erro>{erro}</Erro>
        <fieldset className="grid gap-2">
          <legend className="mb-2 text-sm leading-none font-medium">Motivo</legend>
          {(Object.keys(MOTIVOS_ENCERRAMENTO) as MotivoEncerramento[]).map((m) => (
            <label
              key={m}
              className={cn(
                "flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 text-sm transition-colors hover:bg-muted/50",
                motivo === m && "border-primary bg-accent/50",
              )}
            >
              <input
                type="radio"
                name="encerrar-motivo"
                value={m}
                checked={motivo === m}
                onChange={() => (setMotivo(m), setErro(undefined))}
                className="size-4 accent-primary"
              />
              {MOTIVOS_ENCERRAMENTO[m].rotulo}
            </label>
          ))}
        </fieldset>
        <div className="grid gap-2">
          <Label htmlFor="encerrar-obs">
            Observação <span className="font-normal text-muted-foreground">(opcional, o cliente não vê)</span>
          </Label>
          <Textarea id="encerrar-obs" value={observacao} onChange={(e) => setObservacao(e.target.value)} maxLength={1000} rows={2} />
        </div>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />} disabled={pendente}>
            Cancelar
          </DialogClose>
          <Button onClick={confirmar} disabled={pendente}>
            <CalendarCheck2 />
            {pendente ? "Encerrando..." : "Encerrar mês"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
