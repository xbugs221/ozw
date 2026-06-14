/**
 * PURPOSE: Reject legacy Claude MCP REST endpoints after Claude provider removal.
 */
import express from 'express';

const router = express.Router();

router.use((req, res) => {
  res.status(410).json({
    success: false,
    error: 'Claude MCP endpoints are no longer supported',
  });
});

export default router;
