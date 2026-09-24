import type { PublisherDefinition } from "#/catalog/define";
import { FEED as activitiesXvii } from "./feeds/activities-xvii";
import { FEED as committeesXvii } from "./feeds/committees-xvii";
import { FEED as diplomasXvii } from "./feeds/diplomas-xvii";
import { FEED as initiativesXvii } from "./feeds/initiatives-xvii";
import { FEED as membersXvii } from "./feeds/members-xvii";
import { FEED as petitionsXvii } from "./feeds/petitions-xvii";
import { FEED as professionalProfilesXvii } from "./feeds/professional-profiles-xvii";

export const PUBLISHER: PublisherDefinition = {
  name: "Assembleia da República",
  url: "https://www.parlamento.pt/",
  sources: ["app.parlamento.pt", "www.parlamento.pt"],
  logo: "png",
  feeds: [activitiesXvii, committeesXvii, diplomasXvii, initiativesXvii, membersXvii, petitionsXvii, professionalProfilesXvii],
};
