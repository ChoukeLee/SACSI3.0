import { OperationalPageSkeleton } from "@/components/operational-page-skeleton";
export default function Loading() {
  return (
    <div role="status" aria-label="正在读取建材城工作区">
      <OperationalPageSkeleton kind="records" rows={6} />
    </div>
  );
}
