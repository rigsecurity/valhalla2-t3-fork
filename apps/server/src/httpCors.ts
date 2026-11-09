import { ORCHESTRATION_PROTOCOL_HEADER } from "@t3tools/contracts";
import brand from "../../../assets/valhalla2/brand.json" with { type: "json" };

export const browserApiCorsAllowedMethods = ["GET", "POST", "OPTIONS"] as const;
export const browserApiCorsAllowedHeaders = [
  "authorization",
  "b3",
  "traceparent",
  "content-type",
  "dpop",
  ORCHESTRATION_PROTOCOL_HEADER,
] as const;

export const DESKTOP_RENDERER_ORIGINS = [
  `${brand.scheme}://app`,
  `${brand.devScheme}://app`,
  "t3code://app",
  "t3code-dev://app",
] as const;
