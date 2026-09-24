import type { PublisherDefinition } from "#/catalog/define";
import { FEED as bragaReference } from "./feeds/braga-reference";
import { FEED as braga } from "./feeds/braga";
import { FEED as cascaisReference } from "./feeds/cascais-reference";
import { FEED as cascais } from "./feeds/cascais";
import { FEED as lisbonReference } from "./feeds/lisbon-reference";
import { FEED as lisbon } from "./feeds/lisbon";
import { FEED as matosinhosReference } from "./feeds/matosinhos-reference";
import { FEED as matosinhos } from "./feeds/matosinhos";
import { FEED as portoReference } from "./feeds/porto-reference";
import { FEED as porto } from "./feeds/porto";

export const PUBLISHER: PublisherDefinition = {
  name: "Bird",
  url: "https://www.bird.co/",
  sources: ["mds.bird.co"],
  logo: "svg",
  feeds: [bragaReference, braga, cascaisReference, cascais, lisbonReference, lisbon, matosinhosReference, matosinhos, portoReference, porto],
};
