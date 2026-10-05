import type { ReactNode } from "react";
import { inLocale } from "../lib/locale";

interface Rule {
  title: string;
  body: ReactNode;
}

interface RuleSection {
  eyebrow: string;
  title: string;
  intro: string;
  rules: Rule[];
}

interface AupText {
  eyebrow: string;
  title: string;
  intro: string;
  notOurs: RuleSection;
  api: RuleSection;
  publishers: RuleSection;
  contactTitle: string;
  /** The contact rule: the address, then a link to a new issue and to the repository, each given its words. */
  contact: (email: ReactNode, issue: (text: string) => ReactNode, repository: (text: string) => ReactNode) => ReactNode;
}

/** The acceptable-use page: the terms the data comes with, what we ask of API users, and how a publisher reaches us. */
export const AUP = inLocale<AupText>({
  en: {
    eyebrow: "Acceptable use",
    title: "What you may do with this data, and what we ask of you",
    intro:
      "open-data.pt republishes data other people made. It is free to read, needs no key and no account, and it comes with no warranty. These are the terms that come with it.",
    notOurs: {
      eyebrow: "The short version",
      title: "We do not own this data",
      intro:
        "Every dataset here belongs to the institution or operator that produced it, and travels under that publisher's terms — not ours. We cannot grant you rights we were never given, so we pass on exactly what each publisher states and nothing more.",
      rules: [
        {
          title: "Check the licence on the dataset",
          body: (
            <>
              Every product page names its licence and its attribution. Some are CC BY or CC0 and let you do as you like. Some are the publisher's own terms. Some say{" "}
              <em>no licence stated</em>, which means the publisher never said — not that there are no limits.
            </>
          ),
        },
        {
          title: "Some datasets are non-commercial",
          body: "A few publishers allow reuse only where no commercial purpose follows from it. Those datasets say so on their own page, in their own words. If you are building something commercial, read the licence before you depend on it.",
        },
        {
          title: "Credit the publisher, not us",
          body: "Each dataset carries the attribution its publisher asks for. Use that. Crediting open-data.pt instead of the institution that did the work is the one thing we would rather you never did.",
        },
        {
          title: "The data may be wrong, late, or gone",
          body: "We copy what a source served at the moment we read it. Sources change shape, go down, and correct themselves. Nothing here is authoritative: for anything that matters, go to the publisher.",
        },
      ],
    },
    api: {
      eyebrow: "Using the API",
      title: "Read as much as you need, within reason",
      intro: "There is no key, no quota and no account. That works because almost nobody abuses it, so the only rule is the obvious one.",
      rules: [
        {
          title: "Do not hammer it",
          body: "Feeds update on their own schedule — most daily, the fastest every three minutes. Polling faster than a dataset changes costs us money and gets you the same bytes. Each response tells you how fresh it is; use that.",
        },
        {
          title: "Cache what you fetch",
          body: "Responses carry ETags. Send them back and you will get a cheap 304 instead of a full body. If you are serving many users, cache on your side rather than passing every one of them through to us.",
        },
        {
          title: "Bulk reading is fine, within reason",
          body: "Take a whole product, or a year of its history — keeping what sources drop is half the point of this. Read it one request at a time and cache what comes back. If you need everything, over and over, the publisher's own bulk download is faster for you and kinder to a free service.",
        },
        {
          title: "No warranty, no uptime promise",
          body: "This is a free service run by one person. It can break, change, or stop. Do not put it under anything where failure hurts, and if you do, that is your call, not ours.",
        },
      ],
    },
    publishers: {
      eyebrow: "Publishers",
      title: "If this is your data and you want it changed or gone",
      intro:
        "We read only what a source serves publicly, and we take a publisher's own words about reuse as the limit. If we have got that wrong for your data, we would rather hear it from you than guess.",
      rules: [
        {
          title: "Ask us to stop, and we will",
          body: "If you publish one of these datasets and you do not want it republished here, write to us and we will remove it. We will not ask you to justify it and we will not argue about whether we were entitled to it.",
        },
        {
          title: "Tell us the right licence",
          body: (
            <>
              If a dataset shows <em>no licence stated</em> and you do have terms, or the licence we show is the wrong one, tell us which it is and we will correct it. Getting this
              right is the whole point of the page you are reading.
            </>
          ),
        },
        {
          title: "Tell us we are polling too hard",
          body: "If our collection is a burden on your service, say so and we will slow it down or stop. We would rather hold a stale copy than be a problem for the people producing the data.",
        },
      ],
    },
    contactTitle: "Contact",
    contact: (email, issue, repository) => (
      <>
        {email} reaches a person. For anything public — a broken dataset, a source worth adding — an {issue("issue")} on {repository("the repository")} is faster and leaves a trail
        others can read.
      </>
    ),
  },
  pt: {
    eyebrow: "Utilização aceitável",
    title: "O que pode fazer com estes dados, e o que lhe pedimos",
    intro:
      "O open-data.pt republica dados feitos por outras pessoas. É gratuito, não precisa de chave nem de conta, e não traz qualquer garantia. Estes são os termos que o acompanham.",
    notOurs: {
      eyebrow: "Em resumo",
      title: "Estes dados não são nossos",
      intro:
        "Cada conjunto de dados aqui pertence à instituição ou ao operador que o produziu, e circula nos termos dessa entidade publicadora — não nos nossos. Não podemos conceder direitos que nunca nos foram dados, por isso transmitimos exatamente o que cada entidade publicadora declara, e nada mais.",
      rules: [
        {
          title: "Verifique a licença do conjunto de dados",
          body: (
            <>
              A página de cada conjunto de dados indica a licença e a atribuição. Algumas são CC BY ou CC0 e permitem fazer o que quiser. Outras são os termos próprios da entidade
              publicadora. Outras dizem <em>sem licença declarada</em>, o que significa que a entidade publicadora nunca se pronunciou — não que não haja limites.
            </>
          ),
        },
        {
          title: "Alguns conjuntos de dados são não comerciais",
          body: "Algumas entidades publicadoras só permitem a reutilização quando dela não resulte qualquer fim comercial. Esses conjuntos de dados dizem-no na própria página, nas palavras da entidade. Se estiver a construir algo comercial, leia a licença antes de depender dela.",
        },
        {
          title: "Credite a entidade publicadora, não a nós",
          body: "Cada conjunto de dados traz a atribuição que a entidade publicadora pede. Use essa. Creditar o open-data.pt em vez da instituição que fez o trabalho é a única coisa que preferíamos que nunca fizesse.",
        },
        {
          title: "Os dados podem estar errados, atrasados ou desaparecer",
          body: "Copiamos o que uma origem serviu no momento em que a lemos. As origens mudam de forma, ficam em baixo e corrigem-se. Nada aqui tem valor oficial: para tudo o que importa, vá à entidade publicadora.",
        },
      ],
    },
    api: {
      eyebrow: "Usar a API",
      title: "Leia o que precisar, dentro do razoável",
      intro: "Não há chave, nem quota, nem conta. Isso funciona porque quase ninguém abusa, por isso a única regra é a óbvia.",
      rules: [
        {
          title: "Não a sobrecarregue",
          body: "As fontes atualizam-se ao seu próprio ritmo — a maioria diariamente, as mais rápidas a cada três minutos. Consultar mais depressa do que um conjunto de dados muda custa-nos dinheiro e devolve-lhe os mesmos bytes. Cada resposta diz quão recente é; use isso.",
        },
        {
          title: "Guarde em cache o que obtém",
          body: "As respostas trazem ETags. Envie-as de volta e receberá um 304 barato em vez da resposta completa. Se servir muitos utilizadores, guarde em cache do seu lado em vez de os encaminhar todos para nós.",
        },
        {
          title: "Ler em grande quantidade é aceitável, dentro do razoável",
          body: "Leve um conjunto de dados inteiro, ou um ano do seu histórico — guardar o que as origens deixam cair é metade da razão de ser disto. Leia-o um pedido de cada vez e guarde em cache o que receber. Se precisar de tudo, vezes sem conta, a transferência em massa da própria entidade publicadora é mais rápida para si e mais simpática para um serviço gratuito.",
        },
        {
          title: "Sem garantia, sem promessa de disponibilidade",
          body: "Este é um serviço gratuito mantido por uma pessoa. Pode avariar, mudar ou parar. Não o ponha por baixo de nada em que uma falha cause danos e, se o fizer, a decisão é sua, não nossa.",
        },
      ],
    },
    publishers: {
      eyebrow: "Entidades publicadoras",
      title: "Se estes dados são seus e os quer alterados ou retirados",
      intro:
        "Só lemos o que uma origem serve publicamente, e tomamos as palavras da própria entidade publicadora sobre a reutilização como o limite. Se nos enganámos quanto aos seus dados, preferimos ouvi-lo de si a adivinhar.",
      rules: [
        {
          title: "Peça-nos para parar, e paramos",
          body: "Se publica um destes conjuntos de dados e não quer que seja republicado aqui, escreva-nos e retiramo-lo. Não lhe pediremos que o justifique nem discutiremos se tínhamos direito a ele.",
        },
        {
          title: "Diga-nos qual é a licença certa",
          body: (
            <>
              Se um conjunto de dados mostra <em>sem licença declarada</em> e tem termos, ou se a licença que mostramos é a errada, diga-nos qual é e corrigimo-la. Acertar nisto é
              a razão de ser da página que está a ler.
            </>
          ),
        },
        {
          title: "Diga-nos se estamos a consultar demasiado",
          body: "Se a nossa recolha é um peso para o seu serviço, diga-o e abrandamos ou paramos. Preferimos guardar uma cópia desatualizada a ser um problema para quem produz os dados.",
        },
      ],
    },
    contactTitle: "Contacto",
    contact: (email, issue, repository) => (
      <>
        {email} chega a uma pessoa. Para tudo o que é público — um conjunto de dados avariado, uma origem que valha a pena acrescentar — uma {issue("issue")} no{" "}
        {repository("repositório")} é mais rápida e deixa um rasto que outros podem ler.
      </>
    ),
  },
});
