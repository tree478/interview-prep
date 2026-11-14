"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// A list of short values shown as removable chips, with a box to add more.
// Used for majors, minors, honors, skills, interests (and preferred locations in A-4).
type TagInputProps = {
  id: string;
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  hint?: string;
  error?: string;
  /** Hard limit; the add box disables when reached. */
  max?: number;
  /** Show only the first N chips until "Show all" is clicked. */
  collapseAfter?: number;
  /** Clean up or reject a typed value. Return { error } to refuse it with a message. */
  normalize?: (raw: string) => { value: string } | { error: string };
  /** Offered as the user types (native <datalist>, no extra library). */
  suggestions?: string[];
};

export function TagInput({
  id, label, values, onChange, placeholder, hint, error, max, collapseAfter, normalize, suggestions,
}: TagInputProps) {
  const [draft, setDraft] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const atMax = max !== undefined && values.length >= max;
  const visible = collapseAfter && !expanded ? values.slice(0, collapseAfter) : values;
  const hiddenCount = values.length - visible.length;
  const message = addError ?? error;
  const messageId = `${id}-message`;
  const listId = suggestions ? `${id}-suggestions` : undefined;

  function add() {
    const raw = draft.trim();
    if (!raw) return;
    const result = normalize ? normalize(raw) : { value: raw };
    if ("error" in result) {
      setAddError(result.error);
      return;
    }
    if (values.some((v) => v.toLowerCase() === result.value.toLowerCase())) {
      setAddError(`${result.value} is already added.`);
      return;
    }
    onChange([...values, result.value]);
    setDraft("");
    setAddError(null);
  }

  function remove(value: string) {
    onChange(values.filter((v) => v !== value));
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} className="text-sm">
        {label}
        {max !== undefined && (
          <span className="font-normal text-muted-foreground">
            ({values.length}/{max})
          </span>
        )}
      </Label>

      {values.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label={`${label} added`}>
          {visible.map((value) => (
            <li
              key={value}
              className="flex items-center gap-1 rounded-full bg-secondary py-0.5 pr-1 pl-2.5 text-xs text-secondary-foreground"
            >
              {value}
              <button
                type="button"
                onClick={() => remove(value)}
                aria-label={`Remove ${value}`}
                className="rounded-full px-1 text-muted-foreground hover:bg-background hover:text-foreground"
              >
                ×
              </button>
            </li>
          ))}
          {hiddenCount > 0 && (
            <li>
              <button type="button" onClick={() => setExpanded(true)} className="text-xs font-medium underline underline-offset-4">
                Show all ({hiddenCount} more)
              </button>
            </li>
          )}
        </ul>
      )}

      <div className="flex gap-2">
        <Input
          id={id}
          value={draft}
          list={listId}
          placeholder={atMax ? `Limit of ${max} reached` : placeholder}
          disabled={atMax}
          aria-invalid={message ? true : undefined}
          aria-describedby={message || hint ? messageId : undefined}
          className="h-9 text-sm md:text-sm"
          onChange={(e) => {
            setDraft(e.target.value);
            if (addError) setAddError(null);
          }}
          onKeyDown={(e) => {
            // Enter adds the tag instead of submitting the whole form.
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
        />
        <Button type="button" variant="outline" className="h-9 text-sm" onClick={add} disabled={atMax || !draft.trim()}>
          Add
        </Button>
      </div>
      {suggestions && (
        <datalist id={listId}>
          {suggestions.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      )}
      {(message || hint) && (
        <p id={messageId} className={message ? "text-xs font-medium text-destructive" : "text-xs text-muted-foreground"}>
          {message ?? hint}
        </p>
      )}
    </div>
  );
}
