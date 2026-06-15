/**
 * PURPOSE: Compatibility facade for the project domain.
 *
 * Route modules keep importing from this stable path while project read models
 * and services live under backend/domains/projects.
 */
export * from './domains/projects/project-domain-service.js';
