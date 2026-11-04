"use client";

import { useActionState, useEffect, useRef, useTransition } from "react";
import { ImageUp, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { atualizarFoto, removerFoto, salvarNome } from "@/actions/perfil";
import type { Resultado } from "@/app/login/actions";
import { Erro } from "@/app/login/senha-forms";
import { Avatar } from "@/components/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const TIPOS = "image/png,image/jpeg,image/webp";

export function PerfilForm({ nome, email, avatarUrl }: { nome: string; email: string; avatarUrl: string | null }) {
  const arquivo = useRef<HTMLInputElement>(null);
  const [enviando, iniciar] = useTransition();
  const [estado, enviar, salvando] = useActionState<Resultado, FormData>(salvarNome, {});
  useEffect(() => {
    if (estado.ok) toast.success("Nome salvo.");
  }, [estado]);

  const rodar = (acao: () => Promise<Resultado>, sucesso: string) =>
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
    fd.set("foto", f);
    rodar(() => atualizarFoto(fd), "Foto atualizada.");
  }

  return (
    <div className="grid gap-6">
      <div className="flex items-center gap-4">
        <Avatar url={avatarUrl} texto={nome || email} className="size-16 text-xl" />
        <div className="grid gap-2">
          <div className="flex flex-wrap gap-2">
            <input ref={arquivo} type="file" accept={TIPOS} className="hidden" onChange={escolher} aria-label="Foto de perfil" />
            <Button type="button" variant="outline" disabled={enviando} onClick={() => arquivo.current?.click()}>
              <ImageUp />
              Escolher foto
            </Button>
            {avatarUrl && (
              <Button type="button" variant="ghost" disabled={enviando} onClick={() => rodar(removerFoto, "Foto removida.")}>
                <Trash2 />
                Remover
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">PNG, JPEG ou WebP, até 2 MB. Recortada em quadrado.</p>
        </div>
      </div>
      <form action={enviar} className="grid gap-5">
        <Erro>{estado.erro}</Erro>
        <div className="grid gap-2">
          <Label htmlFor="nome">Nome de exibição</Label>
          <Input id="nome" name="nome" defaultValue={nome} maxLength={80} placeholder={email} autoComplete="name" />
        </div>
        <div>
          <Button type="submit" disabled={salvando}>
            <Save />
            Salvar
          </Button>
        </div>
      </form>
    </div>
  );
}
