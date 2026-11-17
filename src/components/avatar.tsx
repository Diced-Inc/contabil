import { cn } from "cn";

/** Foto do usuário (URL assinada) ou a inicial do nome/e-mail. `logo`: imagem inteira sobre fundo branco (logo de empresa). */
export function Avatar({ url, texto, logo, className }: { url: string | null; texto: string; logo?: boolean; className?: string }) {
  return (
    <span
      className={cn(
        "flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-accent text-xs font-semibold text-accent-foreground uppercase",
        logo && url && "bg-white ring-1 ring-border",
        className,
      )}
    >
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element -- URL assinada e temporária do Storage; o otimizador não ajuda aqui.
        <img src={url} alt="" className={logo ? "size-full bg-white object-contain p-0.5" : "size-full object-cover"} />
      ) : (
        texto.trim().slice(0, 1)
      )}
    </span>
  );
}
