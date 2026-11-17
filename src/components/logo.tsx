import { cn } from "cn";

// Mesmo desenho de public/logo.svg (fonte de src/app/icon.svg, apple-icon.png e logo.png via scripts/icones.mjs):
// "D" sólido cortado por duas linhas de livro-razão sobre o quadrado cobalto.
const COBALTO = "#1F4FD8";

/** Marca do DB Contador. `inverso` = quadrado branco com o "D" cobalto, para fundos na cor da marca ou escuros. */
export function Logo({ size = 32, inverso = false, className }: { size?: number; inverso?: boolean; className?: string }) {
  const fundo = inverso ? "#FFFFFF" : COBALTO;
  const letra = inverso ? COBALTO : "#FFFFFF";
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden className={cn("shrink-0", className)}>
      <rect width="32" height="32" rx="4" fill={fundo} />
      <path d="M8 7h7.5a9 9 0 0 1 0 18H8z" fill={letra} />
      <rect x="12.6" y="12.6" width="14" height="1.5" fill={fundo} />
      <rect x="12.6" y="17.9" width="14" height="1.5" fill={fundo} />
    </svg>
  );
}

export function LogoWordmark({ size = 32, inverso = false, className }: { size?: number; inverso?: boolean; className?: string }) {
  return (
    <span className={cn("flex items-center gap-2.5 text-base", className)}>
      <Logo size={size} inverso={inverso} />
      <span className={cn("font-display leading-none tracking-[-0.02em]", inverso ? "text-white" : "text-foreground")}>
        <span className="font-semibold">DB</span> <span className={cn("font-medium", inverso ? "text-white/62" : "text-foreground/62")}>Contador</span>
      </span>
    </span>
  );
}
