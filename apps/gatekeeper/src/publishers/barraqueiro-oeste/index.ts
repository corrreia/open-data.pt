import type { PublisherDefinition } from "#/catalog/define";
import { FEED as lisboaTorresVedras } from "./feeds/lisboa-torres-vedras";
import { FEED as lourinhaTorresVedras } from "./feeds/lourinha-torres-vedras";
import { FEED as network } from "./feeds/network";
import { FEED as praiaDeSantaCruzTorresVedras } from "./feeds/praia-de-santa-cruz-torres-vedras";
import { FEED as torresVedrasADosCunhados } from "./feeds/torres-vedras-a-dos-cunhados";
import { FEED as torresVedrasCampelos } from "./feeds/torres-vedras-campelos";
import { FEED as torresVedrasEriceira } from "./feeds/torres-vedras-ericeira";
import { FEED as torresVedrasLisboa } from "./feeds/torres-vedras-lisboa";
import { FEED as torresVedrasLourinha } from "./feeds/torres-vedras-lourinha";
import { FEED as torresVedrasPraiaDeSantaCruz } from "./feeds/torres-vedras-praia-de-santa-cruz";
import { FEED as torresVedrasSilveira } from "./feeds/torres-vedras-silveira";
import { FEED as torresVedrasTurcifal } from "./feeds/torres-vedras-turcifal";

export const PUBLISHER: PublisherDefinition = {
  name: "Barraqueiro Oeste",
  sources: ["myinfo.4cloud.pt"],
  logo: "png",
  feeds: [
    /*
     * Torres Vedras publishes nothing itself — its services portal is behind a
     * login and its geoportal proxies every layer from hosts inside the building —
     * so the concelho reaches this catalog through the operator that serves it.
     * Beside the network, a timetable feed for each place Barraqueiro Oeste runs to
     * from the town, as its own search offers them: the beach, the western parishes
     * and the neighbouring concelhos, and the long-distance pairs to Lisbon and
     * Ericeira. Maxial, Dois Portos and Runa are offered by the search but answer it
     * with no trips: the operator reaches them, but not on a service that starts in
     * Torres Vedras. Zones in their configurations are the search's own codes:
     * Torres Vedras 4384, Lisboa 4325.
     */
    lisboaTorresVedras,
    lourinhaTorresVedras,
    network,
    praiaDeSantaCruzTorresVedras,
    torresVedrasADosCunhados,
    torresVedrasCampelos,
    torresVedrasEriceira,
    torresVedrasLisboa,
    torresVedrasLourinha,
    torresVedrasPraiaDeSantaCruz,
    torresVedrasSilveira,
    torresVedrasTurcifal,
  ],
};
