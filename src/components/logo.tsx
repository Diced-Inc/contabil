import { cn } from "cn";

// Mesmo desenho de public/logo.svg (fonte de src/app/icon.svg, apple-icon.png e logo.png via scripts/icones.mjs).
const DB =
  "M5 8H10.5A5.5 5.5 0 0 1 16 13.5V18.5A5.5 5.5 0 0 1 10.5 24H5ZM8.25 11.25V20.75H10.5A2.25 2.25 0 0 0 12.75 18.5V13.5A2.25 2.25 0 0 0 10.5 11.25ZM18 8H22.25A4.25 4.25 0 0 1 22.25 16.5H18ZM21.25 11V13.5H22.25A1.25 1.25 0 0 0 22.25 11ZM18 13.5H23A4 4 0 0 1 27 17.5V20A4 4 0 0 1 23 24H18ZM21.25 16.5V20.75H22.75A1 1 0 0 0 23.75 19.75V17.5A1 1 0 0 0 22.75 16.5Z";

/** Monograma "DB" (DB Contador). `inverso` = quadro branco translúcido para fundos na cor da marca. */
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
      <path d={DB} fill="#fff" />
    </svg>
  );
}

export function LogoWordmark({ size = 32, inverso = false, className }: { size?: number; inverso?: boolean; className?: string }) {
  return (
    <span className={cn("flex items-center gap-2.5 text-[17px]", className)}>
      <Logo size={size} inverso={inverso} />
      <span className={cn("leading-none tracking-tight", inverso ? "text-white" : "text-foreground")}>
        <span className="font-semibold">DB</span> <span className={cn("font-normal", inverso ? "text-white/85" : "text-foreground/80")}>Contador</span>
      </span>
    </span>
  );
}
