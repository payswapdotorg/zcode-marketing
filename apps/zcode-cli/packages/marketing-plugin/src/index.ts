/**
 * @zcode/marketing-plugin — CLI runtime surface for the marketing domain layer.
 *
 * The plugin exposes the marketing mission tools through the built-in plugin
 * MCP server (declared in .zcode-plugin/plugin.json, seeded by the official
 * plugin definitions). Governance: docs/marketing/ (single source of truth);
 * this package owns no logic beyond runtime wiring: mission persistence under
 * the workspace and composition of the verified connectors of @zcode/marketing.
 */
export * from './contract.js';
export { MarketingRuntime, CompositeConnector, MarketingToolError } from './runtime.js';
export type { LoadedMission, MissionIndexEntry, ResearchMode, RuntimeOptions } from './runtime.js';
export { createMarketingServer, PLUGIN_NAME, PLUGIN_VERSION, SERVER_NAME } from './server.js';
export { main } from './main.js';
