import { fmt } from "../lib/format";
import { inLocale } from "../lib/locale";
import { LISTINGS } from "./listings";

/** The licences' index and each licence's page. */
export const LICENCE = inLocale({
  en: {
    indexEyebrow: "Licences",
    indexTitle: "The terms the data is served under",
    indexIntro: (licences: number, listings: number) =>
      `${licences === 1 ? "One set" : `${fmt.int(licences)} sets`} of terms over ${LISTINGS.count(listings)}, each as its publisher states it. Where a publisher states no licence, it is listed under “No licence stated”: check the publisher’s site before you reuse it. Cite the publisher, not open-data.pt.`,
    cardCount: (listings: number, publishers: number) => `${LISTINGS.count(listings)} · ${LISTINGS.publishers(publishers)}`,
    breadcrumb: "Licences",
    eyebrow: "Licence",
    fallbackDescription: (listings: number, publishers: number) =>
      `${LISTINGS.count(listings)} from ${LISTINGS.publishers(publishers)}, served under these terms as their publishers state them.`,
    readFullText: (host: string) => `Read the full text at ${host}`,
    publishers: "Publishers",
    servingUnder: "serving data under these terms",
    topics: "Topics",
    errorWhat: "the licences",
    loading: "Loading the licences",
    notFound: "Licence not found",
    notFoundDescription: "Nothing on open-data.pt is served under terms by that name.",
    all: "All licences",
  },
  pt: {
    indexEyebrow: "Licenças",
    indexTitle: "Os termos em que os dados são servidos",
    indexIntro: (licences: number, listings: number) =>
      `${licences === 1 ? "Um conjunto" : `${fmt.int(licences)} conjuntos`} de termos para ${LISTINGS.count(listings)}, cada um tal como a entidade publicadora o declara. Quando uma entidade não declara licença, os dados ficam em “No licence stated” (nenhuma licença declarada): confirme no site da entidade antes de os reutilizar. Cite a entidade publicadora, não o open-data.pt.`,
    cardCount: (listings: number, publishers: number) => `${LISTINGS.count(listings)} · ${LISTINGS.publishers(publishers)}`,
    breadcrumb: "Licenças",
    eyebrow: "Licença",
    fallbackDescription: (listings: number, publishers: number) =>
      `${LISTINGS.count(listings)} de ${LISTINGS.publishers(publishers)}, servidas nestes termos tal como as entidades publicadoras os declaram.`,
    readFullText: (host: string) => `Ler o texto completo em ${host}`,
    publishers: "Entidades publicadoras",
    servingUnder: "servem dados nestes termos",
    topics: "Temas",
    errorWhat: "as licenças",
    loading: "A carregar as licenças",
    notFound: "Licença não encontrada",
    notFoundDescription: "Nada no open-data.pt é servido em termos com esse nome.",
    all: "Todas as licenças",
  },
});
