import type { ReactNode } from "react";
import { inLocale } from "../lib/locale";

export interface WayText {
  title: string;
  /** What it takes, in a few words. */
  needs: string;
  body: string;
  action: string;
}

interface ContributeText {
  eyebrow: string;
  title: string;
  intro: string;
  ways: { suggest: WayText; report: WayText; dataset: WayText; source: WayText };
  waysEyebrow: string;
  waysTitle: string;
  landingEyebrow: string;
  landingTitle: string;
  /** The first step, around a link to CONTRIBUTING.md. */
  readContributing: (link: ReactNode) => ReactNode;
  steps: string[];
  codeEyebrow: string;
  codeTitle: string;
  /** Where the code lives, around a link to the repository and one to its licence, which takes its words. */
  code: (repository: ReactNode, licence: (text: string) => ReactNode) => ReactNode;
}

/** The contribute page: the ways to help, how a change lands, and where the code is. */
export const CONTRIBUTE = inLocale<ContributeText>({
  en: {
    eyebrow: "Contribute",
    title: "Help collect Portugal’s public data",
    intro: "open-data.pt is open source. Anyone can suggest a source or report one that broke, and a new dataset from a source we already read is often a single entry of code.",
    ways: {
      suggest: {
        title: "Suggest a source",
        needs: "No code",
        body: "A Portuguese institution or operator publishes data we do not collect yet. Say where it is and who publishes it.",
        action: "Suggest a source",
      },
      report: {
        title: "Report a broken source",
        needs: "No code",
        body: "A dataset stopped updating, came back empty, or disagrees with what its publisher shows. Every dataset page links here with its address filled in.",
        action: "Report a broken source",
      },
      dataset: {
        title: "Add a dataset",
        needs: "One file of TypeScript",
        body: "A dataset from a source we already read is one feed file in its publisher's folder: its slug, title, licence, where it lives and how often to collect it. The platform installs it, collects it and gives each of its tables a page.",
        action: "How to add a dataset",
      },
      source: {
        title: "Add a source or a format",
        needs: "TypeScript, with tests",
        body: "A publisher with its own API gets a library in their folder; a standard we do not read yet gets one under formats/. Each comes with fixture tests built from saved responses.",
        action: "How to add a source",
      },
    },
    waysEyebrow: "Ways to help",
    waysTitle: "Pick what fits",
    landingEyebrow: "Before a pull request",
    landingTitle: "How changes land",
    readContributing: (link) => <>Read {link}: where code lives, and what a library may send.</>,
    steps: [
      "Run a new example against the real source, as CONTRIBUTING.md shows, so the pull request is known to collect.",
      "Run the checks: lint, types and tests. Unit tests use saved responses, never the network.",
      "The maintainer reviews and deploys. A pull request never needs secrets or access to Cloudflare.",
    ],
    codeEyebrow: "The code",
    codeTitle: "One repository",
    code: (repository, licence) => (
      <>
        The Gatekeeper that collects, the kernel that stores and serves, and this site all live in {repository}, under the {licence("MIT licence")}. The data is not: it belongs to
        its publishers, under their licences, and open-data.pt republishes it.
      </>
    ),
  },
  pt: {
    eyebrow: "Contribuir",
    title: "Ajude a reunir os dados públicos de Portugal",
    intro:
      "O open-data.pt é de código aberto. Qualquer pessoa pode sugerir uma origem ou avisar de uma que avariou, e um novo conjunto de dados de uma origem que já lemos é muitas vezes uma única entrada de código.",
    ways: {
      suggest: {
        title: "Sugerir uma origem",
        needs: "Sem código",
        body: "Uma instituição ou um operador português publica dados que ainda não recolhemos. Diga onde estão e quem os publica.",
        action: "Sugerir uma origem",
      },
      report: {
        title: "Avisar de uma origem avariada",
        needs: "Sem código",
        body: "Um conjunto de dados deixou de se atualizar, veio vazio ou não bate certo com o que a entidade publicadora mostra. Cada página de conjunto de dados tem uma ligação para aqui com o endereço já preenchido.",
        action: "Avisar de uma origem avariada",
      },
      dataset: {
        title: "Acrescentar um conjunto de dados",
        needs: "Um ficheiro de TypeScript",
        body: "Um conjunto de dados de uma origem que já lemos é um ficheiro de fonte na pasta da entidade publicadora: o slug, o título, a licença, onde está e com que frequência o recolher. A plataforma instala-o, recolhe-o e dá uma página a cada uma das suas tabelas.",
        action: "Como acrescentar um conjunto de dados",
      },
      source: {
        title: "Acrescentar uma origem ou um formato",
        needs: "TypeScript, com testes",
        body: "Uma entidade publicadora com API própria recebe uma biblioteca na sua pasta; uma norma que ainda não lemos recebe uma em formats/. Cada uma vem com testes sobre respostas guardadas.",
        action: "Como acrescentar uma origem",
      },
    },
    waysEyebrow: "Formas de ajudar",
    waysTitle: "Escolha o que lhe convém",
    landingEyebrow: "Antes de um pull request",
    landingTitle: "Como uma alteração entra",
    readContributing: (link) => <>Leia o {link}: onde fica o código e o que uma biblioteca pode enviar.</>,
    steps: [
      "Corra um novo exemplo contra a origem real, como o CONTRIBUTING.md mostra, para se saber que o pull request recolhe.",
      "Corra as verificações: lint, tipos e testes. Os testes unitários usam respostas guardadas, nunca a rede.",
      "O responsável revê e publica. Um pull request nunca precisa de segredos nem de acesso à Cloudflare.",
    ],
    codeEyebrow: "O código",
    codeTitle: "Um só repositório",
    code: (repository, licence) => (
      <>
        O Gatekeeper que recolhe, o kernel que guarda e serve, e este site vivem todos em {repository}, com a {licence("licença MIT")}. Os dados não: pertencem às entidades que os
        publicam, nas licenças delas, e o open-data.pt republica-os.
      </>
    ),
  },
});
