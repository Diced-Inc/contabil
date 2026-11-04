import { cn } from "cn";

/** Foto do usuário (URL assinada) ou a inicial do nome/e-mail. */
export function Avatar({ url, texto, className }: { url: string | null; texto: string; className?: string }) {
  return (
    <span
      className={cn(
        "flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-accent text-xs font-semibold text-accent-foreground uppercase",
        className,
      )}
    >
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element -- URL assinada e temporária do Storage; o otimizador não ajuda aqui.
        <img src={url} alt="" className="size-full object-cover" />
      ) : (
        texto.trim().slice(0, 1)
      )}
    </span>
  );
}
