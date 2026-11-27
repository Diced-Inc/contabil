import { Suspense } from "react";
import { connection } from "next/server";
import Link from "next/link";
import { ArrowRight, ChevronLeft, ChevronRight, CircleCheck, CircleX, TriangleAlert } from "lucide-react";
import { cn } from "cn";
import { buttonVariants } from "@/components/ui/button";
import { Carregando, PageHeader } from "@/components/page-header";
import { checar, resumir, type ItemChecagem, type StatusChecagem } from "@/lib/checagem";
import { lerAno } from "@/lib/format";
import { getEmpresa } from "../empresa";

const DESCRICAO = "Conferências de consistência do exercício. Itens com erro impedem a apuração do resultado.";

const STATUS = {
  ok: { Icon: CircleCheck, cor: "text-success", fundo: "bg-success-soft", rotulo: "OK" },
  alerta: { Icon: TriangleAlert, cor: "text-warning", fundo: "bg-warning-soft", rotulo: "Alertas" },
  erro: { Icon: CircleX, cor: "text-danger", fundo: "bg-danger-soft", rotulo: "Erros" },
} satisfies Record<StatusChecagem, unknown>;

async function Checagem({ params, searchParams }: PageProps<"/e/[id]/checagem">) {
  await connection();
  const { id } = await params;
  const ano = lerAno((await searchParams).ano);
  await getEmpresa(id);
  const itens = await checar(id, ano);
  const total = resumir(itens);
  const ordem: StatusChecagem[] = ["erro", "alerta", "ok"];
  const ordenados = [...itens].sort((a, b) => ordem.indexOf(a.status) - ordem.indexOf(b.status));

  return (
    <>
      <PageHeader
        title="Checagem contábil"
        description={DESCRICAO}
        actions={
          <div className="flex items-center gap-1 rounded-lg border bg-card p-1 shadow-xs">
            <Link href={`/e/${id}/checagem?ano=${ano - 1}`} aria-label="Ano anterior" className={buttonVariants({ variant: "ghost", size: "icon-sm" })}>
              <ChevronLeft />
            </Link>
            <span className="w-16 text-center text-base font-semibold tabular-nums">{ano}</span>
            <Link href={`/e/${id}/checagem?ano=${ano + 1}`} aria-label="Próximo ano" className={buttonVariants({ variant: "ghost", size: "icon-sm" })}>
              <ChevronRight />
            </Link>
          </div>
        }
      />

      <div className="mb-6 grid grid-cols-3 gap-3">
        {(["ok", "alerta", "erro"] as const).map((s) => {
          const { Icon, cor, fundo, rotulo } = STATUS[s];
          return (
            <div key={s} className="flex items-center gap-3 rounded-xl border bg-card p-4 shadow-card">
              <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-md", fundo, cor)}>
                <Icon className="size-5" />
              </span>
              <div>
                <p className="font-display text-2xl font-semibold tracking-[-0.02em] tabular-nums">{total[s]}</p>
                <p className="text-xs text-muted-foreground">{rotulo}</p>
              </div>
            </div>
          );
        })}
      </div>

      <ul className="divide-y overflow-hidden rounded-xl border bg-card shadow-card">
        {ordenados.map((i) => {
          const { Icon, cor } = STATUS[i.status];
          return (
            <li key={i.id} className="flex items-start gap-3 p-4">
              <Icon className={cn("mt-0.5 size-5 shrink-0", cor)} aria-label={STATUS[i.status].rotulo} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{i.titulo}</p>
                <p className="text-sm text-muted-foreground">{i.detalhe}</p>
                {!!i.itens?.length && <Detalhes itens={i.itens} />}
              </div>
              {i.link && (
                <Link href={i.link} className={buttonVariants({ variant: "outline", size: "sm" })}>
                  Ver
                  <ArrowRight />
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}

/** Linhas do item; as com `grupo` ficam sob o título do grupo (na ordem em que aparecem). */
function Detalhes({ itens }: { itens: NonNullable<ItemChecagem["itens"]> }) {
  const grupos: { grupo?: string; itens: typeof itens }[] = [];
  for (const x of itens) {
    const g = grupos.at(-1);
    if (g && g.grupo === x.grupo) g.itens.push(x);
    else grupos.push({ grupo: x.grupo, itens: [x] });
  }
  return (
    <div className="mt-1.5 grid gap-2 text-xs">
      {grupos.map((g, k) => (
        <div key={k}>
          {g.grupo && <p className="mb-0.5 font-medium text-muted-foreground">{g.grupo}</p>}
          <ul className="grid gap-0.5">
            {g.itens.map((x, j) => (
              <li key={j}>
                <Link href={x.link} className="text-primary underline-offset-4 hover:underline">{x.texto}</Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

export default function ChecagemPage(props: PageProps<"/e/[id]/checagem">) {
  return (
    <Suspense fallback={<><PageHeader title="Checagem contábil" description={DESCRICAO} /><Carregando /></>}>
      <Checagem {...props} />
    </Suspense>
  );
}
