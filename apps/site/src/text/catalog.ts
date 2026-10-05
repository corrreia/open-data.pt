import { inLocale } from "../lib/locale";

/** The words the catalog describes datasets with: kinds of data, formats, update frequencies and freshness. */
export const CATALOG = inLocale({
  en: {
    roles: {
      reference: {
        label: "Reference",
        short: "Reference",
        description: "A complete set that changes slowly, such as stops or stations. Each collection replaces the whole set.",
      },
      "current-state": {
        label: "Current state",
        short: "Current",
        description: "The latest known state of each thing, such as where a vehicle is now. Each collection replaces it.",
      },
      "event-log": {
        label: "Events",
        short: "Events",
        description: "Things that happened, such as service alerts. When the publisher corrects or withdraws one, the change is kept beside the original.",
      },
      "time-series": {
        label: "Time series",
        short: "Series",
        description: "Numbers measured over time, one series per thing measured. When the publisher corrects a point, the correction is logged.",
      },
      summary: {
        label: "Summary",
        short: "Summary",
        description: "Totals worked out from another table in the same dataset, updated whenever that table is.",
      },
    },
    ownApi: "Own API",
    through: (format: string) => `through ${format}`,
    throughOwnApi: "through the publisher’s own API",
    updates: { live: "Several times an hour", daily: "Hourly to daily", slower: "Less often than daily" },
    rebuildFailed: "Last rebuild failed",
    late: "Late",
    current: "Current",
  },
  pt: {
    roles: {
      reference: {
        label: "Referência",
        short: "Referência",
        description: "Um conjunto completo que muda devagar, como paragens ou estações. Cada recolha substitui o conjunto inteiro.",
      },
      "current-state": {
        label: "Estado atual",
        short: "Atual",
        description: "O último estado conhecido de cada coisa, como o sítio onde um veículo está agora. Cada recolha substitui-o.",
      },
      "event-log": {
        label: "Eventos",
        short: "Eventos",
        description: "Coisas que aconteceram, como avisos de serviço. Quando a entidade publicadora corrige ou retira um, a alteração fica guardada ao lado do original.",
      },
      "time-series": {
        label: "Série temporal",
        short: "Série",
        description: "Números medidos ao longo do tempo, uma série por cada coisa medida. Quando a entidade publicadora corrige um ponto, a correção fica registada.",
      },
      summary: {
        label: "Resumo",
        short: "Resumo",
        description: "Totais calculados a partir de outra tabela do mesmo conjunto de dados, atualizados sempre que essa tabela o é.",
      },
    },
    ownApi: "API própria",
    through: (format: string) => `através de ${format}`,
    throughOwnApi: "através da API própria da entidade publicadora",
    updates: { live: "Várias vezes por hora", daily: "De hora a hora a diariamente", slower: "Menos de uma vez por dia" },
    rebuildFailed: "A última reconstrução falhou",
    late: "Atrasado",
    current: "Em dia",
  },
});
