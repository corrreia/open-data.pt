import {
  field,
  invalidResponse,
  isJsonArray,
  isJsonNumber,
  isJsonObject,
  isJsonString,
  lisbonInstants,
  streamJsonArray,
  type CanonicalField,
  type CanonicalRecord,
  type JsonObject,
  type JsonValue,
  type NormalizedRow,
  type ProductDeclaration,
  type ProductFinalization,
  type ProductRole,
  type StreamingTransform,
  type TransformContext,
} from "#/index";
import { parliamentDocument, type ParliamentFeed } from "./parliament";

export const PARLIAMENT_NORMALIZER = { id: "parliament-public-records", version: "3" } as const;
export const PARLIAMENT_ELEMENT_BYTES = 256 * 1024;
// A legislature's attendance alone reaches about 90,000 rows by its fourth year.
export const PARLIAMENT_MAX_RECORDS = 250_000;

interface Table {
  key: string;
  title: string;
  role: ProductRole;
  fields: CanonicalField[];
}

const id = (name: string): CanonicalField => field(name, "identifier", false);
const label = (name: string): CanonicalField => field(name, "string", true);
const date = (name: string): CanonicalField => field(name, "date", true);
const structured = (name: string): CanonicalField => field(name, "json", true);
const MEMBER_FIELDS = [
  id("mandate_id"),
  id("person_id"),
  label("full_name"),
  label("parliamentary_name"),
  label("constituency_id"),
  label("constituency"),
  label("legislature"),
  structured("parliamentary_groups"),
  structured("mandate_statuses"),
];
const TABLES = {
  members: [
    { key: "mandates", title: "published mandates", role: "reference", fields: MEMBER_FIELDS },
    { key: "constituencies", title: "constituencies", role: "reference", fields: [id("id"), label("name"), label("legislature")] },
    { key: "parliamentary-groups", title: "parliamentary groups", role: "reference", fields: [id("abbreviation"), label("name"), label("legislature")] },
    { key: "sessions", title: "legislative sessions", role: "reference", fields: [id("number"), label("legislature"), date("start_date"), date("end_date")] },
  ],
  careers: [
    {
      key: "professional-profiles",
      title: "professional profiles",
      role: "reference",
      fields: [
        id("person_id"),
        label("name"),
        label("profession"),
        structured("qualifications"),
        structured("professional_roles"),
        structured("published_works"),
        structured("titles"),
        structured("honours"),
      ],
    },
  ],
  petitions: [
    {
      key: "petitions",
      title: "petitions",
      role: "event-log",
      fields: [
        id("id"),
        label("number"),
        label("legislature"),
        label("subject"),
        label("status"),
        date("entry_date"),
        field("signatures", "number", true, "signature"),
        field("initial_signatures", "number", true, "signature"),
        field("text_url", "url", true),
        structured("committees"),
      ],
    },
  ],
  diplomas: [
    {
      key: "diplomas",
      title: "approved legislation",
      role: "event-log",
      fields: [
        id("id"),
        label("title"),
        label("number"),
        label("second_number"),
        label("type"),
        label("type_code"),
        label("civil_year"),
        label("legislature"),
        label("session"),
        field("text_url", "url", true),
        structured("publications"),
      ],
    },
  ],
  activities: [
    {
      key: "hearings",
      title: "hearings",
      role: "event-log",
      fields: [id("id"), label("subject"), date("date"), label("number"), label("legislature"), label("session"), label("entities")],
    },
    {
      key: "audiences",
      title: "audiences",
      role: "event-log",
      fields: [id("id"), label("subject"), date("date"), label("number"), label("legislature"), label("session"), label("entities"), label("granted")],
    },
    {
      key: "debates",
      title: "debates",
      role: "event-log",
      fields: [id("id"), label("subject"), date("debate_date"), date("entry_date"), label("type"), label("legislature"), label("session")],
    },
    {
      key: "visits",
      title: "visits",
      role: "event-log",
      fields: [id("id"), label("title"), date("start_date"), date("end_date"), label("location"), label("type"), label("legislature"), label("session")],
    },
    {
      key: "events",
      title: "events",
      role: "event-log",
      fields: [id("id"), label("title"), date("date"), label("location"), label("type"), label("legislature"), label("session")],
    },
  ],
  committees: [
    { key: "committees", title: "committees", role: "reference", fields: [id("id"), label("name"), label("abbreviation"), label("number"), label("legislature")] },
    {
      key: "memberships",
      title: "committee membership histories",
      role: "reference",
      fields: [
        id("committee_id"),
        id("mandate_id"),
        id("person_id"),
        label("parliamentary_name"),
        label("legislature"),
        structured("parliamentary_groups"),
        structured("mandate_statuses"),
      ],
    },
    {
      key: "meetings",
      title: "committee meetings",
      role: "event-log",
      fields: [
        id("committee_id"),
        id("id"),
        label("number"),
        field("starts_at", "datetime", true),
        label("source_start"),
        label("location"),
        label("type"),
        label("activity"),
        field("official_url", "url", true),
      ],
    },
    {
      key: "plenary-meetings",
      title: "plenary sittings",
      role: "event-log",
      fields: [id("id"), label("number"), field("starts_at", "datetime", true), label("source_start"), label("type"), label("session"), label("legislature")],
    },
    {
      key: "plenary-attendance",
      title: "plenary attendance",
      role: "event-log",
      fields: [id("meeting_id"), date("date"), label("member"), label("group"), label("attendance_code"), label("absence_reason")],
    },
  ],
  initiatives: [
    {
      key: "initiatives",
      title: "initiatives",
      role: "reference",
      fields: [
        id("id"),
        label("number"),
        label("type_code"),
        label("type"),
        label("title"),
        label("legislature"),
        label("session"),
        structured("author_groups"),
        structured("author_deputies"),
        structured("author_type"),
        field("text_url", "url", true),
        structured("petition_ids"),
        structured("origin_ids"),
        structured("originated_ids"),
      ],
    },
    {
      key: "events",
      title: "initiative procedure events",
      role: "event-log",
      fields: [id("id"), id("initiative_id"), label("phase_code"), label("phase"), date("date"), label("observation"), structured("committees"), structured("publications")],
    },
    {
      key: "votes",
      title: "votes on initiatives",
      role: "event-log",
      fields: [
        id("id"),
        id("initiative_id"),
        id("event_id"),
        label("phase"),
        date("date"),
        label("body"),
        label("committee_id"),
        label("committee"),
        label("meeting"),
        label("result"),
        field("unanimous", "boolean", true),
        structured("in_favour"),
        structured("against"),
        structured("abstention"),
        structured("absent"),
        label("description"),
        structured("publications"),
      ],
    },
  ],
} satisfies Record<ParliamentFeed, Table[]>;

interface BuiltRow {
  key: string;
  record: CanonicalRecord;
}

/** The main array is pulled row by row; explicitly bounded companion arrays share the same acquisition. */
export function transformParliament(body: ReadableStream<Uint8Array>, context: TransformContext): StreamingTransform {
  const document = parliamentDocument(context.feed.config);
  const tables = TABLES[document.feed];
  const base = context.feed.slug.replace(/-feed$/, "");
  const products: ProductDeclaration[] = tables.map((table) => ({
    productKey: table.key,
    slug: tables.length === 1 ? base : `${base}-${table.key}`,
    title: `Parliament ${document.legislature}: ${table.title}`,
    description: context.feed.description,
    role: table.role,
    kind: "record",
    schema: { fields: table.fields },
    updateMode: "authoritative-snapshot",
    completeness: "complete",
  }));
  const source = streamJsonArray(requireJsonRoot(body, document.arrayPath.length === 0 ? "[" : "{"), document.arrayPath, {
    maxElementBytes: document.elementBytes ?? PARLIAMENT_ELEMENT_BYTES,
    maxEnvelopeBytes: document.envelopeBytes,
  });
  const seen = new Set<string>();
  const watermarks = new Map<string, string>();
  const partial = new Set<string>();
  let accepted = 0;
  function emit(row: BuiltRow): NormalizedRow {
    const identity = JSON.stringify([row.key, row.record.entityKey]);
    if (seen.has(identity)) throw invalidResponse(`Parliament repeated a ${row.key} identity`);
    seen.add(identity);
    accepted += 1;
    if (accepted > PARLIAMENT_MAX_RECORDS) throw invalidResponse("Parliament normalized record limit exceeded");
    const clock = row.record.eventTime;
    if (clock && clock > (watermarks.get(row.key) ?? "")) watermarks.set(row.key, clock);
    return { productKey: row.key, record: row.record };
  }
  async function* rows(): AsyncGenerator<NormalizedRow> {
    for await (const value of source.elements) {
      const item = object(value, "array item");
      if (document.feed === "committees") {
        for (const row of committeeRows(item, document.legislature, partial)) yield emit(row);
      } else if (document.feed === "initiatives") {
        for (const row of initiativeRows(item, document.legislature)) yield emit(row);
      } else {
        const row = mainRow(item, document.feed, document.legislature);
        if (row) yield emit(row);
      }
    }
    const envelope = source.envelope();
    if (document.arrayPath.length > 0) requireArrayPath(envelope, document.arrayPath);
    if (document.feed === "members") {
      const detail = object(envelope.DetalheLegislatura, "legislature detail");
      requireLegislature(detail.sigla, document.legislature);
      for (const value of requiredArray(envelope.CirculosEleitorais, "constituencies")) {
        const item = object(value, "constituency");
        requireLegislature(item.legDes, document.legislature);
        const key = identifier(item.cpId, "constituency id");
        yield emit({ key: "constituencies", record: record(key, { id: key, name: text(item.cpDes), legislature: document.legislature }) });
      }
      for (const value of requiredArray(envelope.GruposParlamentares, "parliamentary groups")) {
        const item = object(value, "parliamentary group");
        const key = identifier(item.sigla, "group abbreviation");
        yield emit({ key: "parliamentary-groups", record: record(key, { abbreviation: key, name: text(item.nome), legislature: document.legislature }) });
      }
      for (const value of requiredArray(envelope.SessoesLegislativas, "legislative sessions")) {
        const item = object(value, "legislative session");
        const key = identifier(item.numSessao, "session number");
        yield emit({
          key: "sessions",
          record: record(key, { number: key, legislature: document.legislature, start_date: sourceDate(item.dataInicio), end_date: sourceDate(item.dataFim) }),
        });
      }
    }
    if (document.feed === "committees") {
      for (const row of plenaryRows(object(envelope.Plenario, "plenary"), document.legislature)) yield emit(row);
    }
    if (document.feed === "activities") {
      for (const [section, key] of Object.entries({ Audiencias: "audiences", Debates: "debates", Deslocacoes: "visits", Eventos: "events" })) {
        for (const value of requiredArray(envelope[section], section)) yield emit(activityRow(object(value, section), key, document.legislature));
      }
    }
  }
  return {
    products,
    rows: rows(),
    finish: () => {
      const finals: ProductFinalization[] = [];
      for (const table of tables) {
        const watermark = watermarks.get(table.key);
        const final: ProductFinalization = { productKey: table.key };
        if (watermark) final.watermark = watermark;
        if (partial.has(table.key)) final.completeness = "partial";
        if (watermark || partial.has(table.key)) finals.push(final);
      }
      return { quality: { acceptedRecords: accepted, rejectedRecords: 0 }, products: finals };
    },
  };
}

function mainRow(item: JsonObject, feed: ParliamentFeed, legislature: string): BuiltRow | undefined {
  switch (feed) {
    case "members": {
      requireLegislature(item.LegDes, legislature);
      const key = identifier(item.DepId, "mandate id");
      return {
        key: "mandates",
        record: record(key, {
          mandate_id: key,
          person_id: identifier(item.DepCadId, "person id"),
          full_name: text(item.DepNomeCompleto),
          parliamentary_name: text(item.DepNomeParlamentar),
          constituency_id: optionalCode(item.DepCPId),
          constituency: text(item.DepCPDes),
          legislature,
          parliamentary_groups: groups(item.DepGP),
          mandate_statuses: statuses(item.DepSituacao),
        }),
      };
    }
    case "careers": {
      const payload: JsonObject = {
        person_id: identifier(item.CadId, "professional profile id"),
        name: text(item.CadNomeCompleto),
        profession: text(item.CadProfissao),
        qualifications: descriptions(item.CadHabilitacoes, "HabDes"),
        professional_roles: professionalRoles(item.CadCargosFuncoes),
        published_works: descriptions(item.CadObrasPublicadas, "PubDes"),
        titles: descriptions(item.CadTitulos, "TitDes"),
        honours: descriptions(item.CadCondecoracoes, "CodDes"),
      };
      // Do not duplicate a bare identity from the mandate table; a profile needs professional content.
      if (
        !payload.profession &&
        [payload.qualifications, payload.professional_roles, payload.published_works, payload.titles, payload.honours].every((value) => isJsonArray(value) && value.length === 0)
      )
        return undefined;
      return { key: "professional-profiles", record: record(identifier(item.CadId, "professional profile id"), payload) };
    }
    case "petitions": {
      requireLegislature(item.PetLeg, legislature);
      const key = identifier(item.PetId, "petition id");
      const entered = sourceDate(item.PetDataEntrada);
      const committees = optionalArray(item.DadosComissao).map((value) => {
        const committee = object(value, "petition committee");
        return {
          id: optionalCode(committee.IdComissao),
          name: text(committee.Nome),
          status: text(committee.Situacao),
          admission_date: sourceDate(committee.DataAdmissibilidade),
          archive_date: sourceDate(committee.DataArquivo),
        };
      });
      return {
        key: "petitions",
        record: record(
          key,
          {
            id: key,
            number: optionalCode(item.PetNr),
            legislature,
            subject: text(item.PetAssunto),
            status: text(item.PetSituacao),
            entry_date: entered,
            signatures: count(item.PetNrAssinaturas),
            initial_signatures: count(item.PetNrAssinaturasInicial),
            text_url: officialUrl(item.PetUrlTexto),
            committees,
          },
          dayClock(entered),
        ),
      };
    }
    case "diplomas": {
      requireLegislature(item.Legislatura, legislature);
      const key = identifier(item.Id, "legislation id");
      const publications = publicationList(item.Publicacao);
      const dates = publications.flatMap((publication) => (publication.date ? [publication.date] : [])).sort();
      const value = record(
        key,
        {
          id: key,
          title: text(item.Titulo),
          number: optionalCode(item.Numero),
          second_number: optionalCode(item.Numero2),
          type: text(item.Tipo),
          type_code: text(item.Tp),
          civil_year: optionalCode(item.AnoCivil),
          legislature,
          session: optionalCode(item.Sessao),
          text_url: officialUrl(item.LinkTexto),
          publications,
        },
        dayClock(dates[0]),
      );
      const latest = dayClock(dates.at(-1));
      if (latest) value.sourcePublishedAt = latest;
      return { key: "diplomas", record: value };
    }
    case "activities":
      return activityRow(item, "hearings", legislature);
    case "committees":
    case "initiatives":
      throw invalidResponse("Committee and initiative rows require their scoped normalizers");
  }
}

function activityRow(item: JsonObject, key: string, legislature: string): BuiltRow {
  requireLegislature(item.Legislatura, legislature);
  if (key === "hearings" || key === "audiences") {
    const hearing = key === "hearings";
    const identifierValue = identifier(item[hearing ? "IDAudicao" : "IDAudiencia"], "activity id");
    const day = sourceDate(item.Data);
    const payload: JsonObject = {
      id: identifierValue,
      subject: text(item.Assunto),
      date: day,
      number: optionalCode(item[hearing ? "NumeroAudicao" : "NumeroAudiencia"]),
      legislature,
      session: optionalCode(item.SessaoLegislativa),
      entities: text(item.Entidades),
    };
    if (!hearing) payload.granted = text(item.Concedida);
    return { key, record: record(identifierValue, payload, dayClock(day)) };
  }
  if (key === "debates") {
    const value = identifier(item.DebateId, "debate id");
    const day = sourceDate(item.DataDebate);
    return {
      key,
      record: record(
        value,
        {
          id: value,
          subject: text(item.Assunto),
          debate_date: day,
          entry_date: sourceDate(item.DataEntrada),
          type: text(item.TipoDebateDesig),
          legislature,
          session: optionalCode(item.Sessao),
        },
        dayClock(day),
      ),
    };
  }
  if (key === "visits") {
    const value = identifier(item.IDDeslocacao, "visit id");
    const day = sourceDate(item.DataIni);
    return {
      key,
      record: record(
        value,
        {
          id: value,
          title: text(item.Designacao),
          start_date: day,
          end_date: sourceDate(item.DataFim),
          location: text(item.LocalEvento),
          type: text(item.Tipo),
          legislature,
          session: optionalCode(item.SessaoLegislativa),
        },
        dayClock(day),
      ),
    };
  }
  if (key === "events") {
    const value = identifier(item.IDEvento, "event id");
    const day = sourceDate(item.Data);
    return {
      key,
      record: record(
        value,
        {
          id: value,
          title: text(item.Designacao),
          date: day,
          location: text(item.LocalEvento),
          type: text(item.TipoEvento),
          legislature,
          session: optionalCode(item.SessaoLegislativa),
        },
        dayClock(day),
      ),
    };
  }
  throw invalidResponse("Unsupported Parliament activity section");
}

function* committeeRows(item: JsonObject, legislature: string, partial: Set<string>): Generator<BuiltRow> {
  const detail = object(item.DetalheOrgao, "committee detail");
  requireLegislature(detail.siglaLegislatura, legislature);
  const key = identifier(detail.idOrgao, "committee id");
  yield {
    key: "committees",
    record: record(key, { id: key, name: text(detail.nomeSigla), abbreviation: text(detail.siglaOrgao), number: optionalCode(detail.numeroOrgao), legislature }),
  };
  if (item.HistoricoComposicao === null || item.HistoricoComposicao === undefined) partial.add("memberships");
  for (const value of optionalArray(item.HistoricoComposicao)) {
    const member = object(value, "committee member");
    requireLegislature(member.legDes, legislature);
    const mandate = identifier(member.depId, "committee mandate id");
    const declaredCommittee = optionalCode(member.orgId);
    if (declaredCommittee !== null && declaredCommittee !== key) throw invalidResponse("Committee membership references another committee");
    yield {
      key: "memberships",
      record: record(`${key}:${mandate}`, {
        committee_id: key,
        mandate_id: mandate,
        person_id: identifier(member.depCadId, "committee person id"),
        parliamentary_name: text(member.depNomeParlamentar),
        legislature,
        parliamentary_groups: groups(member.depGP),
        mandate_statuses: statuses(member.depSituacao),
      }),
    };
  }
  if (item.Reunioes === null || item.Reunioes === undefined) partial.add("meetings");
  for (const value of optionalArray(item.Reunioes)) {
    const meeting = object(value, "committee meeting");
    const meetingId = identifier(meeting.reuId, "meeting id");
    const start = meetingTime(meeting.reuDataHora);
    yield {
      key: "meetings",
      record: record(
        `${key}:${meetingId}`,
        {
          committee_id: key,
          id: meetingId,
          number: optionalCode(meeting.reuNumero),
          starts_at: start ?? null,
          source_start: text(meeting.reuDataHora),
          location: text(meeting.reuLocal),
          type: text(meeting.reuTirDes),
          activity: text(meeting.reuTarDes),
          official_url: officialUrl(meeting.reuLink),
        },
        start,
      ),
    };
  }
}

/** One initiative, its procedure events, and the plenary and committee votes recorded under them. */
function* initiativeRows(item: JsonObject, legislature: string): Generator<BuiltRow> {
  requireLegislature(item.IniLeg, legislature);
  const initiative = identifier(item.IniId, "initiative id");
  // `IniAutorOutros` is the kind of author (parliamentary groups, Government, a regional assembly, committees), set on every initiative.
  const kind = item.IniAutorOutros === null || item.IniAutorOutros === undefined ? null : object(item.IniAutorOutros, "initiative author kind");
  yield {
    key: "initiatives",
    record: record(initiative, {
      id: initiative,
      number: optionalCode(item.IniNr),
      type_code: text(item.IniTipo),
      type: text(item.IniDescTipo),
      title: text(item.IniTitulo),
      legislature,
      session: optionalCode(item.IniSel),
      author_groups: optionalArray(item.IniAutorGruposParlamentares).flatMap((value) => {
        const group = text(object(value, "initiative author group").GP);
        return group ? [group] : [];
      }),
      author_deputies: optionalArray(item.IniAutorDeputados).map((value) => {
        const deputy = object(value, "initiative author deputy");
        return { person_id: optionalCode(deputy.idCadastro), name: text(deputy.nome), group: text(deputy.GP) };
      }),
      author_type: kind && (text(kind.nome) || text(kind.sigla)) ? { code: text(kind.sigla), name: text(kind.nome) } : null,
      text_url: officialUrl(item.IniLinkTexto),
      petition_ids: referencedIds(item.Peticoes, "petition"),
      origin_ids: referencedIds(item.IniciativasOrigem, "origin initiative"),
      originated_ids: referencedIds(item.IniciativasOriginadas, "originated initiative"),
    }),
  };
  for (const value of optionalArray(item.IniEventos)) {
    const event = object(value, "initiative event");
    const eventId = identifier(event.OevId, "initiative event id");
    const day = sourceDate(event.DataFase);
    const phase = text(event.Fase);
    const committees = optionalArray(event.Comissao).map((entry) => object(entry, "initiative committee"));
    yield {
      key: "events",
      record: record(
        eventId,
        {
          id: eventId,
          initiative_id: initiative,
          phase_code: optionalCode(event.CodigoFase),
          phase,
          date: day,
          observation: text(event.ObsFase),
          committees: committees.map((committee) => ({ id: optionalCode(committee.IdComissao), name: text(committee.Nome), competent: committee.Competente === "S" })),
          publications: publicationList(event.PublicacaoFase),
        },
        dayClock(day),
      ),
    };
    for (const vote of optionalArray(event.Votacao)) yield voteRow(object(vote, "plenary vote"), initiative, eventId, phase, null);
    for (const committee of committees) {
      for (const vote of optionalArray(committee.Votacao)) yield voteRow(object(vote, "committee vote"), initiative, eventId, phase, committee);
    }
  }
}

const MEETING_BODIES = new Map([
  ["RP", "plenary"],
  ["CP", "permanent-committee"],
]);

function voteRow(vote: JsonObject, initiative: string, eventId: string, phase: string | null, committee: JsonObject | null): BuiltRow {
  const voteId = identifier(vote.id, "vote id");
  const day = sourceDate(vote.data);
  const body = committee ? "committee" : MEETING_BODIES.get(text(vote.tipoReuniao) ?? "");
  if (!body) throw invalidResponse("Parliament plenary vote has an unknown meeting type");
  const positions = votePositions(vote.detalhe);
  return {
    key: "votes",
    record: record(
      voteId,
      {
        id: voteId,
        initiative_id: initiative,
        event_id: eventId,
        phase,
        date: day,
        body,
        committee_id: committee ? optionalCode(committee.IdComissao) : null,
        committee: committee ? text(committee.Nome) : null,
        meeting: optionalCode(vote.reuniao),
        result: text(vote.resultado),
        unanimous: vote.unanime === "unanime" || vote.unanime === "S" ? true : null,
        in_favour: positions.in_favour,
        against: positions.against,
        abstention: positions.abstention,
        // The detail's absence segment and `ausencias` name the same groups; the array only stands in when there is no detail.
        absent: positions.detailed
          ? positions.absent
          : optionalArray(vote.ausencias).flatMap((value) => {
              const group = text(value);
              return group ? [{ group }] : [];
            }),
        description: text(vote.descricao),
        publications: publicationList(vote.publicacao),
      },
      dayClock(day),
    ),
  };
}

/**
 * `detalhe` is Parliament's own vote summary: `A Favor: <I>PSD</I>, <I> 59-CH</I><BR>Contra: …`.
 * An entry is a group, a head count and group (`86-PSD`), or a member voting apart from the group (`Name (PSD)`).
 */
function votePositions(value: JsonValue | undefined) {
  const in_favour: JsonObject[] = [];
  const against: JsonObject[] = [];
  const abstention: JsonObject[] = [];
  const absent: JsonObject[] = [];
  const lists = new Map([
    ["A Favor", in_favour],
    ["Contra", against],
    ["Abstenção", abstention],
    ["Ausência", absent],
  ]);
  const detail = text(value);
  for (const segment of detail ? detail.split(/<BR\s*\/?>/i) : []) {
    const match = /^\s*([^:<]+):(.*)$/s.exec(segment);
    const list = match ? lists.get((match[1] ?? "").trim()) : undefined;
    if (!match || !list) throw invalidResponse("Parliament vote detail has an unknown position");
    const entries = match[2] ?? "";
    if (entries.replace(/<I>.*?<\/I>/gis, "").replace(/[\s,]/g, "") !== "") throw invalidResponse("Parliament vote detail has text outside its entries");
    for (const entry of entries.matchAll(/<I>(.*?)<\/I>/gis)) {
      const trimmed = (entry[1] ?? "").trim();
      if (trimmed) list.push(voteEntry(trimmed));
    }
  }
  return { detailed: detail !== null, in_favour, against, abstention, absent };
}

function voteEntry(entry: string): JsonObject {
  const counted = /^(\d+)-(\S+)$/.exec(entry);
  if (counted) return { group: counted[2] ?? "", count: Number(counted[1]) };
  const member = /^(.+?)\s*\(([^()]+)\)$/.exec(entry);
  if (member) return { group: (member[2] ?? "").trim(), deputy: (member[1] ?? "").trim() };
  return { group: entry };
}

function referencedIds(value: JsonValue | undefined, label: string): string[] {
  return optionalArray(value).map((entry) => identifier(object(entry, label).id, `${label} id`));
}

function publicationList(value: JsonValue | undefined) {
  return optionalArray(value).map((entry) => {
    const publication = object(entry, "publication");
    return {
      date: sourceDate(publication.pubdt),
      number: optionalCode(publication.pubNr),
      type: text(publication.pubTipo),
      legislature: text(publication.pubLeg),
      session: optionalCode(publication.pubSL),
      official_url: officialUrl(publication.URLDiario),
    };
  });
}

/**
 * Plenary sittings and who attended each, as Parliament records it: an attendance code per member and,
 * for an absence, its stated reason. Members carry no identifier here, so a row is its sitting and name.
 */
function* plenaryRows(plenary: JsonObject, legislature: string): Generator<BuiltRow> {
  requireLegislature(object(plenary.DetalheOrgao, "plenary detail").siglaLegislatura, legislature);
  for (const value of requiredArray(plenary.Reunioes, "plenary sittings")) {
    const sitting = object(value, "plenary sitting");
    const meeting = object(sitting.Reuniao, "plenary meeting");
    requireLegislature(meeting.legDes, legislature);
    const meetingId = identifier(meeting.reuId, "plenary meeting id");
    const start = meetingTime(meeting.reuDataHora);
    yield {
      key: "plenary-meetings",
      record: record(
        meetingId,
        {
          id: meetingId,
          number: optionalCode(meeting.reuNumero),
          starts_at: start ?? null,
          source_start: text(meeting.reuDataHora),
          type: text(meeting.reuTirDes),
          session: optionalCode(meeting.selNumero),
          legislature,
        },
        start,
      ),
    };
    const attendance = object(sitting.Presencas, "plenary attendance");
    const day = sourceDate(attendance.dtReuniao);
    for (const entry of requiredArray(attendance.presencas, "plenary attendance")) {
      const presence = object(entry, "plenary presence");
      const member = text(presence.nomeDeputado);
      if (!member) throw invalidResponse("Parliament omitted a plenary attendee's name");
      yield {
        key: "plenary-attendance",
        record: record(
          `${meetingId}:${member}`,
          {
            meeting_id: meetingId,
            date: day,
            member,
            group: text(presence.siglaGrupo),
            attendance_code: text(presence.siglaFalta),
            absence_reason: text(presence.motivoFalta),
          },
          dayClock(day),
        ),
      };
    }
  }
}

function groups(value: JsonValue | undefined): JsonObject[] {
  return optionalArray(value).map((entry) => {
    const item = object(entry, "parliamentary affiliation");
    return { id: optionalCode(item.gpId), abbreviation: text(item.gpSigla), start_date: sourceDate(item.gpDtInicio), end_date: sourceDate(item.gpDtFim) };
  });
}
function statuses(value: JsonValue | undefined): JsonObject[] {
  return optionalArray(value).map((entry) => {
    const item = object(entry, "mandate status");
    return { description: text(item.sioDes), start_date: sourceDate(item.sioDtInicio), end_date: sourceDate(item.sioDtFim), member_type: text(item.sioTipMem) };
  });
}
function descriptions(value: JsonValue | undefined, key: string): JsonValue[] {
  return optionalArray(value).flatMap((entry) => {
    const description = text(object(entry, "professional information")[key]);
    return description ? [description] : [];
  });
}
function professionalRoles(value: JsonValue | undefined): JsonObject[] {
  return optionalArray(value).flatMap((entry) => {
    const item = object(entry, "professional role");
    const description = text(item.FunDes);
    return description ? [{ description, former: text(item.FunAntiga) }] : [];
  });
}
function record(entityKey: string, payload: JsonObject, eventTime?: string): CanonicalRecord {
  const value: CanonicalRecord = { entityKey, payload };
  if (eventTime) value.eventTime = eventTime;
  return value;
}
function text(value: JsonValue | undefined): string | null {
  return isJsonString(value) && value.trim() ? value.trim() : null;
}
function optionalCode(value: JsonValue | undefined): string | null {
  return value === null || value === undefined || value === "" ? null : identifier(value, "source identifier");
}
function identifier(value: JsonValue | undefined, label: string): string {
  if (isJsonNumber(value) && Number.isSafeInteger(value) && value >= 0) return String(value);
  if (isJsonString(value) && value.trim() && value.length <= 512) return value.trim();
  throw invalidResponse(`Parliament omitted or malformed ${label}`);
}
function object(value: JsonValue | undefined, label: string): JsonObject {
  if (!isJsonObject(value)) throw invalidResponse(`Parliament ${label} is not an object`);
  return value;
}
function requiredArray(value: JsonValue | undefined, label: string): JsonValue[] {
  if (!isJsonArray(value)) throw invalidResponse(`Parliament omitted or malformed ${label} array`);
  return value;
}
function optionalArray(value: JsonValue | undefined): JsonValue[] {
  return value === null || value === undefined ? [] : requiredArray(value, "nested");
}
function requireArrayPath(root: JsonObject, path: readonly string[]): void {
  let value: JsonValue | undefined = root;
  for (const key of path) value = isJsonObject(value) ? value[key] : undefined;
  requiredArray(value, path.join("."));
}
function requireLegislature(value: JsonValue | undefined, expected: string): void {
  if (text(value) !== expected) throw invalidResponse("Parliament payload does not match the selected legislature");
}
function count(value: JsonValue | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (isJsonNumber(value) && Number.isSafeInteger(value) && value >= 0) return value;
  if (isJsonString(value) && /^\d+(?:[ .]\d{3})*$/.test(value.trim())) {
    const parsed = Number(value.replace(/[ .]/g, ""));
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  throw invalidResponse("Parliament signature count is not a nonnegative integer");
}
function sourceDate(value: JsonValue | undefined): string | null {
  if (value !== null && value !== undefined && !isJsonString(value)) throw invalidResponse("Parliament source date is not text");
  const date = text(value);
  if (date === null) return null;
  const timestamp = Date.parse(`${date}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== date)
    throw invalidResponse("Parliament source date is invalid");
  return date;
}
function dayClock(day: string | null | undefined): string | undefined {
  return day ? `${day}T00:00:00.000Z` : undefined;
}

/** Parliamentary meetings are Lisbon civil times; an ambiguous hour retains only its source string. */
function meetingTime(value: JsonValue | undefined): string | undefined {
  const source = text(value);
  if (!source) return undefined;
  const match = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})?$/.exec(source);
  if (!match) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(source)) return dayClock(sourceDate(source));
    throw invalidResponse("Parliament meeting time is malformed");
  }
  const day = match[1] ?? "";
  const time = match[2] ?? "";
  sourceDate(day);
  if (match[4]) {
    const milliseconds = Date.parse(source.replace(" ", "T"));
    if (!Number.isFinite(milliseconds)) throw invalidResponse("Parliament meeting time is invalid");
    return new Date(milliseconds).toISOString();
  }
  const instants = lisbonInstants(day, time);
  if (instants.length !== 1) return undefined;
  const instant = instants[0];
  if (!instant) return undefined;
  const milliseconds = match[3] ? Number(match[3]) * 1000 : 0;
  return new Date(instant.getTime() + milliseconds).toISOString();
}

/** Link metadata is not fetched; only known official Parliamentary/Diário da República sites are published. */
function officialUrl(value: JsonValue | undefined): string | null {
  const input = text(value);
  if (!input) return null;
  try {
    const url = new URL(input);
    const official =
      url.hostname === "parlamento.pt" ||
      url.hostname.endsWith(".parlamento.pt") ||
      ["diariodarepublica.pt", "www.diariodarepublica.pt", "dre.pt", "www.dre.pt"].includes(url.hostname);
    if (!official || url.username || url.password || url.port || !["http:", "https:"].includes(url.protocol)) return null;
    url.protocol = "https:";
    return url.toString();
  } catch {
    return null;
  }
}

/** A root object must not silently become an empty top-level array snapshot. */
function requireJsonRoot(body: ReadableStream<Uint8Array>, expected: "[" | "{"): ReadableStream<Uint8Array> {
  let found = false;
  const decoder = new TextDecoder();
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        if (!found) {
          const text = decoder.decode(chunk, { stream: true }).trimStart();
          if (text) {
            if (text[0] !== expected) throw invalidResponse("Parliament JSON root has the wrong container type");
            found = true;
          }
        }
        controller.enqueue(chunk);
      },
      flush() {
        if (!found) throw invalidResponse("Parliament JSON document is empty");
      },
    }),
  );
}
