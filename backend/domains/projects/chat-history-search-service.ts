/**
 * PURPOSE: Service entry for chat-history search so full-message reads stay
 * outside the default project discovery path.
 */
export {
  searchChatHistory,
} from './project-domain-core.js';

export const chatHistorySearchServiceEntry = true;
