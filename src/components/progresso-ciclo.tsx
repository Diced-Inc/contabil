import { Check } from "lucide-react";
import { cn } from "cn";
import { ORDEM_STATUS, type StatusCiclo } from "@/lib/ciclo";

const PASSOS = ["Enviar extratos", "Recebido", "Em processamento", "Guias disponíveis", "Pagas"];

/** Os 5 passos do mês (portal e fechamento); o atual em destaque. das_pago e encerrado (último em ORDEM_STATUS) completam todos. */
export function ProgressoCiclo({ status }: { status: StatusCiclo }) {
  const atual = ORDEM_STATUS.indexOf(status);
  return (
    <ol className="grid grid-cols-5 gap-1">
      {PASSOS.map((rotulo, i) => {
        const feito = i < atual || status === "das_pago";
        const agora = i === atual && !feito;
        return (
          <li key={rotulo} className="grid justify-items-center gap-2 text-center" aria-current={agora ? "step" : undefined}>
            <div className="relative flex w-full items-center justify-center">
              {i > 0 && <span aria-hidden className={cn("absolute right-1/2 h-0.5 w-full", i <= atual ? "bg-primary" : "bg-border")} />}
              <span
                className={cn(
                  "relative z-10 flex size-8 items-center justify-center rounded-full text-xs font-semibold tabular-nums",
                  feito && "bg-primary text-primary-foreground",
                  agora && "bg-card text-primary ring-2 ring-primary ring-offset-2 ring-offset-card",
                  !feito && !agora && "bg-muted text-muted-foreground",
                )}
              >
                {feito ? <Check className="size-4" /> : i + 1}
              </span>
            </div>
            {/* Celular: só o rótulo do passo atual, para não encavalar (os outros ficam para leitor de tela). */}
            <span className={cn("text-xs leading-tight", agora ? "font-semibold text-foreground" : "text-muted-foreground max-sm:sr-only")}>{rotulo}</span>
          </li>
        );
      })}
    </ol>
  );
}
