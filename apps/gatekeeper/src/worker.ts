import { gatekeeper } from "./gatekeeper";
import { LIBRARIES } from "./libraries";

export default gatekeeper<Env>(LIBRARIES);
