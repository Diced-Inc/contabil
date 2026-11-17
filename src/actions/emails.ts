"use server";

import { and, asc, eq, isNull } from "drizzle-orm";
import { headers } from "next/headers";
import { z } from "zod";
import { getEmpresa } from "@/app/e/[id]/empresa";
import { db } from "@/db";
import { ciclosMensais, guias } from "@/db/schema";
import { competenciaAtual, nomeCompetencia, somarMeses } from "@/lib/ciclo";
import { emailConvite, emailGuiasDisponiveis, emailLembreteGuias, emailPedidoExtrato, type GuiaEmail } from "@/lib/email";
import { guiasEsperadas, nomeTipoGuia, rotuloGuia } from "@/lib/guias";
import { hoje } from "@/lib/format";

export type TipoPrevia = "convite" | "pedido_extrato" | "lembrete_extrato" | "guias_disponiveis" | "lembrete_das";
export type Previa = { assunto: string; html: string } | { erro: string };

const dadosSchema = z.object({
  nome: z.string().trim().max(80).optional(),
  competencia: z.string().regex(/^\d{4}-\d{2}-01$/).optional(),
});

const somarDias = (d: string, n: number) => new Date(Date.parse(d) + n * 86_400_000).toISOString().slice(0, 10);
const EXEMPLO: Record<string, string> = { das: "1250.00", das_mei: "81.05", darf_previdenciario: "330.00", darf_impostos: "2140.00" };

/**
 * Prévia do e-mail exatamente como o cliente recebe (mesmas funções de lib/email). Guias: as ainda não enviadas da competência,
 * se houver; senão as que a empresa paga todo mês, com valores de exemplo.
 */
export async function previaEmail(empresaId: string, tipo: TipoPrevia, dados: z.input<typeof dadosSchema> = {}): Promise<Previa> {
  const e = await getEmpresa(empresaId); // exige contador
  const empresa = e.razaoSocial;
  const d = dadosSchema.safeParse(dados);
  if (!d.success) return { erro: "Dados da prévia inválidos." };
  const hj = hoje();
  const site = process.env.NEXT_PUBLIC_SITE_URL || (await headers()).get("origin") || "";
  const portal = `${site}/portal/${empresaId}`;
  const comp = d.data.competencia ?? competenciaAtual(hj);
  const competencia = nomeCompetencia(comp);
  const exemplo = (vencimento: string): GuiaEmail[] =>
    guiasEsperadas({ regime: e.regimeTributario, temProLabore: e.temProLabore }).map((t) => ({ nome: nomeTipoGuia(t), valor: EXEMPLO[t], vencimento }));

  switch (tipo) {
    case "convite":
      // O link real é gerado no envio (token de 24 horas).
      return emailConvite({ nome: d.data.nome || null, empresa, link: `${site}/login/confirmar?token_hash=exemplo&proximo=definir-senha` });
    case "pedido_extrato":
    case "lembrete_extrato":
      return emailPedidoExtrato({ empresa, competencia, link: portal, lembrete: tipo === "lembrete_extrato" });
    case "guias_disponiveis": {
      const [ciclo] = d.data.competencia
        ? await db
            .select({ id: ciclosMensais.id, concluidoEm: ciclosMensais.concluidoEm })
            .from(ciclosMensais)
            .where(and(eq(ciclosMensais.empresaId, empresaId), eq(ciclosMensais.competencia, comp)))
        : [];
      const rascunhos = ciclo
        ? await db
            .select({ tipo: guias.tipo, descricao: guias.descricao, valor: guias.valor, vencimento: guias.vencimento })
            .from(guias)
            .where(and(eq(guias.cicloId, ciclo.id), isNull(guias.enviadoEm)))
            .orderBy(asc(guias.vencimento))
        : [];
      return emailGuiasDisponiveis({
        empresa,
        competencia,
        guias: rascunhos.length
          ? rascunhos.map((g) => ({ nome: rotuloGuia(g), valor: g.valor, vencimento: g.vencimento }))
          : exemplo(`${somarMeses(comp, 1).slice(0, 8)}20`),
        extra: rascunhos.length > 0 && !!ciclo?.concluidoEm,
        link: portal,
      });
    }
    case "lembrete_das":
      return emailLembreteGuias({ empresa, competencia, guias: exemplo(somarDias(hj, 3)), dias: 3, link: portal });
  }
}
