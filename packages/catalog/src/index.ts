/*
 * The catalog's vocabularies: the keyed lists that name real things in the
 * world, which a feed refers to and the API serves expanded. They change when
 * the world does — a new publisher, a publisher's new site, another licence —
 * and never because the kernel and the Gatekeeper changed what they say to
 * each other. That is `@open-data-pt/contract`, and it is a different package
 * for that reason.
 */
export { hueOf, initials } from "./mark";
export { LICENCES, UNSTATED_LICENCE, isLicence, type Licence, type LicenceDescription } from "./licences";
export { PUBLISHERS, isPublisher, publisherEnabled, type Publisher, type PublisherDescription } from "./publishers";
export { TOPICS, isTopic, type Topic } from "./topics";
