import { Suspense } from "react";
import type { Metadata } from "next";
import { connection } from "next/server";
import Link from "next/link";
import { ArrowLeft, CloudOff, KeyRound } from "lucide-react";
import { Carregando, EmptyState, PageHeader } from "@/components/page-header";
import { Topo } from "@/components/topo";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { PERMISSAO_REGRAS } from "@/lib/email-routing";
import { requireUser } from "@/supabase/server";
import { carregarEmails } from "./dados";
import { AtualizarSozinho, DestinosCard, EnderecosCard, GuiaGmail, NovoEnderecoDialog } from "./emails-ui";

export const metadata: Metadata = { title: "E-mails do escritório | Bruno Contábil" };

const INTRO = "Endereços com o domínio do escritório. Tudo que chega neles cai no e-mail que você escolher.";

async function Conteudo() {
  await connection();
  await requireUser();
  const { dominio, enderecos, destinos, pendentes } = await carregarEmails();

  if (!dominio) {
    return (
      <EmptyState
        icon={KeyRound}
        title="Integração com o Cloudflare não configurada"
        hint="Falta configurar CLOUDFLARE_EMAIL_TOKEN, CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_ZONE_ID e EMAIL_DOMINIO no servidor. Peça ao Marcelo."
      />
    );
  }
  if ("erro" in destinos && "erro" in enderecos && destinos.erro === "indisponivel") {
    return <EmptyState icon={CloudOff} title="O Cloudflare não respondeu agora" hint="Os endereços continuam funcionando. Tente abrir esta tela de novo em alguns minutos." />;
  }

  const lista = "erro" in enderecos ? null : enderecos.dados;
  const listaDestinos = "erro" in destinos ? [] : destinos.dados;
  const confirmados = listaDestinos.filter((d) => d.verificado).map((d) => d.email);
  const aguardando = listaDestinos.some((d) => !d.verificado) || pendentes.length > 0;
  const exemplo = lista?.enderecos[0]?.endereco ?? `contato@${dominio}`;

  return (
    <>
      <PageHeader
        title="E-mails do escritório"
        description={INTRO}
        actions={<NovoEnderecoDialog dominio={dominio} destinos={listaDestinos} />}
      />
      {aguardando && <AtualizarSozinho />}
      <div className="grid gap-6">
        {"erro" in enderecos && (
          <Alert className="border-warning/25 bg-warning-soft text-warning *:data-[slot=alert-description]:text-warning/90">
            <KeyRound />
            <AlertTitle>{enderecos.erro === "permissao_regras" ? "Falta uma permissão no token do Cloudflare" : "Não deu para ler os endereços"}</AlertTitle>
            <AlertDescription>
              {enderecos.erro === "permissao_regras" ? (
                <p>
                  O token do Cloudflare precisa da permissão <b className="font-semibold">{PERMISSAO_REGRAS}</b>. Sem ela não dá para ver nem mudar os
                  endereços. Os novos endereços ficam guardados como pendentes e são criados quando a permissão for liberada.
                </p>
              ) : (
                <p>{enderecos.mensagem}</p>
              )}
            </AlertDescription>
          </Alert>
        )}
        {"erro" in destinos && (
          <Alert variant="destructive">
            <KeyRound />
            <AlertDescription>{destinos.mensagem}</AlertDescription>
          </Alert>
        )}
        <EnderecosCard dominio={dominio} lista={lista} pendentes={pendentes} destinos={listaDestinos} confirmados={confirmados} />
        {listaDestinos.length > 0 && <DestinosCard destinos={listaDestinos} />}
        <GuiaGmail exemplo={exemplo} />
      </div>
    </>
  );
}

export default function EmailsEscritorio() {
  return (
    <div className="flex min-h-svh flex-1 flex-col">
      <Topo />
      <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-8">
        <Link href="/" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground">
          <ArrowLeft className="size-4" />
          Empresas
        </Link>
        <Suspense
          fallback={
            <>
              <PageHeader title="E-mails do escritório" description={INTRO} />
              <Carregando />
            </>
          }
        >
          <Conteudo />
        </Suspense>
      </main>
    </div>
  );
}
