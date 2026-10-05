import type { ReactNode } from "react";
import { fmt } from "../lib/format";
import { inLocale } from "../lib/locale";

interface AskText {
  // The corner button.
  stillAnswering: string;
  answerReadyStatus: string;
  opening: string;
  answering: string;
  answerReady: string;
  askTheData: string;
  // The panel.
  onYourAccount: string;
  close: string;
  couldNotStart: string;
  loading: string;
  tryAgain: string;
  unreachable: string;
  suggestions: string[];
  signInFailures: { denied: string; expired: string; failed: string };
  stoppedOnLeaving: string;
  stopped: string;
  whatItRead: string;
  stepDone: string;
  stepFailed: string;
  drawing: string;
  thinking: string;
  neurons: (count: number) => string;
  // Signed out.
  notSignedIn: string;
  signInIntro: string;
  signInSteps: string[];
  keepNothing: string;
  signIn: string;
  noAccount: (mcp: (text: string) => ReactNode) => ReactNode;
  // The conversation.
  stillSignedIn: (error: string) => string;
  model: string;
  account: string;
  newConversation: string;
  signOut: string;
  signOutQuestion: string;
  signOutAndClear: string;
  accountIdHelp: string;
  accountIdPlaceholder: string;
  accountIdError: string;
  noAnswer: (error: string) => string;
  answerReadyShort: string;
  conversation: string;
  tryThese: string;
  cleared: string;
  undo: string;
  yourQuestion: string;
  askPlaceholder: string;
  stop: string;
  ask: string;
  // What lib/ask.ts tells the visitor while it answers.
  modelChanged: (asked: string, free: string) => string;
  outOfRoom: string;
  noAnswerGiven: string;
  tooManySteps: (steps: number) => string;
  lookedUp: string;
  read: (paths: string, more: number) => string;
  ranCode: string;
  drew: (reading: string, drawing: "chart" | "map" | "table") => string;
  kernelError: (status: number) => string;
  // What the agent draws.
  colourFromLow: string;
  toHigh: string;
  time: string;
  category: string;
  place: string;
  value: string;
  latitude: string;
  longitude: string;
  name: string;
  geometry: string;
  details: string;
  showAsTable: string;
  firstRows: (shown: number, total: number) => string;
  mapAttribution: string;
  zoomIn: string;
  zoomOut: string;
}

/** The agent's corner button, its panel, and what it draws under an answer. */
export const ASK = inLocale<AskText>({
  en: {
    stillAnswering: "The agent is still answering.",
    answerReadyStatus: "The agent's answer is ready.",
    opening: "Opening…",
    answering: "Answering…",
    answerReady: "Answer ready",
    askTheData: "Ask the data",
    onYourAccount: "On your own Cloudflare account",
    close: "Close",
    couldNotStart: "The agent could not start",
    loading: "Loading…",
    tryAgain: "Try again",
    unreachable: "Could not reach open-data.pt. Check your connection, then try again.",
    suggestions: [
      "Mapa dos postos de gasóleo mais baratos em Lisboa",
      "Was there an earthquake in Portugal this week?",
      "Chart Portugal's electricity consumption over the last week",
      "Há avisos meteorológicos do IPMA para o Porto?",
    ],
    signInFailures: {
      denied: "You did not allow Workers AI, so nothing was connected.",
      expired: "The sign-in took too long or was started in another tab. Try again.",
      failed: "Cloudflare did not complete the sign-in. Try again.",
    },
    stoppedOnLeaving: "Stopped when you left the page.",
    stopped: "Stopped.",
    whatItRead: "What the agent read",
    stepDone: "Done",
    stepFailed: "Failed, and tried again",
    drawing: "Drawing…",
    thinking: "Thinking…",
    neurons: (count) => `About ${fmt.int(count)} neurons of Workers AI on your account`,
    notSignedIn: "Not signed in",
    signInIntro: "Ask about Portuguese public data in your own words. The agent reads open-data.pt, answers with the datasets it used, and draws charts and maps when they help.",
    signInSteps: [
      "Cloudflare asks whether open-data.pt may use Workers AI on your account. It asks for nothing else.",
      "You come back to this page, with the agent open.",
      "The model runs on your account, so Cloudflare bills its use to you. On the Workers Free plan the agent uses a free model, and its 10,000 neurons a day cover about ten questions; Workers Paid unlocks a stronger one.",
    ],
    keepNothing: "We keep no conversation and no account details: your sign-in is a cookie in this browser, and signing out revokes it.",
    signIn: "Sign in with Cloudflare",
    noAccount: (mcp) => <>No Cloudflare account? Claude, ChatGPT and other assistants can read the same data through our {mcp("MCP server")}, on your own subscription.</>,
    stillSignedIn: (error) => `You are still signed in: ${error}`,
    model: "Model",
    account: "Cloudflare account",
    newConversation: "New conversation",
    signOut: "Sign out",
    signOutQuestion: "Sign out? This clears the conversation and revokes open-data.pt's access to Workers AI on your account.",
    signOutAndClear: "Sign out and clear",
    accountIdHelp: "Cloudflare did not list your accounts to us. Paste the account ID from your dashboard's address, dash.cloudflare.com/<account ID>.",
    accountIdPlaceholder: "32 hexadecimal characters",
    accountIdError: "That is not an account ID. Use the 32 characters after dash.cloudflare.com/ in your dashboard's address.",
    noAnswer: (error) => `No answer: ${error}`,
    answerReadyShort: "Answer ready.",
    conversation: "Conversation",
    tryThese: "Ask in Portuguese or English. It can draw charts and maps. Try:",
    cleared: "Conversation cleared.",
    undo: "Undo",
    yourQuestion: "Your question",
    askPlaceholder: "Ask about the data…",
    stop: "Stop",
    ask: "Ask",
    modelChanged: (asked, free) => `${asked} needs the Workers Paid plan or AI Gateway credits, so ${free} answered instead.`,
    outOfRoom: "The model ran out of room before it answered. Ask something narrower.",
    noAnswerGiven: "The model gave no answer.",
    tooManySteps: (steps) => `The model called tools ${steps} times without answering, so it was stopped. Ask something narrower.`,
    lookedUp: "Looked up the API's description",
    read: (paths, more) => `Read ${paths}${more > 0 ? ` and ${more} more` : ""}`,
    ranCode: "Ran code against the API",
    drew: (reading, drawing) => `${reading}, and drew a ${drawing}`,
    kernelError: (status) => `open-data.pt answered with an error (HTTP ${status}). Try again in a moment.`,
    colourFromLow: "Colour runs from low, ",
    toHigh: "to high, ",
    time: "Time",
    category: "Category",
    place: "Place",
    value: "Value",
    latitude: "Latitude",
    longitude: "Longitude",
    name: "Name",
    geometry: "Shape",
    details: "Details",
    showAsTable: "Show as a table",
    firstRows: (shown, total) => `The first ${fmt.int(shown)} of ${fmt.int(total)} rows.`,
    mapAttribution: "contributors",
    zoomIn: "Zoom in",
    zoomOut: "Zoom out",
  },
  pt: {
    stillAnswering: "O agente ainda está a responder.",
    answerReadyStatus: "A resposta do agente está pronta.",
    opening: "A abrir…",
    answering: "A responder…",
    answerReady: "Resposta pronta",
    askTheData: "Perguntar aos dados",
    onYourAccount: "Na sua própria conta Cloudflare",
    close: "Fechar",
    couldNotStart: "Não foi possível iniciar o agente",
    loading: "A carregar…",
    tryAgain: "Tentar de novo",
    unreachable: "Não foi possível contactar o open-data.pt. Verifique a ligação e tente de novo.",
    suggestions: [
      "Mapa dos postos de gasóleo mais baratos em Lisboa",
      "Houve algum sismo em Portugal esta semana?",
      "Gráfico do consumo de eletricidade em Portugal na última semana",
      "Há avisos meteorológicos do IPMA para o Porto?",
    ],
    signInFailures: {
      denied: "Não autorizou o Workers AI, por isso nada foi ligado.",
      expired: "O início de sessão demorou demasiado ou foi começado noutro separador. Tente de novo.",
      failed: "A Cloudflare não concluiu o início de sessão. Tente de novo.",
    },
    stoppedOnLeaving: "Parado quando saiu da página.",
    stopped: "Parado.",
    whatItRead: "O que o agente leu",
    stepDone: "Feito",
    stepFailed: "Falhou, e tentou de novo",
    drawing: "A desenhar…",
    thinking: "A pensar…",
    neurons: (count) => `Cerca de ${fmt.int(count)} neurónios do Workers AI na sua conta`,
    notSignedIn: "Sessão não iniciada",
    signInIntro:
      "Pergunte sobre dados públicos portugueses por palavras suas. O agente lê o open-data.pt, responde com os conjuntos de dados que usou e desenha gráficos e mapas quando ajudam.",
    signInSteps: [
      "A Cloudflare pergunta se o open-data.pt pode usar o Workers AI na sua conta. Não pede mais nada.",
      "Volta a esta página, com o agente aberto.",
      "O modelo corre na sua conta, por isso a Cloudflare cobra-lhe a utilização. No plano Workers Free o agente usa um modelo gratuito, e os 10 000 neurónios por dia dão para cerca de dez perguntas; o Workers Paid desbloqueia um mais capaz.",
    ],
    keepNothing: "Não guardamos conversas nem dados da conta: a sua sessão é um cookie neste navegador, e terminar a sessão revoga-a.",
    signIn: "Iniciar sessão com a Cloudflare",
    noAccount: (mcp) => (
      <>Não tem conta Cloudflare? O Claude, o ChatGPT e outros assistentes podem ler os mesmos dados através do nosso {mcp("servidor MCP")}, com a sua própria subscrição.</>
    ),
    stillSignedIn: (error) => `A sessão continua iniciada: ${error}`,
    model: "Modelo",
    account: "Conta Cloudflare",
    newConversation: "Nova conversa",
    signOut: "Terminar sessão",
    signOutQuestion: "Terminar sessão? Isto apaga a conversa e revoga o acesso do open-data.pt ao Workers AI na sua conta.",
    signOutAndClear: "Terminar sessão e apagar",
    accountIdHelp: "A Cloudflare não nos indicou as suas contas. Cole o ID da conta a partir do endereço do seu painel, dash.cloudflare.com/<ID da conta>.",
    accountIdPlaceholder: "32 caracteres hexadecimais",
    accountIdError: "Isso não é um ID de conta. Use os 32 caracteres a seguir a dash.cloudflare.com/ no endereço do seu painel.",
    noAnswer: (error) => `Sem resposta: ${error}`,
    answerReadyShort: "Resposta pronta.",
    conversation: "Conversa",
    tryThese: "Pergunte em português ou em inglês. Pode desenhar gráficos e mapas. Experimente:",
    cleared: "Conversa apagada.",
    undo: "Desfazer",
    yourQuestion: "A sua pergunta",
    askPlaceholder: "Pergunte sobre os dados…",
    stop: "Parar",
    ask: "Perguntar",
    modelChanged: (asked, free) => `O ${asked} precisa do plano Workers Paid ou de créditos do AI Gateway, por isso respondeu o ${free}.`,
    outOfRoom: "O modelo ficou sem espaço antes de responder. Faça uma pergunta mais específica.",
    noAnswerGiven: "O modelo não deu resposta.",
    tooManySteps: (steps) => `O modelo chamou ferramentas ${steps} vezes sem responder, por isso foi parado. Faça uma pergunta mais específica.`,
    lookedUp: "Consultou a descrição da API",
    read: (paths, more) => `Leu ${paths}${more > 0 ? ` e mais ${more}` : ""}`,
    ranCode: "Correu código sobre a API",
    drew: (reading, drawing) => `${reading}, e desenhou ${{ chart: "um gráfico", map: "um mapa", table: "uma tabela" }[drawing]}`,
    kernelError: (status) => `O open-data.pt respondeu com um erro (HTTP ${status}). Tente de novo daqui a pouco.`,
    colourFromLow: "A cor vai do mais baixo, ",
    toHigh: "ao mais alto, ",
    time: "Hora",
    category: "Categoria",
    place: "Local",
    value: "Valor",
    latitude: "Latitude",
    longitude: "Longitude",
    name: "Nome",
    geometry: "Forma",
    details: "Detalhes",
    showAsTable: "Mostrar como tabela",
    firstRows: (shown, total) => `As primeiras ${fmt.int(shown)} de ${fmt.int(total)} linhas.`,
    mapAttribution: "colaboradores",
    zoomIn: "Aproximar",
    zoomOut: "Afastar",
  },
});
