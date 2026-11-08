import { createValhalla2Commands } from "@t3tools/client-runtime/state/valhalla2";
import { connectionAtomRuntime } from "../connection/runtime";

const commands = createValhalla2Commands(connectionAtomRuntime);
export const getValhalla2Snapshot = commands.snapshot;
export const runValhalla2Command = commands.command;
