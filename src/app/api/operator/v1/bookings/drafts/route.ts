import { dailyWorkflowPost } from "@/features/business-actions/operator-daily-workflow-http";
export const POST=(request:Request)=>dailyWorkflowPost(request,"drafts");
