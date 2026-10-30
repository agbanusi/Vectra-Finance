import type { Address } from "viem";
import { isOpenRequest, type RequestStatus } from "@vectra/sdk";
import type { IndexView, OpenRequest, ProtocolReader } from "../chain/reader.js";

/** Snapshot of one index as the keeper sees it. All values come from chain reads. */
export interface IndexState {
  view: IndexView;
  /** Open (pending / partially filled) requests from the queue head, in FIFO order. */
  openRequests: OpenRequest[];
  /** Latest block timestamp (seconds); expiry is judged against chain time, not wall time. */
  now: number;
}

/** Upper bound on queue entries scanned per read, keeping lens calls bounded. */
export const MAX_QUEUE_SCAN = 200n;

export async function loadIndexState(reader: ProtocolReader, index: Address): Promise<IndexState> {
  const [views, latest] = await Promise.all([reader.getIndexes([index]), reader.getLatestBlock()]);
  const view = views[0];
  if (!view) throw new Error(`lens returned no view for ${index}`);
  const end = view.nextRequestId < view.headRequestId + MAX_QUEUE_SCAN ? view.nextRequestId : view.headRequestId + MAX_QUEUE_SCAN;
  const requests = end > view.headRequestId ? await reader.getRequests(index, view.headRequestId, end) : [];
  const openRequests = requests.filter((r) => isOpenRequest(r.request.status as RequestStatus));
  return { view, openRequests, now: latest.timestamp };
}
