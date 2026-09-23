import { confirmDailyWorkflow } from "@/features/business-actions/operator-daily-workflow-http";
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}) {return confirmDailyWorkflow(request,(await params).id);}
