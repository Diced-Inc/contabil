import Link from "next/link";
import { and, asc, count, eq, isNotNull, isNull } from "drizzle-orm";
import { Check, CircleCheck, MonitorSmartphone } from "lucide-react";
import { cn } from "cn";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardAction, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/db";
import { ciclosMensais, contasBancarias, guias, membros, type Empresa } from "@/db/schema";
import { proximoPedido } from "@/lib/avisos";
import { fmtData, hoje } from "@/lib/format";
import { resumoGuias } from "@/lib/guias";

type Passo = { titulo: string; dica: string; feito: boolean; href?: string; cta?: string };

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

/** Passo a passo do portal no Resumo; com tudo pronto vira uma linha de status. */
export async function PortalCard({ empresa }: { empresa: Empresa }) {
  const id = empresa.id;
  const [lista, [{ contas }], abertas] = await Promise.all([
    db
      .select({ email: membros.email, userId: membros.userId, aceitoEm: membros.aceitoEm })
      .from(membros)
      .where(eq(membros.empresaId, id))
      .orderBy(asc(membros.convidadoEm)),
    db.select({ contas: count() }).from(contasBancarias).where(and(eq(contasBancarias.empresaId, id), eq(contasBancarias.ativa, true))),
    // Guias enviadas e não pagas de meses em aberto, uma a uma.
    db
      .select({ valor: guias.valor, vencimento: guias.vencimento, pagoEm: guias.pagoEm })
      .from(guias)
      .innerJoin(ciclosMensais, eq(ciclosMensais.id, guias.cicloId))
      .where(and(eq(guias.empresaId, id), eq(ciclosMensais.status, "das_enviado"), isNotNull(guias.enviadoEm), isNull(guias.pagoEm))),
  ]);
  const g = resumoGuias(abertas, hoje());
  const situacaoGuias = [
    g.abertas > 0 && plural(g.abertas, "guia em aberto", "guias em aberto"),
    g.vencidas > 0 && plural(g.vencidas, "guia vencida", "guias vencidas"),
  ].filter(Boolean).join(", ");
  const ativos = lista.filter((m) => m.userId && m.aceitoEm);
  const faltaDados = [
    !empresa.cidade && "cidade",
    !empresa.uf && "UF",
    !empresa.responsavelNome && "nome do responsável",
    !empresa.responsavelCpf && "CPF do responsável",
  ].filter(Boolean);
  const outros = (n: number) => (n > 1 ? ` e mais ${n - 1}` : "");

  const passos: Passo[] = [
    {
      titulo: "Dados da empresa e responsável legal",
      feito: faltaDados.length === 0,
      dica: faltaDados.length === 0 ? "Preenchidos." : `Falta: ${faltaDados.join(", ")}.`,
      href: `/e/${id}/configuracoes#dados`,
      cta: "Preencher",
    },
    {
      titulo: "Convidar o cliente",
      feito: lista.length > 0,
      dica: lista.length
        ? `Convite enviado para ${lista[0].email}${outros(lista.length)}.`
        : "O dono ou o responsável financeiro recebe um e-mail para criar a senha do portal.",
      href: `/e/${id}/clientes`,
      cta: "Convidar",
    },
    {
      titulo: "Cliente aceitou o convite",
      feito: ativos.length > 0,
      ...(ativos.length
        ? { dica: `${ativos[0].email}${outros(ativos.length)} já entra no portal.` }
        : lista.length
          ? {
              dica: `Esperando ${lista[0].email} criar a senha pelo link do e-mail. Se não chegou, reenvie o convite.`,
              href: `/e/${id}/clientes`,
              cta: "Ver convite",
            }
          : { dica: "Acontece quando o cliente cria a senha pelo link do e-mail." }),
    },
    {
      titulo: "Avisos ao cliente ligados",
      feito: empresa.avisosAtivos,
      ...(empresa.avisosAtivos
        ? { dica: `O pedido dos extratos sai todo dia ${empresa.diaPedidoExtrato}, com lembretes.` }
        : ativos.length
          ? { dica: "Ligue os e-mails automáticos: pedido do extrato, lembretes e vencimento das guias.", href: `/e/${id}/configuracoes#avisos`, cta: "Configurar avisos" }
          : { dica: "Dá para ligar depois que o cliente aceitar o convite.", href: `/e/${id}/configuracoes#avisos`, cta: "Ver avisos" }),
    },
    {
      titulo: "Conta bancária cadastrada",
      feito: contas > 0,
      dica: contas ? `${plural(contas, "conta ativa", "contas ativas")}.` : "O cliente escolhe a conta ao enviar o extrato e você importa nela.",
      href: `/e/${id}/bancos`,
      cta: "Cadastrar conta",
    },
  ];
  const feitos = passos.filter((p) => p.feito).length;
  const proximo = passos.findIndex((p) => !p.feito);

  if (proximo === -1) {
    return (
      <div className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border bg-card px-4 py-3 shadow-card">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-success-soft text-success">
          <CircleCheck className="size-4" />
        </span>
        <p className="min-w-0 flex-1 text-sm text-muted-foreground">
          <b className="font-semibold text-foreground">Portal ativo</b>
          {" · "}próximo pedido de extrato em {fmtData(proximoPedido(hoje(), empresa.diaPedidoExtrato)).slice(0, 5)}
          {" · "}
          {plural(ativos.length, "cliente com acesso", "clientes com acesso")}
          {situacaoGuias && (
            <>
              {" · "}
              <Link href={`/e/${id}/fechamento`} className={cn("font-medium hover:underline", g.vencidas ? "text-danger" : "text-warning")}>
                {situacaoGuias}
              </Link>
            </>
          )}
        </p>
        <span className="flex gap-1">
          <Link href={`/e/${id}/clientes`} className={buttonVariants({ variant: "ghost", size: "sm" })}>
            Clientes
          </Link>
          <Link href={`/e/${id}/configuracoes#avisos`} className={buttonVariants({ variant: "ghost", size: "sm" })}>
            Avisos
          </Link>
        </span>
      </div>
    );
  }

  return (
    <Card className="mb-6 gap-0 pb-0">
      <CardHeader className="border-b">
        <CardTitle className="flex items-center gap-2.5">
          <span className="flex size-8 items-center justify-center rounded-md bg-accent text-primary">
            <MonitorSmartphone className="size-4" />
          </span>
          Portal do cliente
        </CardTitle>
        <CardDescription className="pl-10.5">
          Configure uma vez e o cliente passa a mandar os extratos pelo portal e a receber as guias por e-mail.
          {situacaoGuias && (
            <Link href={`/e/${id}/fechamento`} className={cn("mt-1 block font-medium hover:underline", g.vencidas ? "text-danger" : "text-warning")}>
              {situacaoGuias[0].toUpperCase() + situacaoGuias.slice(1)}
            </Link>
          )}
        </CardDescription>
        <CardAction className="flex items-center gap-3 pt-1.5">
          <span className="text-sm text-muted-foreground tabular-nums">
            <b className="font-semibold text-foreground">{feitos}</b> de {passos.length} prontos
          </span>
          <span
            className="h-1.5 w-24 overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-label="Passos prontos"
            aria-valuenow={feitos}
            aria-valuemin={0}
            aria-valuemax={passos.length}
          >
            <span className="block h-full rounded-full bg-primary" style={{ width: `${(feitos / passos.length) * 100}%` }} />
          </span>
        </CardAction>
      </CardHeader>
      <ol className="divide-y">
        {passos.map((p, i) => {
          const atual = i === proximo;
          return (
            <li key={p.titulo} className={cn("flex items-center gap-4 px-5 py-3.5", atual && "bg-accent/40")}>
              <span
                className={cn(
                  "flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums",
                  p.feito ? "bg-success-soft text-success" : atual ? "bg-primary text-primary-foreground" : "border bg-card text-muted-foreground",
                )}
              >
                {p.feito ? <Check className="size-4" aria-label="Pronto" /> : i + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className={cn("block text-sm font-medium", p.feito ? "text-muted-foreground" : "text-foreground")}>{p.titulo}</span>
                <span className="block text-sm text-muted-foreground">{p.dica}</span>
              </span>
              {!p.feito && p.href && (
                <Link href={p.href} className={buttonVariants({ variant: atual ? "default" : "outline", size: "sm" })}>
                  {p.cta}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
