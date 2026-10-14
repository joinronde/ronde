import { PageSkeleton } from "@/components/page-skeleton";
import { PAGE_SKELETONS } from "@/lib/shared/skeleton";

export default function Loading() {
  return <PageSkeleton kind={PAGE_SKELETONS["projects/[slug]"]} />;
}
