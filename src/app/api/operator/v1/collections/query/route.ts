import { collectionPost } from "@/features/business-actions/operator-collection-http";
export const POST = (request: Request) => collectionPost(request, "query");
