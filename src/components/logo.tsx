import { cn } from "cn";

// Mesmo desenho de public/logo.svg (fonte de src/app/icon.svg, apple-icon.png e logo.png via scripts/icones.mjs).
const DB = "M123 156h30a100 100 0 0 1 0 200h-30zM283 156h46a50 50 0 0 1 0 100h-46zM283 256h56a50 50 0 0 1 0 100h-56z";

/** Monograma "DB" (DB Contador). `inverso` = quadro branco translúcido para fundos na cor da marca. */
export function Logo({ size = 32, inverso = false, className }: { size?: number; inverso?: boolean; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" fill="none" aria-hidden className={cn("shrink-0", className)}>
      {inverso ? (
        <rect x="8" y="8" width="496" height="496" rx="106" className="fill-white/15 stroke-white/30" strokeWidth="16" />
      ) : (
        <rect width="512" height="512" rx="112" fill="#E9F5F0" />
      )}
      <path d={DB} stroke={inverso ? "#fff" : "#0F6E56"} strokeWidth="40" strokeLinejoin="round" />
      <circle cx="404" cy="380" r="22" fill="#F2B441" />
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
