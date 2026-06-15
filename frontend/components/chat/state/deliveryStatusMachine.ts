/**
 * File purpose: centralize chat user-message delivery status transitions.
 * Business logic: turns provider acceptance, persisted echoes, and delivery
 * failures into explicit state-machine transitions instead of reducer strings.
 */
import type { ChatMessage } from '../types/types';

export type DeliveryStatus = NonNullable<ChatMessage['deliveryStatus']>;

/**
 * Mark a provider-accepted user send as persisted so live replies can anchor
 * to the confirmed green user bubble before JSONL history catches up.
 */
export function markAcceptedDeliveryPersisted(status: ChatMessage['deliveryStatus']): DeliveryStatus {
  if (status === 'pending' || status === 'sent') {
    return 'persisted';
  }
  return status || 'persisted';
}

/**
 * Mark a pending user send as failed when the send path rejects or times out.
 */
export function markPendingDeliveryFailed(status: ChatMessage['deliveryStatus']): DeliveryStatus {
  return status === 'pending' ? 'failed' : (status || 'persisted');
}

/**
 * Mark a local user row as persisted once provider history confirms it.
 * The legacy `sent` state is preserved as an intermediate state for older
 * realtime paths that only knew the assistant had started.
 */
export function markDeliveredByPersistedEcho(status: ChatMessage['deliveryStatus']): DeliveryStatus {
  return status === 'pending' || status === 'sent' ? 'persisted' : (status || 'persisted');
}

/**
 * Mark a pending local row as sent after assistant output starts but before
 * the provider transcript has emitted the authoritative user echo.
 */
export function markPendingDeliverySent(status: ChatMessage['deliveryStatus']): DeliveryStatus {
  return status === 'pending' ? 'sent' : (status || 'persisted');
}
