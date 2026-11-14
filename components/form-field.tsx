import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

// A labeled text input with an optional hint and error message.
// Reused by every form (sign-up, log-in, profile).
//
// Accessibility wiring, so screen readers announce everything:
// - <Label htmlFor> ties the label to the input (clicking the label focuses it too).
// - aria-invalid marks the field as wrong; the shadcn Input turns red from it.
// - aria-describedby points at the hint and error text, which are read after the label.
type FormFieldProps = React.ComponentProps<typeof Input> & {
  id: string;
  label: string;
  error?: string;
  hint?: string;
};

export function FormField({ id, label, error, hint, className, ...inputProps }: FormFieldProps) {
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  // While there's an error, it replaces the hint so there's one message to read.
  const showHint = Boolean(hint) && !error;
  const describedBy = error ? errorId : showHint ? hintId : undefined;

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} className="text-sm">
        {label}
      </Label>
      <Input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cn("h-10 text-sm md:text-sm", className)}
        {...inputProps}
      />
      {showHint && (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-xs font-medium text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
