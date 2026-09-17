import type { ExampleFeed } from "../../index";
import { parliamentDocument, type ParliamentFeed } from "./parliament";
import { PARLIAMENT_MAX_RECORDS } from "./transform";

export const PARLIAMENT_EXAMPLES: ExampleFeed[] = [
  example(
    "members",
    "parliament-members-xvii-feed",
    "Parliament XVII: published mandates and reference",
    "All mandates published in the XVII legislature file, including renounced and other source statuses, with constituencies, parliamentary groups and sessions. Not a list restricted to currently active MPs.",
    86_400,
  ),
  example(
    "careers",
    "parliament-professional-profiles-xvii-feed",
    "Parliament XVII: professional profiles",
    "Published professional qualifications, roles and works associated with the XVII legislature's biographical register. Excludes birth dates, sex, private contacts and identity-only profiles; not restricted to currently active MPs.",
    604_800,
  ),
  example(
    "petitions",
    "parliament-petitions-xvii-feed",
    "Parliament XVII: petitions",
    "Petition headlines, processing status, signature counts, source dates and committee metadata. Does not republish petition authors' personal submissions or nested documents.",
    86_400,
  ),
  example(
    "diplomas",
    "parliament-diplomas-xvii-feed",
    "Parliament XVII: approved legislation",
    "Approved legislation with official identifiers, titles, types, publication metadata and official text links. Publication dates are source dates, not collection times.",
    86_400,
  ),
  example(
    "activities",
    "parliament-activities-xvii-feed",
    "Parliament XVII: activities",
    "Hearings, audiences, debates, visits and events published for the XVII legislature, as separate nonduplicated tables from one document. Source dates are preserved; activity documents and personal submissions are not copied.",
    86_400,
  ),
  example(
    "committees",
    "parliament-committees-xvii-feed",
    "Parliament XVII: committees, plenary sittings and attendance",
    "Committee reference, membership histories and meetings, plus every plenary sitting and each member's attendance at it with the absence reason Parliament records (for example illness, family assistance or political work). Other parliamentary bodies are outside this scope. Membership histories are not claims that every listed member currently holds the role.",
    86_400,
    // 8 MB of output in the first year; attendance grows with every sitting.
    { timeoutSeconds: 300, maxOutputBytes: 48 * 1024 * 1024 },
  ),
  example(
    "initiatives",
    "parliament-initiatives-xvii-feed",
    "Parliament XVII: initiatives and votes",
    "Every bill, draft resolution and other initiative of the XVII legislature, each step of its procedure, and every plenary and committee vote on it with each parliamentary group's position. Parliament records votes by group: named members appear only where they voted apart from their group, and head counts only where Parliament gives them. Unanimous votes and some procedural committee votes carry no per-group detail, so their position lists are empty.",
    86_400,
    // A 93 MB source: 35 s to download and read live, 19,491 rows and 10 MB of output measured for XVII.
    { timeoutSeconds: 600, maxOutputBytes: 32 * 1024 * 1024 },
  ),
];

interface CollectionLimits {
  timeoutSeconds: number;
  maxOutputBytes: number;
}

function example(
  feed: ParliamentFeed,
  slug: string,
  title: string,
  description: string,
  cadenceSeconds: number,
  limits: CollectionLimits = { timeoutSeconds: 180, maxOutputBytes: 8 * 1024 * 1024 },
): ExampleFeed {
  const config = { source: "parliament", feed, legislature: "XVII" };
  const document = parliamentDocument({ feed, legislature: "XVII" });
  return {
    slug,
    title,
    description,
    config,
    publisher: "Assembleia da República",
    topics: ["government"],
    policy: {
      name: `Parliament ${feed}: ${cadenceSeconds === 604_800 ? "weekly professional reference" : "daily public record updates"}`,
      version: 1,
      collection: { cadenceSeconds, ...limits, maxBytes: document.sourceBytes, maxRecords: PARLIAMENT_MAX_RECORDS, historyMode: "changes" },
      serving: {
        // https://www.parlamento.pt/Cidadania/Paginas/DadosAbertos.aspx
        licence:
          "Os dados podem ser livremente reutilizados por qualquer instituição ou pessoa para a criação de novos conteúdos, devendo apenas ser mencionada a fonte (Assembleia da República).",
        attribution: "Assembleia da República — Dados Abertos",
      },
    },
    staleAfterSeconds: cadenceSeconds * 3,
  };
}
