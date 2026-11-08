import { createFileRoute } from "@tanstack/react-router";
import { Valhalla2Page } from "../components/valhalla2/Valhalla2Page";

export const Route = createFileRoute("/_chat/valhalla2")({ component: Valhalla2Page });
