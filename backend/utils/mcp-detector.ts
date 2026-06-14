/**
 * MCP SERVER DETECTION UTILITY
 * ============================
 *
 * Centralized utility for detecting MCP server configurations.
 */

import { promises as fsPromises } from 'fs';
import path from 'path';
import os from 'os';

/**
 * Get all configured MCP servers
 * @returns {Promise<Object>} All MCP servers configuration
 */
export async function getAllMCPServers() {
    try {
        const homeDir = os.homedir();
        const configPaths = [
            path.join(homeDir, '.claude.json'),
            path.join(homeDir, '.claude', 'settings.json')
        ];

        let configData = null;
        let configPath = null;

        // Try to read from either config file
        for (const filepath of configPaths) {
            try {
                const fileContent = await fsPromises.readFile(filepath, 'utf8');
                configData = JSON.parse(fileContent);
                configPath = filepath;
                break;
            } catch (error) {
                continue;
            }
        }

        if (!configData) {
            return {
                hasConfig: false,
                servers: {},
                projectServers: {}
            };
        }

        return {
            hasConfig: true,
            configPath,
            servers: configData.mcpServers || {},
            projectServers: configData.projects || {}
        };
    } catch (error) {
        console.error('Error getting all MCP servers:', error);
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
            hasConfig: false,
            error: errorMessage,
            servers: {},
            projectServers: {}
        };
    }
}
