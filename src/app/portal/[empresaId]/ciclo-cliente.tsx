"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, CloudUpload, FileText, Send, X } from "lucide-react";
import { cn } from "cn";
import { toast } from "sonner";
import { marcarDasPago, prepararEnvio, registrarEnvio } from "@/actions/ciclo";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { fmtTamanho, MAX_DOCUMENTO, mimeDocumento } from "@/lib/ciclo";
import { createClient } from "@/supabase/client";

const ACCEPT = ".ofx,.csv,.pdf,.png,.jpg,.jpeg";
const selectCls =
  "h-9 w-full cursor-pointer rounded-md border border-input bg-card px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

function problema(f: File) {
  if (!mimeDocumento(f.name)) return "Formato não aceito";
  if (f.size > MAX_DOCUMENTO) return "Maior que 10 MB";
  return null;
}

/** Área de envio: arrastar ou escolher arquivos, banco (quando há mais de um) e observação. */
export function EnvioExtratos({ empresaId, contas }: { empresaId: string; contas: { id: string; nome: string }[] }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [arquivos, setArquivos] = useState<File[]>([]);
  const [contaId, setContaId] = useState(contas.length === 1 ? contas[0].id : "");
  const [observacao, setObservacao] = useState("");
  const [arrastando, setArrastando] = useState(false);
  const [etapa, setEtapa] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();
  const validos = arquivos.filter((f) => !problema(f));
  const escolheConta = contas.length > 1;

  const adicionar = (lista: FileList | null) =>
    setArquivos((atuais) => [...atuais, ...Array.from(lista ?? []).filter((f) => !atuais.some((a) => a.name === f.name && a.size === f.size))]);

  const enviar = () =>
    iniciar(async () => {
      try {
        setEtapa("Preparando...");
        const p = await prepararEnvio(empresaId, validos.map((f) => ({ nome: f.name, tamanho: f.size })));
        if ("erro" in p) return void toast.error(p.erro);
        const bucket = createClient().storage.from("documentos");
        for (const [i, env] of p.envios.entries()) {
          setEtapa(`Enviando ${i + 1} de ${p.envios.length}...`);
          const f = validos[i];
          const { error } = await bucket.uploadToSignedUrl(env.path, env.token, new File([f], f.name, { type: env.mime }));
          if (error) return void toast.error(`${f.name}: ${error.message}`);
        }
        setEtapa("Finalizando...");
        const r = await registrarEnvio(empresaId, {
          arquivos: p.envios.map((e, i) => ({ path: e.path, nome: validos[i].name })),
          contaBancariaId: contaId && contaId !== "outro" ? contaId : null,
          observacao,
        });
        if ("erro" in r) return void toast.error(r.erro);
        toast.success(r.qtd === 1 ? "Arquivo enviado. O contador já foi avisado." : `${r.qtd} arquivos enviados. O contador já foi avisado.`);
        setArquivos([]);
        setObservacao("");
        router.refresh();
      } finally {
        setEtapa(null);
      }
    });

  return (
    <div className="grid gap-4">
      <button
        type="button"
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setArrastando(true);
        }}
        onDragLeave={() => setArrastando(false)}
        onDrop={(e) => {
          e.preventDefault();
          setArrastando(false);
          adicionar(e.dataTransfer.files);
        }}
        disabled={pendente}
        className={cn(
          "flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed bg-muted/30 px-6 py-8 text-center transition-colors hover:border-primary/40 hover:bg-accent/40 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
          arrastando && "border-primary bg-accent/60",
        )}
      >
        <span className="flex size-11 items-center justify-center rounded-full bg-accent text-primary">
          <CloudUpload className="size-5" />
        </span>
        <span className="text-sm font-semibold text-foreground">Arraste os arquivos aqui ou clique para escolher</span>
        <span className="text-xs text-muted-foreground">Extratos em OFX, CSV ou PDF, e fotos (PNG/JPG). Até 10 MB cada.</span>
      </button>
      <input ref={input} type="file" accept={ACCEPT} multiple hidden onChange={(e) => (adicionar(e.target.files), (e.target.value = ""))} />

      {arquivos.length > 0 && (
        <ul className="grid gap-2">
          {arquivos.map((f, i) => {
            const erro = problema(f);
            return (
              <li key={`${f.name}-${i}`} className="flex items-center gap-3 rounded-lg border bg-card px-3 py-2 text-sm">
                <FileText className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{f.name}</span>
                  <span className={cn("text-xs", erro ? "text-danger" : "text-muted-foreground")}>{erro ?? fmtTamanho(f.size)}</span>
                </span>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remover ${f.name}`}
                  disabled={pendente}
                  onClick={() => setArquivos((xs) => xs.filter((_, j) => j !== i))}
                >
                  <X />
                </Button>
              </li>
            );
          })}
        </ul>
      )}

      {escolheConta && (
        <div className="grid gap-2">
          <Label htmlFor="envio-conta">De qual banco são os arquivos?</Label>
          <select id="envio-conta" value={contaId} onChange={(e) => setContaId(e.target.value)} className={selectCls} disabled={pendente}>
            <option value="" disabled>Selecione</option>
            {contas.map((c) => (
              <option key={c.id} value={c.id}>{c.nome}</option>
            ))}
            <option value="outro">Outro / vários bancos</option>
          </select>
        </div>
      )}
      <div className="grid gap-2">
        <Label htmlFor="envio-obs">Observação para o contador (opcional)</Label>
        <Textarea
          id="envio-obs"
          value={observacao}
          onChange={(e) => setObservacao(e.target.value)}
          maxLength={1000}
          placeholder="Ex.: faltou o extrato do cartão, mando amanhã."
          disabled={pendente}
        />
      </div>
      <Button onClick={enviar} disabled={pendente || validos.length === 0 || (escolheConta && !contaId)} className="justify-self-start">
        <Send />
        {etapa ?? (validos.length > 1 ? `Enviar ${validos.length} arquivos` : "Enviar")}
      </Button>
    </div>
  );
}

/** "Já paguei": confirma e avisa o contador. */
export function JaPaguei({ empresaId, competencia }: { empresaId: string; competencia: string }) {
  const [aberta, setAberta] = useState(false);
  const [pendente, iniciar] = useTransition();
  const confirmar = () =>
    iniciar(async () => {
      const r = await marcarDasPago(empresaId, competencia);
      if ("erro" in r) return void toast.error(r.erro);
      toast.success("Pagamento registrado. Obrigado!");
      setAberta(false);
    });
  return (
    <Dialog open={aberta} onOpenChange={setAberta}>
      <DialogTrigger render={<Button />}>
        <CheckCircle2 />
        Já paguei
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Confirmar o pagamento do DAS?</DialogTitle>
          <DialogDescription>O contador vai ver que a guia deste mês foi paga. Confirme só depois de pagar.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Ainda não</DialogClose>
          <Button onClick={confirmar} disabled={pendente}>
            <CheckCircle2 />
            {pendente ? "Registrando..." : "Sim, já paguei"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
