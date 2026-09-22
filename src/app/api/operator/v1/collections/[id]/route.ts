import { confirmCollection } from "@/features/business-actions/operator-collection-http";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return confirmCollection(request, (await context.params).id);
}
