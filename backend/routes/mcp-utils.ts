/**
 * MCP UTILITIES API ROUTES
 * ========================
 *
 * API endpoints for MCP server detection and configuration utilities.
 * These endpoints expose centralized MCP detection functionality.
 */

import express from 'express';
import { getAllMCPServers } from '../utils/mcp-detector.js';

const router = express.Router();

/**
 * GET /api/mcp-utils/all-servers
 * Get all configured MCP servers
 */
router.get('/all-servers', async (req, res) => {
    try {
        const result = await getAllMCPServers();
        res.json(result);
    } catch (error) {
        console.error('MCP servers detection error:', error);
        res.status(500).json({
            error: 'Failed to get MCP servers',
            message: error instanceof Error ? error.message : String(error)
        });
    }
});

export default router;
