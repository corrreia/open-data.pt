import type { DatasetDefinition } from "../../../catalog/define";

export const DATASET: DatasetDefinition = {
  title: "Oeiras hourly air quality, noise and weather",
  description:
    "Hourly QART station measurements from the latest published monthly CSV. Monthly publication, not live observations; timestamps and units are those supplied by the municipality.",
  licence: "cc-by",
  attribution: "Câmara Municipal de Oeiras via oeirasinterativa.oeiras.pt",
  topics: ["cities", "environment"],
  feeds: [
    {
      slug: "oeiras-hourly-environment-feed",
      config: {
        source: "ckan",
        host: "oeirasinterativa.oeiras.pt",
        apiPath: "/dadosabertos",
        dataset: "sensorizacao-relatorios-mensais-com-dados-de-qualidade-do-ar-pressao-sonora-e-meteorologia",
        resourceSelection: "latest-month",
        resourcePrefix: "qart_dados_medias_1h_",
        timeField: "Date",
        delimiter: ";",
        decimal: ",",
        measures: JSON.stringify({
          "CO - µg/m3": "µg/m³",
          "O3 - µg/m3": "µg/m³",
          "NO - µg/m3": "µg/m³",
          "NO2 - µg/m3": "µg/m³",
          "SO2 - µg/m3": "µg/m³",
          "Humidade - %": "%",
          "Temperatura - ℃": "°C",
          "PM 0.5 - µg/m3": "µg/m³",
          "PM 0.7 - µg/m3": "µg/m³",
          "PM 1 - µg/m3": "µg/m³",
          "PM 2.5 - µg/m3": "µg/m³",
          "PM 10 - µg/m3": "µg/m³",
          "LAeq,T - dB(A)": "dB(A)",
          "Velocidade do Vento - m/s": "m/s",
          "Direção do Vento - °": "°",
          "Pressão - mbar": "mbar",
          "Precipitação - mm": "mm",
        }),
      },
      policy: {
        name: "Oeiras monthly observations checked weekly",
        version: 1,
        collection: { cadenceSeconds: 604_800, timeoutSeconds: 90, maxBytes: 2 * 1024 * 1024, maxOutputBytes: 8 * 1024 * 1024, historyMode: "changes" },
      },
      staleAfterSeconds: 45 * 86_400,
    },
  ],
};
