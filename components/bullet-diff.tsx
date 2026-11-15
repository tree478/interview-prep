import { diffWords, type Change } from "diff";

/** Word-level changes between an original bullet and a rewrite. */
export function wordChanges(before: string, after: string): Change[] {
  return diffWords(before, after);
}

function DiffLine({ changes, side }: { changes: Change[]; side: "before" | "after" }) {
  return (
    <p>
      {changes.map((part, index) => {
        if (side === "before" && part.added) return null;
        if (side === "after" && part.removed) return null;
        if (side === "before" && part.removed) {
          return (
            <del key={index} className="line-through decoration-2">
              {part.value}
            </del>
          );
        }
        if (side === "after" && part.added) {
          return (
            <ins
              key={index}
              className="rounded-sm bg-amber-200 font-semibold text-foreground no-underline dark:bg-amber-300/40"
            >
              {part.value}
            </ins>
          );
        }
        return <span key={index}>{part.value}</span>;
      })}
    </p>
  );
}

/** Before line with removed words struck through, after line with added words highlighted. */
export function BulletDiffView({ before, after }: { before: string; after: string }) {
  const changes = wordChanges(before, after);
  return (
    <div className="flex flex-col gap-2">
      <div>
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Before</p>
        <DiffLine changes={changes} side="before" />
      </div>
      <div>
        <p className="text-xs uppercase tracking-wide text-muted-foreground">After</p>
        <DiffLine changes={changes} side="after" />
      </div>
    </div>
  );
}
