"use client";

import { useState, useTransition } from "react";
import { BadgeCheck, CircleCheck, Mail, RotateCcw, Send, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import { concluirCiclo, marcarDasPago, prepararDas, reabrirCiclo } from "@/actions/ciclo";
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
import { nomeCompetencia, tituloCompetencia } from "@/lib/ciclo";
import { fmtValor, parseValorBR } from "@/lib/format";
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

function ConcluirForm({ empresaId, competencia, vencimentoSugerido, clientes, hoje, setPendente }: Props & { setPendente: (p: boolean) => void }) {
  const [erro, setErro] = useState<string>();
  const [erros, setErros] = useState<Erros>({});
  const [valor, setValor] = useState("");
  const [vencimento, setVencimento] = useState(vencimentoSugerido);
  const [emails, setEmails] = useState<Emails | null>(null);
  const [pendente, iniciar] = useTransition();
  const valorOk = lerValor(valor);

  const enviar = (form: FormData) =>
    iniciar(async () => {
      setErro(undefined);
      const pdf = form.get("guia");
      const e: Erros = {};
      if (!(pdf instanceof File) || pdf.size === 0) e.guia = "Escolha o PDF da guia do DAS.";
      else if (!pdf.name.toLowerCase().endsWith(".pdf")) e.guia = "A guia precisa ser um arquivo PDF.";
      else if (pdf.size > 10 * 1024 * 1024) e.guia = "O PDF passa de 10 MB.";
      if (!valor.trim()) e.valor = "Informe o valor do DAS.";
      else if (!valorOk) e.valor = "Valor inválido. Use o formato 1.234,56.";
      if (!vencimento) e.vencimento = "Informe a data de vencimento.";
      setErros(e);
      if (Object.keys(e).length || !(pdf instanceof File) || !valorOk) return;

      setPendente(true);
      try {
        const p = await prepararDas(empresaId, competencia);
        if ("erro" in p) return setErro(p.erro);
        const [envio] = p.envios;
        const up = await createClient()
          .storage.from("documentos")
          .uploadToSignedUrl(envio.path, envio.token, new File([pdf], pdf.name, { type: "application/pdf" }));
        if (up.error) return setErro(`Não foi possível enviar o PDF: ${up.error.message}`);
        const r = await concluirCiclo(empresaId, competencia, {
          path: envio.path,
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
          aria-describedby={erros.guia ? "das-guia-erro" : undefined}
          onChange={() => setErros((x) => ({ ...x, guia: undefined }))}
        />
        {erros.guia && <Ajuda id="das-guia-erro" erro={erros.guia} />}
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
          <Button type="submit" disabled={pendente}>
            <Send />
            {pendente ? "Enviando..." : clientes.length ? "Concluir e enviar" : "Concluir mês"}
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
