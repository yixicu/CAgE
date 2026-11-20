import { createExtensionRuntime, type ResourceLoader } from '@earendil-works/pi-coding-agent';
/** Complete replacement, not DefaultResourceLoader overrides: never scans cwd, ancestors or ~/.pi. */
export function isolatedResources(systemPrompt: string): ResourceLoader {
  const extensions = { extensions: [], errors: [], runtime: createExtensionRuntime() };
  return {
    getExtensions: () => extensions,
    getSkills: () => ({ skills: [], diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () => systemPrompt,
    getSystemPromptSource: () => undefined,
    getAppendSystemPrompt: () => [],
    getAppendSystemPromptSources: () => [],
    extendResources: () => { throw new Error('CAgE role resources are immutable.'); },
    reload: async () => {},
  };
}
