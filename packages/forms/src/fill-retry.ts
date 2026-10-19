/** Only host code may issue this marker after proving that no write was dispatched. */
export class RetryableFieldPreparationError extends Error {}
export const MAX_FIELD_RETRIES = 2;
export function safePreparationRetry(stage: string, type: string, attempt: number, limit = MAX_FIELD_RETRIES): boolean {
  return Number.isInteger(limit) && limit >= 0 && limit <= MAX_FIELD_RETRIES && attempt < limit
    && ['text', 'email', 'tel', 'url', 'textarea'].includes(type)
    && ['settle-field', 'reveal-field', 'hit-field', 'hover-field', 'focus-target'].includes(stage);
}
