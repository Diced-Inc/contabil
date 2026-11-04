import { cn } from "cn";

// Mesmo desenho de public/logo.svg (fonte de src/app/icon.svg e apple-icon.png via scripts/icones.mjs).
const B =
  "M8.5 7H17.25A4.25 4.25 0 0 1 17.25 15.5H8.5ZM8.5 15H18A5 5 0 0 1 18 25H8.5ZM11.75 10.25H16.5A1.25 1.25 0 0 1 16.5 12.75H11.75ZM11.75 18.75H18A1.25 1.25 0 0 1 18 21.25H11.75Z";

/** Marca "B" de livro-razão. `inverso` = quadro branco translúcido para fundos na cor da marca. */
export function Logo({ size = 32, inverso = false, className }: { size?: number; inverso?: boolean; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden className={cn("shrink-0", className)}>
      <rect
        width="32"
        height="32"
        rx="7.5"
        className={inverso ? "fill-white/15 stroke-white/30" : "fill-primary"}
        {...(inverso && { x: 0.5, y: 0.5, width: 31, height: 31, rx: 7 })}
      />
      <path d={B} fill="#fff" fillRule="evenodd" />
    </svg>
  );
}

export function LogoWordmark({ size = 32, inverso = false, className }: { size?: number; inverso?: boolean; className?: string }) {
  return (
    <span className={cn("flex items-center gap-2.5 text-[17px]", className)}>
      <Logo size={size} inverso={inverso} />
      <span className={cn("leading-none tracking-tight", inverso ? "text-white" : "text-foreground")}>
        <span className="font-normal">Bruno</span>{" "}
        <span className="font-semibold">Contábil</span>
      </span>
    </span>
  );
}
