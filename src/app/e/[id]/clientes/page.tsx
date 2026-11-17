import { Suspense } from "react";
import { connection } from "next/server";
import { asc, desc, eq, sql } from "drizzle-orm";
import { Info, Users } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Carregando, EmptyState, PageHeader, TablePanel } from "@/components/page-header";
import { db } from "@/db";
import { membros, notificacoes } from "@/db/schema";
import { ROTULO_NOTIFICACAO } from "@/lib/avisos";
import { adminClient } from "@/supabase/admin";
import { getEmpresa } from "../empresa";
import { ConvidarClienteDialog, ReenviarConviteDialog, RemoverClienteDialog } from "./clientes-dialogs";

const TZ = "America/Sao_Paulo";
const DESCRICAO = "Quem da empresa acessa o portal: por lá o cliente envia os extratos do mês e recebe as guias de imposto.";
const STATUS_AVISO = {
  enviado: { rotulo: "Enviado", badge: "success" },
  erro: { rotulo: "Erro", badge: "danger" },
  nao_configurado: { rotulo: "Não saiu (e-mail desligado)", badge: "muted" },
} as const;
const traco =<span className="text-muted-foreground">-</span>;
const quando = (d: Date | null) =>
  d ? d.toLocaleString("pt-BR", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : traco;

async function Clientes({ params }: PageProps<"/e/[id]/clientes">) {
  await connection();
  const { id } = await params;
  const empresa = await getEmpresa(id);
  const avisosQ = db
    .select()
    .from(notificacoes)
    .where(eq(notificacoes.empresaId, id))
    .orderBy(desc(notificacoes.createdAt))
    .limit(50);
  const listaQ = db
    .select({
      id: membros.id,
      nome: membros.nome,
      email: membros.email,
      userId: membros.userId,
      convidadoEm: membros.convidadoEm,
      ultimoAcesso: sql`(select last_sign_in_at from auth.users u where u.id = ${membros.userId})`.mapWith(membros.convidadoEm),
    })
    .from(membros)
    .where(eq(membros.empresaId, id))
    .orderBy(asc(membros.email));
  const [lista, avisos] = await Promise.all([listaQ, avisosQ]);

  return (
    <>
      <PageHeader title="Clientes" description={DESCRICAO} actions={lista.length > 0 && <ConvidarClienteDialog empresaId={id} empresa={empresa.razaoSocial} />} />
      {!adminClient() && (
        <Alert className="mb-4">
          <Info />
          <AlertDescription>
            Convites por e-mail desativados: configure SUPABASE_SERVICE_ROLE_KEY. Os clientes cadastrados ficam como convidados até lá.
          </AlertDescription>
        </Alert>
      )}
      {lista.length === 0 ? (
        <EmptyState
          icon={Users}
          title="Ninguém da empresa tem acesso ao portal ainda"
          hint="Convide o dono ou o responsável financeiro. Ele recebe um e-mail para criar a senha e, a partir daí, manda os extratos pelo portal em vez do WhatsApp."
          action={<ConvidarClienteDialog empresaId={id} empresa={empresa.razaoSocial} />}
        />
      ) : (
        <TablePanel>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5">Cliente</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Convidado em</TableHead>
                <TableHead>Último acesso</TableHead>
                <TableHead className="w-0" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {lista.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="pl-5">
                    <div className="flex items-center gap-3">
                      <Avatar url={null} texto={m.nome || m.email} className="size-9 text-sm" />
                      <div className="min-w-0">
                        <div className="truncate font-medium text-foreground">{m.nome || m.email}</div>
                        {m.nome && <div className="truncate text-xs text-muted-foreground">{m.email}</div>}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    {m.userId ? (
                      <Badge variant="success">Ativo</Badge>
                    ) : (
                      <Badge variant="warning" title="O cliente ainda não criou a senha pelo link do e-mail.">Aguardando aceite</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground tabular-nums">{quando(m.convidadoEm)}</TableCell>
                  <TableCell className="text-muted-foreground tabular-nums">{m.ultimoAcesso ? quando(m.ultimoAcesso) : "Nunca entrou"}</TableCell>
                  <TableCell className="pr-3">
                    <div className="flex justify-end gap-1.5">
                      {!m.userId && <ReenviarConviteDialog empresaId={id} membroId={m.id} email={m.email} nome={m.nome} />}
                      <RemoverClienteDialog empresaId={id} membroId={m.id} quem={m.nome || m.email} empresa={empresa.razaoSocial} ativo={!!m.userId} />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TablePanel>
      )}

      <div className="mt-8 mb-3">
        <h2 className="text-sm font-semibold text-foreground">Avisos enviados</h2>
        <p className="text-sm text-muted-foreground">E-mails ao cliente (convites, pedidos de extrato, lembretes, guias) e ao contador, do mais recente para o mais antigo.</p>
      </div>
      {avisos.length === 0 ? (
        <p className="rounded-xl border border-dashed bg-card px-5 py-6 text-sm text-muted-foreground">Nenhum e-mail enviado ainda para esta empresa.</p>
      ) : (
        <TablePanel>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5">Data</TableHead>
                <TableHead>E-mail</TableHead>
                <TableHead>Para</TableHead>
                <TableHead className="pr-5">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {avisos.map((n) => (
                <TableRow key={n.id}>
                  <TableCell className="pl-5 text-muted-foreground tabular-nums">{quando(n.createdAt)}</TableCell>
                  <TableCell>
                    <div className="font-medium text-foreground">{ROTULO_NOTIFICACAO[n.tipo]}</div>
                    <div className="max-w-80 truncate text-xs text-muted-foreground" title={n.assunto}>{n.assunto}</div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{n.para}</TableCell>
                  <TableCell className="pr-5">
                    <Badge variant={STATUS_AVISO[n.status].badge} title={n.erro ?? undefined}>
                      {STATUS_AVISO[n.status].rotulo}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TablePanel>
      )}
    </>
  );
}

export default function ClientesPage(props: PageProps<"/e/[id]/clientes">) {
  return (
    <Suspense fallback={<><PageHeader title="Clientes" description={DESCRICAO} /><Carregando /></>}>
      <Clientes {...props} />
    </Suspense>
  );
}
