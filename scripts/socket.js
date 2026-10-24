/* Module socket router. */

import { MODULE_ID, SOCKET_NAME } from "./constants.js";
import { applyOp, hasOp, isPrimaryGM, resolveMutation } from "./data.js";

// Keep in-flight requests too: a retransmission must await the original result.
const requests = new Map();
let initialized = false;

export function initSocket() {
  if (initialized) return;
  initialized = true;
  game.socket.on(SOCKET_NAME, async (data) => {
    if (!data || typeof data !== "object" || !data.action) return;
    switch (data.action) {
      case "mutate": {
        // Only the primary GM applies relayed mutations (avoids double-writes).
        if (!isPrimaryGM()) break;
        if (!game.users.get(data.userId)?.active || !hasOp(data.op)
          || typeof data.requestId !== "string" || !data.requestId || data.requestId.length > 64
          || !data.payload || typeof data.payload !== "object" || Array.isArray(data.payload)) break;
        const key = `${data.userId}:${data.requestId}`;
        let request = requests.get(key);
        if (!request) {
          if (requests.size >= 512) {
            const oldest = [...requests].find(([, value]) => value.done);
            if (!oldest) break;
            requests.delete(oldest[0]);
          }
          request = { done: false, promise: applyOp(data.op, data.payload, data.userId) };
          requests.set(key, request);
          request.promise.finally(() => { request.done = true; });
        }
        const result = await request.promise;
        if (isPrimaryGM()) {
          game.socket.emit(SOCKET_NAME, {
            action: "mutateResult",
            requestId: data.requestId,
            targetUserId: data.userId,
            gmId: game.user.id,
            result: (typeof result === "string" || typeof result === "boolean" || typeof result === "object")
              ? result
              : !!result,
          });
        }
        break;
      }
      case "mutateResult":
        if (data.targetUserId === game.user.id) resolveMutation(data.requestId, data.result, data.gmId);
        break;
      case "notify":
        Hooks.callAll(`${MODULE_ID}.notify`, data);
        break;
      default:
        break;
    }
  });
}

export function emitSocket(data) {
  game.socket.emit(SOCKET_NAME, data);
}
