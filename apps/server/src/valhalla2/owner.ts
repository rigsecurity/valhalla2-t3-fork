export function ownerIdForSession(session: {
  readonly sessionId: string;
  readonly proofKeyThumbprint?: string;
}): string {
  return session.proofKeyThumbprint
    ? `proof:${session.proofKeyThumbprint}`
    : `session:${session.sessionId}`;
}
