"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { getEmpresa } from "@/app/e/[id]/empresa";
import { competenciaAtual, nomeCompetencia, somarMeses } from "@/lib/ciclo";
import { emailConvite, emailDasDisponivel, emailLembreteDas, emailPedidoExtrato } from "@/lib/email";
import { hoje, parseValorBR } from "@/lib/format";

export type TipoPrevia = "convite" | "pedido_extrato" | "lembrete_extrato" | "das_disponivel" | "lembrete_das";
export type Previa = { assunto: string; html: string } | { erro: string };

const dadosSchema = z.object({
  nome: z.string().trim().max(80).optional(),
  competencia: z.string().regex(/^\d{4}-\d{2}-01$/).optional(),
  valor: z.string().max(20).optional(),
  vencimento: z.iso.date().optional(),
});

const somarDias = (d: string, n: number) => new Date(Date.parse(d) + n * 86_400_000).toISOString().slice(0, 10);

/** Prévia do e-mail exatamente como o cliente recebe (mesmas funções de lib/email), com dados de exemplo onde faltar. */
export async function previaEmail(empresaId: string, tipo: TipoPrevia, dados: z.input<typeof dadosSchema> = {}): Promise<Previa> {
  const empresa = (await getEmpresa(empresaId)).razaoSocial; // exige contador
  const d = dadosSchema.safeParse(dados);
  if (!d.success) return { erro: "Dados da prévia inválidos." };
  const hj = hoje();
  const site = process.env.NEXT_PUBLIC_SITE_URL || (await headers()).get("origin") || "";
  const portal = `${site}/portal/${empresaId}`;
  const comp = d.data.competencia ?? competenciaAtual(hj);
  const competencia = nomeCompetencia(comp);
  const v = parseValorBR(d.data.valor ?? "");
  const valor = /^\d+(\.\d{1,2})?$/.test(v) && Number(v) > 0 ? v : "1250.00";

  switch (tipo) {
    case "convite":
      // O link real é gerado no envio (token de 24 horas).
      return emailConvite({ nome: d.data.nome || null, empresa, link: `${site}/login/confirmar?token_hash=exemplo&proximo=definir-senha` });
    case "pedido_extrato":
    case "lembrete_extrato":
      return emailPedidoExtrato({ empresa, competencia, link: portal, lembrete: tipo === "lembrete_extrato" });
    case "das_disponivel":
      return emailDasDisponivel({
        empresa, competencia, valor, vencimento: d.data.vencimento ?? `${somarMeses(comp, 1).slice(0, 8)}20`, link: portal,
      });
    case "lembrete_das":
      return emailLembreteDas({ empresa, competencia, valor, vencimento: somarDias(hj, 3), dias: 3, link: portal });
  }
}
