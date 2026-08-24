import type {
  CapturedRequest,
  RequestHistoryResponse,
} from "../types/webhook";

export type RequestHistoryPage = RequestHistoryResponse;

export function appendRequestPage(
  current: CapturedRequest[],
  page: RequestHistoryPage,
): RequestHistoryPage {
  const ids = new Set(current.map((request) => request.id));

  return {
    requests: [
      ...current,
      ...page.requests.filter((request) => !ids.has(request.id)),
    ],
    nextCursor: page.nextCursor,
  };
}
