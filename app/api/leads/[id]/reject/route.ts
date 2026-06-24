import { handleReject } from "@/src/hitl";
import { ownerActionRoute } from "@/app/api/_helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = ownerActionRoute(handleReject);
