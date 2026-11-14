import { eq } from "drizzle-orm";
import { db } from "@/db";
import { enderecosPendentes } from "@/db/schema";
import { criarEndereco, dominioEmail, listarDestinos, listarEnderecos } from "@/lib/email-routing";

/**
 * Lê endereços, destinos e pendentes e reconcilia: pendente cuja regra já existe é descartado;
 * pendente com destino confirmado vira regra. Roda a cada visita (sem cron).
 */
export async function carregarEmails() {
  const [enderecos, destinos, pendentes] = await Promise.all([listarEnderecos(), listarDestinos(), db.select().from(enderecosPendentes)]);
  const dominio = dominioEmail();
  let mudou = false;
  if (dominio && !("erro" in enderecos)) {
    const confirmados = new Set("erro" in destinos ? [] : destinos.dados.filter((d) => d.verificado).map((d) => d.email));
    for (const p of pendentes) {
      const existe = enderecos.dados.enderecos.some((e) => e.endereco === `${p.local}@${dominio}`);
      if (!existe && !confirmados.has(p.destino)) continue;
      if (!existe) {
        const r = await criarEndereco({ local: p.local, destino: p.destino, nome: p.nome ?? "" });
        if ("erro" in r) {
          console.error("[emails] pendente não virou regra:", p.local, r.mensagem);
          continue;
        }
      }
      await db.delete(enderecosPendentes).where(eq(enderecosPendentes.local, p.local));
      mudou = true;
    }
  }
  if (!mudou) return { dominio, enderecos, destinos, pendentes };
  const [e2, p2] = await Promise.all([listarEnderecos(), db.select().from(enderecosPendentes)]);
  return { dominio, enderecos: e2, destinos, pendentes: p2 };
}
