import { Suspense } from "react";
import { connection } from "next/server";
import { MailOpen, Receipt, Sparkles, Upload, type LucideIcon } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { fmtCnpj, PORTES, REGIMES } from "@/lib/format";
import { logoDaEmpresa, perfilDoUsuario } from "@/supabase/server";
import { getEmpresaPortal } from "../dados";
import { Rodape, Topo } from "../topo";

const PASSOS: [LucideIcon, string, string][] = [
  [MailOpen, "Pedido do mês", "No começo do mês você recebe um e-mail pedindo os extratos bancários."],
  [Upload, "Envio dos extratos", "Você sobe aqui os arquivos do banco (OFX, CSV ou PDF), sem WhatsApp."],
  [Receipt, "DAS pronto", "Quando o contador concluir o mês, a guia do DAS aparece aqui com valor e vencimento."],
];

function Dado({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-xs text-muted-foreground">{rotulo}</dt>
      <dd className="text-sm font-medium text-foreground">{children}</dd>
    </div>
  );
}

async function Conteudo({ params }: PageProps<"/portal/[empresaId]">) {
  await connection();
  const { empresaId } = await params;
  const { user, empresa } = await getEmpresaPortal(empresaId);
  const [perfil, logoUrl] = await Promise.all([perfilDoUsuario(user), logoDaEmpresa(empresa)]);
  const primeiroNome = perfil.nome.split(/\s+/)[0];
  const local = [empresa.cidade, empresa.uf].filter(Boolean).join("/");

  return (
    <>
      <Topo empresa={{ id: empresa.id, nome: empresa.razaoSocial, logoUrl }} usuario={{ ...perfil, email: user.email ?? "" }} />
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">
        <section className="relative overflow-hidden rounded-2xl bg-primary px-6 py-7 text-primary-foreground shadow-card sm:px-8">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-[0.08] [background-image:linear-gradient(to_right,white_1px,transparent_1px),linear-gradient(to_bottom,white_1px,transparent_1px)] [background-size:32px_32px]"
          />
          <div aria-hidden className="pointer-events-none absolute -top-24 -right-16 size-72 rounded-full bg-white/10 blur-3xl" />
          <div className="relative flex flex-wrap items-center gap-5">
            <Avatar
              url={logoUrl}
              texto={empresa.razaoSocial}
              className="size-16 rounded-2xl bg-white text-2xl text-primary shadow-sm ring-1 ring-white/30"
            />
            <div className="min-w-0 flex-1">
              <p className="text-sm text-white/75">{primeiroNome ? `Olá, ${primeiroNome}` : "Olá"}. Este é o portal da sua empresa.</p>
              <h1 className="mt-1 text-2xl leading-tight font-semibold tracking-tight text-balance">{empresa.razaoSocial}</h1>
              <p className="mt-1.5 text-sm text-white/75 tabular-nums">
                CNPJ {fmtCnpj(empresa.cnpj)}
                {local && <> · {local}</>}
              </p>
            </div>
          </div>
        </section>

        <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_320px]">
          <Card>
            <CardHeader className="border-b">
              <div className="flex items-start justify-between gap-3">
                <div className="grid gap-1">
                  <CardTitle>Em breve: envio de extratos e DAS por aqui</CardTitle>
                  <CardDescription>O fechamento do mês vai acontecer neste portal, em três passos.</CardDescription>
                </div>
                <Badge variant="brand" className="shrink-0">
                  <Sparkles />
                  Em breve
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              <ol className="relative grid gap-6 py-1">
                <span aria-hidden className="absolute top-5 bottom-5 left-[19px] w-px bg-border" />
                {PASSOS.map(([Icon, titulo, texto], i) => (
                  <li key={titulo} className="relative flex gap-4">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground ring-4 ring-card">
                      <Icon className="size-4.5" />
                    </span>
                    <div className="pt-0.5">
                      <p className="text-sm font-semibold text-foreground">
                        <span className="mr-1.5 text-muted-foreground tabular-nums">{i + 1}.</span>
                        {titulo}
                      </p>
                      <p className="mt-0.5 text-sm text-muted-foreground">{texto}</p>
                    </div>
                  </li>
                ))}
              </ol>
              <p className="mt-6 rounded-lg bg-muted/60 px-4 py-3 text-sm text-muted-foreground">
                Enquanto isso, continue mandando os documentos para o seu contador como de costume. Avisaremos por e-mail quando estiver no ar.
              </p>
            </CardContent>
          </Card>

          <div className="grid content-start gap-6">
            {empresa.contadorNome && (
              <Card>
                <CardHeader>
                  <CardDescription>Seu contador</CardDescription>
                </CardHeader>
                <CardContent className="flex items-center gap-3">
                  <Avatar url={null} texto={empresa.contadorNome} className="size-11 text-base" />
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-foreground">{empresa.contadorNome}</p>
                    {empresa.contadorCrc && <p className="text-xs text-muted-foreground">CRC {empresa.contadorCrc}</p>}
                  </div>
                </CardContent>
              </Card>
            )}
            <Card>
              <CardHeader className="border-b">
                <CardTitle>Dados da empresa</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="grid gap-4">
                  <Dado rotulo="Regime tributário">{REGIMES[empresa.regimeTributario]}</Dado>
                  {empresa.porte && <Dado rotulo="Porte">{PORTES[empresa.porte]}</Dado>}
                  {empresa.responsavelNome && <Dado rotulo="Responsável legal">{empresa.responsavelNome}</Dado>}
                  {local && <Dado rotulo="Cidade">{local}</Dado>}
                </dl>
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
      <Rodape />
    </>
  );
}

export default function PortalEmpresaPage(props: PageProps<"/portal/[empresaId]">) {
  return (
    <Suspense fallback={<div className="h-16 border-b bg-card" />}>
      <Conteudo {...props} />
    </Suspense>
  );
}
