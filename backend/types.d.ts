/**
 * Type augmentations for Express request objects in the ozw server.
 *
 * Augments the global Express.Request interface so that req.user
 * is recognized as the payload set by the authenticateToken middleware.
 */
declare namespace Express {
  interface Request {
    user?: {
      id: number;
      username: string;
      email?: string;
    };
  }
}
