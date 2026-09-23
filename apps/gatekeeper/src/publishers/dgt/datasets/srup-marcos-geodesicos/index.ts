import type { DatasetDefinition } from "#/catalog/define";

export const DATASET: DatasetDefinition = {
  title: "Geodetic marks and their protection zones",
  description:
    "The 7,968 geodetic marks of mainland Portugal whose surroundings are protected by law, with the name each one is known by, the network it belongs to and the municipality it stands in. Odemira holds 193 of them. What is drawn is the protection zone around each mark rather than the mark itself. Every one of these is protected by the same 1982 decree, which the feed states once rather than on every row. This is the easement side of the register; the survey side, with each mark's order and height, is published separately from the geodetic network itself.",
  licence: "cc-by-4.0",
  attribution: "Direção-Geral do Território — Servidões e Restrições de Utilidade Pública",
  topics: ["government", "society"],
};
