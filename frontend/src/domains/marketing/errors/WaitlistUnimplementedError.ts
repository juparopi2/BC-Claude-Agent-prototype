export class WaitlistUnimplementedError extends Error {
  constructor() {
    super(
      'Waitlist service not yet implemented. ' +
      'See PRD-LP-005 section 5 for integration plan.'
    );
    this.name = 'WaitlistUnimplementedError';
  }
}
