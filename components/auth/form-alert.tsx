// role="alert" makes screen readers announce the message as soon as it appears.
export function FormAlert({ message }: { message: string }) {
  return (
    <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
      {message}
    </div>
  );
}

// Shown only when the Supabase keys aren't in .env.local yet.
export function MockAuthNote() {
  return (
    <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
      Demo mode: sign-in is simulated until the Supabase keys are added to <code>.env.local</code>.
    </p>
  );
}
