import { LoadingCards } from "@/components/page-state";

// loading.tsx is a special Next.js file: it is shown while any page in this
// folder (or below it) is loading. Under the hood it wraps those pages in a
// React <Suspense> boundary, which cacheComponents needs for pages that read
// the URL's [id].
export default function Loading() {
  return <LoadingCards count={2} />;
}
