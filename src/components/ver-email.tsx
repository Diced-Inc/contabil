"use client";

import { useState } from "react";
import { CircleAlert, Eye } from "lucide-react";
import { cn } from "cn";
import { previaEmail, type Previa, type TipoPrevia } from "@/actions/emails";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

/** "Ver e-mail": abre ao lado a prévia renderizada no servidor com o mesmo template do envio. */
export function VerEmail({ empresaId, tipo, dados, para, rotulo = "Ver e-mail", className }: {
  empresaId: string;
  tipo: TipoPrevia;
  dados?: { nome?: string; competencia?: string };
  /** Destinatário mostrado no cabeçalho (só exibição). */
  para?: string;
  rotulo?: string;
  className?: string;
}) {
  const [aberta, setAberta] = useState(false);
  const [previa, setPrevia] = useState<Previa | null>(null);
  const abrir = (a: boolean) => {
    setAberta(a);
    if (!a) return;
    setPrevia(null);
    previaEmail(empresaId, tipo, dados)
      .then(setPrevia)
      .catch(() => setPrevia({ erro: "Não foi possível carregar a prévia. Tente de novo." }));
  };

  return (
    <Sheet open={aberta} onOpenChange={abrir}>
      <SheetTrigger
        render={<Button type="button" variant="link" size="sm" className={cn("h-auto gap-1.5 px-0 font-medium", className)} />}
      >
        <Eye />
        {rotulo}
      </SheetTrigger>
      <SheetContent className="w-full gap-0 data-[side=right]:sm:max-w-[640px]">
        <SheetHeader>
          <SheetTitle>Prévia do e-mail</SheetTitle>
          <SheetDescription>É assim que o cliente recebe. Os links de verdade são gerados no envio.</SheetDescription>
        </SheetHeader>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 border-b px-6 py-4 text-sm">
          <dt className="text-muted-foreground">Para</dt>
          <dd className="truncate font-medium text-foreground">{para || "Clientes com acesso ao portal"}</dd>
          <dt className="text-muted-foreground">Assunto</dt>
          <dd className="font-medium text-foreground">
            {previa && "assunto" in previa ? previa.assunto : <span className="inline-block h-4 w-64 animate-pulse rounded bg-muted align-middle" />}
          </dd>
        </dl>
        <div className="min-h-0 flex-1 bg-[#f4f6f5]">
          {previa === null ? (
            <div className="m-6 h-96 animate-pulse rounded-2xl bg-white/70" aria-busy="true" aria-label="Carregando prévia" />
          ) : "erro" in previa ? (
            <p className="m-6 flex items-center gap-2 text-sm text-danger">
              <CircleAlert className="size-4" />
              {previa.erro}
            </p>
          ) : (
            // sandbox sem permissões: sem scripts e links não navegam.
            <iframe title="Prévia do e-mail" sandbox="" srcDoc={previa.html} className="size-full border-0" />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
