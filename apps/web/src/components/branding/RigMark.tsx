import { cn } from "~/lib/utils";
import rigMark from "./rig-mark.svg";

export function RigMark({ className }: { readonly className: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-block shrink-0 bg-current mask-contain mask-center mask-no-repeat",
        className,
      )}
      style={{ maskImage: `url("${rigMark}")` }}
    />
  );
}
