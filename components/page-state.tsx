import { Skeleton } from "@/components/ui/skeleton";

// Shared loading and error displays so every page looks the same while it waits.

export function LoadingCards({ count = 3 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading">
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} className="h-28 w-full" />
      ))}
    </div>
  );
}

export function ErrorMessage({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm">
      <p className="font-medium text-destructive">{message}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="mt-2 text-sm font-medium underline underline-offset-4">
          Try again
        </button>
      )}
    </div>
  );
}

export function PageHeader({ title, description, children }: {
  title: string;
  description?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {children}
    </div>
  );
}
