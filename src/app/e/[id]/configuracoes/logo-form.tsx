"use client";

import { useRef, useTransition } from "react";
import { ImageUp, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { atualizarLogo, removerLogo, type EstadoForm } from "@/actions/empresas";
import { Avatar } from "@/components/avatar";
import { Button } from "@/components/ui/button";

export function LogoForm({ empresaId, razaoSocial, logoUrl }: { empresaId: string; razaoSocial: string; logoUrl: string | null }) {
  const arquivo = useRef<HTMLInputElement>(null);
  const [enviando, iniciar] = useTransition();

  const rodar = (acao: () => Promise<EstadoForm>, sucesso: string) =>
    iniciar(async () => {
      const r = await acao();
      if (r.erro) toast.error(r.erro);
      else toast.success(sucesso);
    });

  function escolher(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (f.size > 2 * 1024 * 1024) return void toast.error("A imagem passa de 2 MB.");
    const fd = new FormData();
    fd.set("logo", f);
    rodar(() => atualizarLogo(empresaId, fd), "Logo atualizado.");
  }

  return (
    <div className="flex items-center gap-4">
      <Avatar url={logoUrl} texto={razaoSocial} className="size-16 rounded-xl text-xl" />
      <div className="grid gap-2">
        <div className="flex flex-wrap gap-2">
          <input ref={arquivo} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={escolher} aria-label="Logo da empresa" />
          <Button type="button" variant="outline" disabled={enviando} onClick={() => arquivo.current?.click()}>
            <ImageUp />
            Escolher imagem
          </Button>
          {logoUrl && (
            <Button type="button" variant="ghost" disabled={enviando} onClick={() => rodar(() => removerLogo(empresaId), "Logo removido.")}>
              <Trash2 />
              Remover
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">PNG, JPEG ou WebP, até 2 MB. Recortado em quadrado.</p>
      </div>
    </div>
  );
}
