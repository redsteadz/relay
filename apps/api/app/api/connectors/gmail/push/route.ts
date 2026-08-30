import { handleGmailPush } from "../../../../../lib/gmail-push";

export async function POST(request: Request) {
  return handleGmailPush(request);
}
