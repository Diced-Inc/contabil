import { Suspense } from "react";
import { Casca } from "../casca";
import { RecuperarForm } from "../senha-forms";

async function Form({ searchParams }: Pick<PageProps<"/login/recuperar">, "searchParams">) {
  const { erro } = await searchParams;
  return <RecuperarForm erroInicial={typeof erro === "string" ? erro : undefined} />;
}

export default function RecuperarPage({ searchParams }: PageProps<"/login/recuperar">) {
  return (
    <Casca titulo="Esqueci minha senha" descricao="Informe seu e-mail para receber um link de redefinição.">
      <Suspense>
        <Form searchParams={searchParams} />
      </Suspense>
    </Casca>
  );
}
