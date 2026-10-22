import { nativeCollectionPost } from "@/features/business-actions/operator-native-collection-http";
export const POST = (request: Request) => nativeCollectionPost(request, "query");
