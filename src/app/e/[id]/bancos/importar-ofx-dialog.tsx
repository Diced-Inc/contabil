"use client";

import { useActionState, useEffect, useState } from "react";
import { CircleAlert, Upload } from "lucide-react";
import { toast } from "sonner";
import { importarOfx, type EstadoImportacao } from "@/actions/bancos";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const selectCls =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

function Form({ empresaId, contas, setAberta }: { empresaId: string; contas: { id: string; nome: string }[]; setAberta: (aberta: boolean) => void }) {
  const [estado, enviar, pendente] = useActionState<EstadoImportacao, FormData>(importarOfx.bind(null, empresaId), {});
  useEffect(() => {
    if (!estado.ok) return;
    const s = estado.sugestao;
    toast.success(`Importação concluída: ${estado.novas} novas, ${estado.repetidas} repetidas.`, {
      description: s && `Sugestões: ${s.regras} por regra, ${s.transferencias} transferências, ${s.ia} por IA.`,
    });
    if (s?.erros.length) toast.warning(`Falhas na sugestão: ${s.erros.join("; ")}`);
    setAberta(false);
  }, [estado, setAberta]);

  return (
    <form action={enviar} className="grid gap-4">
      {estado.erro && (
        <Alert variant="destructive">
          <CircleAlert />
          <AlertDescription>{estado.erro}</AlertDescription>
        </Alert>
      )}
      <div className="grid gap-2">
        <Label htmlFor="contaBancariaId">Conta bancária</Label>
        <select id="contaBancariaId" name="contaBancariaId" required className={selectCls} defaultValue={contas.length === 1 ? contas[0].id : ""}>
          <option value="" disabled>Selecione</option>
          {contas.map((c) => (
            <option key={c.id} value={c.id}>{c.nome}</option>
          ))}
        </select>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="arquivo">Arquivo OFX (até 4 MB)</Label>
        <Input id="arquivo" name="arquivo" type="file" accept=".ofx" required />
      </div>
      <Button type="submit" disabled={pendente}>
        <Upload />
        {pendente ? "Importando..." : "Importar"}
      </Button>
    </form>
  );
}

export function ImportarOfxDialog({ empresaId, contas }: { empresaId: string; contas: { id: string; nome: string }[] }) {
  const [aberta, setAberta] = useState(false);
  return (
    <Dialog open={aberta} onOpenChange={setAberta}>
      <DialogTrigger render={<Button disabled={contas.length === 0} />}>
        <Upload />
        Importar OFX
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Importar extrato OFX</DialogTitle>
        </DialogHeader>
        <Form empresaId={empresaId} contas={contas} setAberta={setAberta} />
      </DialogContent>
    </Dialog>
  );
}
