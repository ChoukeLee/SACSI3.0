import { OperationalPageSkeleton } from "@/components/operational-page-skeleton";
export default function Loading() {
  return (
    <div role="status" aria-label="Chargement de l’espace CIMAC">
      <OperationalPageSkeleton kind="records" rows={6} />
    </div>
  );
}
