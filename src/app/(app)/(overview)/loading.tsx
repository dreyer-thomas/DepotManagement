import { OverviewSkeleton } from "@/app/_components/overview/OverviewSkeleton";

/** Overview-only loading state: Skeletons in the page's layout while the figures are computed. */
export default function OverviewLoading() {
  return <OverviewSkeleton />;
}
