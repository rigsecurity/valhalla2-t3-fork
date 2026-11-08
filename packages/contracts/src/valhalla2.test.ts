import { expect, it } from "vite-plus/test";
import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  AuthSettingsWriteScope,
  AuthSourceControlWriteScope,
} from "./auth.ts";
import { clientRpcRequiredScopes } from "./clientRpcPermissions.ts";
import { WS_METHODS } from "./rpc.ts";

it("requires source-control scope to publish and settings scope to promote shared knowledge", () => {
  expect(clientRpcRequiredScopes(WS_METHODS.valhalla2Command, undefined)).toEqual([
    AuthOrchestrationOperateScope,
  ]);
  expect(clientRpcRequiredScopes(WS_METHODS.valhalla2GetSnapshot, {})).toEqual([
    AuthOrchestrationReadScope,
  ]);
  expect(
    clientRpcRequiredScopes(WS_METHODS.valhalla2Command, { command: { type: "profile.save" } }),
  ).toEqual([AuthOrchestrationOperateScope]);
  expect(
    clientRpcRequiredScopes(WS_METHODS.valhalla2Command, { command: { type: "ticket.publish" } }),
  ).toEqual([AuthOrchestrationOperateScope, AuthSourceControlWriteScope]);
  for (const type of ["memory.verify", "memory.supersede", "memory.import"]) {
    expect(clientRpcRequiredScopes(WS_METHODS.valhalla2Command, { command: { type } })).toEqual([
      AuthOrchestrationOperateScope,
      AuthSettingsWriteScope,
    ]);
  }
});
