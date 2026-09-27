import { PublicError } from "./publicError";

export interface ActiveRequest {
  requestId: string;
  controller: AbortController;
  timedOut: boolean;
}

export class RequestRegistry {
  private readonly activeRequests = new Map<number, ActiveRequest>();

  begin(senderId: number, requestId: string): ActiveRequest {
    if (this.activeRequests.has(senderId)) {
      throw new PublicError("已有优化请求正在运行，请先等待或取消");
    }
    const active: ActiveRequest = {
      requestId,
      controller: new AbortController(),
      timedOut: false,
    };
    this.activeRequests.set(senderId, active);
    return active;
  }

  get(senderId: number): ActiveRequest | undefined {
    return this.activeRequests.get(senderId);
  }

  finish(senderId: number, active: ActiveRequest): void {
    if (this.activeRequests.get(senderId) === active) {
      this.activeRequests.delete(senderId);
    }
  }

  cancel(senderId: number, requestId: string): boolean {
    const active = this.activeRequests.get(senderId);
    if (!active || active.requestId !== requestId) return false;
    active.controller.abort();
    return true;
  }

  cancelAll(): void {
    for (const active of this.activeRequests.values()) {
      active.controller.abort();
    }
    this.activeRequests.clear();
  }
}
